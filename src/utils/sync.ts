import { useEffect, useState } from 'react';
import { apiUrl, authClient, authToken, clearAuthToken } from './authClient';
import { applySavedRecords, getSavedRecords, onSavedChange, type SavedRecord } from './savedEvents';
import { applyHistory, getHistory, onHistoryChange, type HistoryItem } from './history';

/**
 * Keeps a signed-in account's saved events, recent history and a few preferences in step across devices.
 * localStorage stays the source the UI reads (so the app works signed out and offline); this module pushes local
 * changes to POST /api/me/sync and merges what the server returns, last write wins per record.
 */

/** Synced preference -> the localStorage key its owner already reads at start-up. */
const PREF_STORAGE: Record<string, string> = {
  'lastfm.user': 'sottovoce.lastfm.user',
  theme: 'sottovoce-theme',
  'follow.prefs': 'sottovoce.follow.prefs',
  captions: 'sottovoce:captions',
};

interface PrefMeta { value: string | null; at: number }
interface SyncState { userId: string; since: number; pushed: number; prefs: Record<string, PrefMeta> }

const stateKey = (userId: string) => `sottovoce.sync.${userId}`;
const loadState = (userId: string): SyncState => {
  try {
    const s = JSON.parse(localStorage.getItem(stateKey(userId)) ?? 'null');
    if (s && typeof s.since === 'number') return { userId, since: s.since, pushed: s.pushed ?? 0, prefs: s.prefs ?? {} };
  } catch {
    /* start fresh */
  }
  return { userId, since: 0, pushed: 0, prefs: {} };
};
const saveState = (s: SyncState) => {
  try {
    localStorage.setItem(stateKey(s.userId), JSON.stringify({ since: s.since, pushed: s.pushed, prefs: s.prefs }));
  } catch {
    /* next sync resends */
  }
};
const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

let state: SyncState | null = null;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const statusListeners = new Set<(s: SyncStatus) => void>();
export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';
let status: SyncStatus = 'off';
const setStatus = (s: SyncStatus) => {
  status = s;
  statusListeners.forEach((l) => l(s));
};

/** Push local changes made since the last sync and merge what the server has newer. */
export async function syncNow(): Promise<void> {
  if (!state) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus('syncing');
  const st = state;
  // Local changes are stamped with the client clock, so they're pushed by client time; anything changed while
  // this request is in flight is stamped after `startedAt` and goes out with the next sync.
  const startedAt = Date.now();
  try {
    // Preferences change in other modules' localStorage keys; notice them by diffing against the last value we saw.
    const prefsOut: Record<string, { value: string; at: number }> = {};
    for (const [pref, storageKey] of Object.entries(PREF_STORAGE)) {
      const cur = readLocal(storageKey);
      const meta = st.prefs[pref];
      if (cur !== null && cur !== (meta?.value ?? null)) st.prefs[pref] = { value: cur, at: Date.now() };
      const m = st.prefs[pref];
      if (m?.value != null && m.at > st.pushed) prefsOut[pref] = { value: m.value, at: m.at };
    }

    const res = await fetch(apiUrl('/api/me/sync'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
      body: JSON.stringify({
        since: st.since,
        saved: getSavedRecords().filter((r) => r.at > st.pushed),
        history: getHistory().filter((h) => h.at > st.pushed),
        prefs: prefsOut,
      }),
    });
    if (res.status === 401) {
      stopSync();
      return;
    }
    if (!res.ok) throw new Error(`sync ${res.status}`);
    const data = (await res.json()) as {
      serverTime: number;
      saved: SavedRecord[];
      history: HistoryItem[];
      prefs: Record<string, { value: unknown; at: number }>;
    };

    applySavedRecords(data.saved);
    applyHistory(data.history);
    for (const [pref, p] of Object.entries(data.prefs)) {
      const storageKey = PREF_STORAGE[pref];
      if (!storageKey || typeof p.value !== 'string' || p.at <= (st.prefs[pref]?.at ?? 0)) continue;
      try {
        localStorage.setItem(storageKey, p.value);
      } catch {
        /* private mode */
      }
      // Picked up by the owning component the next time it loads.
      st.prefs[pref] = { value: p.value, at: p.at };
    }
    // Client clocks can run ahead of the server's, so only trust the server's own time as the cursor.
    st.since = data.serverTime;
    st.pushed = startedAt;
    saveState(st);
    setStatus('synced');
  } catch {
    setStatus('error');
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(500);
    }
  }
}

function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

let teardown: (() => void) | null = null;

export function startSync(userId: string) {
  if (state?.userId === userId) return;
  stopSync();
  state = loadState(userId);
  const onVisible = () => document.visibilityState === 'visible' && schedule(300);
  const onOnline = () => schedule(300);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  const offs = [onSavedChange(() => schedule()), onHistoryChange(() => schedule(4000))];
  // Pick up changes made on other devices while this one stays open.
  const poll = setInterval(() => document.visibilityState === 'visible' && schedule(0), 60_000);
  teardown = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    offs.forEach((o) => o());
    clearInterval(poll);
  };
  void syncNow();
}

export function stopSync() {
  teardown?.();
  teardown = null;
  state = null;
  clearTimeout(timer);
  setStatus('off');
}

/** Signs out and forgets the token. Local data stays on the device. */
export async function signOutAndStop() {
  stopSync();
  try {
    await authClient.signOut();
  } finally {
    clearAuthToken();
  }
}

/** Starts and stops syncing as the session comes and goes. Mount once. */
export function useAccount() {
  const { data: session, isPending } = authClient.useSession();
  const [config, setConfig] = useState<{ enabled: boolean; google: boolean } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(status);

  useEffect(() => {
    let live = true;
    fetch(apiUrl('/api/me/config'))
      .then((r) => (r.ok ? r.json() : { enabled: false, google: false }))
      .catch(() => ({ enabled: false, google: false }))
      .then((c) => live && setConfig(c));
    statusListeners.add(setSyncStatus);
    return () => {
      live = false;
      statusListeners.delete(setSyncStatus);
    };
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) startSync(userId);
    else if (!isPending) stopSync();
  }, [userId, isPending]);

  return { config, user: session?.user ?? null, loading: isPending, syncStatus };
}
