import { useSyncExternalStore } from 'react';

/** Recently searched terms and viewed events / venues / pages, newest first. Synced for signed-in accounts. */
export type HistoryKind = 'search' | 'event' | 'venue' | 'page';
export interface HistoryItem {
  kind: HistoryKind;
  ref: string;
  label?: string;
  at: number;
}

const KEY = 'sottovoce.history';
const PER_KIND = 50;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

const read = (): HistoryItem[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

let items = read();

const commit = (next: HistoryItem[], notifySync: boolean) => {
  // One entry per (kind, ref), newest first, and a cap per kind.
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  items = next
    .sort((a, b) => b.at - a.at)
    .filter((i) => {
      const k = `${i.kind}\u0000${i.ref}`;
      if (seen.has(k) || (counts[i.kind] = (counts[i.kind] ?? 0) + 1) > PER_KIND) return false;
      seen.add(k);
      return true;
    });
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* private mode: history lasts for the visit */
  }
  listeners.forEach((l) => l());
  if (notifySync) changeListeners.forEach((l) => l());
};

export const onHistoryChange = (cb: () => void) => {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
};
export const getHistory = () => items;

export function recordHistory(kind: HistoryKind, ref: string, label?: string) {
  const r = kind === 'search' ? ref.trim().toLowerCase() : ref;
  if (!r || (kind === 'search' && r.length < 2)) return;
  commit([{ kind, ref: r, label: label ?? (kind === 'search' ? ref.trim() : undefined), at: Date.now() }, ...items], true);
}

export function applyHistory(incoming: HistoryItem[]) {
  if (incoming.length) commit([...items, ...incoming], false);
}

export function useHistory(kind: HistoryKind): HistoryItem[] {
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items
  );
  return all.filter((i) => i.kind === kind);
}

/** Every kind of history, newest first. */
export function useAllHistory(): HistoryItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items
  );
}
