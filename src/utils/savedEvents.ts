import { useSyncExternalStore } from 'react';
import type { TimetableEvent } from '../data/timetableCategories';

/**
 * Events hearted on the timetable, kept in localStorage as snapshots so they outlive a timetable refresh.
 * Each record carries the time of its last change (and unsaves stay as tombstones) so signed-in accounts can
 * merge them across devices, last write wins; see sync.ts.
 */
export interface SavedRecord {
  id: string;
  event: TimetableEvent | null;
  at: number;
  deleted?: boolean;
}

const KEY = 'sottovoce.taste.saved-events.v2';
const LEGACY_KEY = 'sottovoce.taste.saved-events';
const listeners = new Set<() => void>();

const read = (): SavedRecord[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(parsed)) return parsed;
    // Pre-account format: a bare list of events. at=1 so anything already on the server wins a conflict.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
    return Array.isArray(legacy) ? legacy.map((event: TimetableEvent) => ({ id: event.id, event, at: 1 })) : [];
  } catch {
    return [];
  }
};

let records = read();
const live = (r: SavedRecord[]) => r.filter((x) => !x.deleted && x.event).map((x) => x.event as TimetableEvent);
let snapshot = live(records);

const commit = (next: SavedRecord[], notifySync = true) => {
  records = next;
  snapshot = live(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private window / quota): keep the in-memory list for this session.
  }
  listeners.forEach((l) => l());
  if (notifySync) changeListeners.forEach((l) => l());
};

const changeListeners = new Set<() => void>();
/** Fires on every local change (not on changes applied from the server). */
export const onSavedChange = (cb: () => void) => {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
};

export const getSavedRecords = () => records;

/** Merge records from the server: the newer change to each event wins. */
export function applySavedRecords(incoming: SavedRecord[]) {
  const byId = new Map(records.map((r) => [r.id, r]));
  let changed = false;
  for (const r of incoming) {
    const cur = byId.get(r.id);
    if (!cur || r.at > cur.at) {
      byId.set(r.id, r);
      changed = true;
    }
  }
  if (changed) commit([...byId.values()], false);
}

export const toggleSavedEvent = (e: TimetableEvent) => {
  const now = Date.now();
  const isSaved = snapshot.some((s) => s.id === e.id);
  const rest = records.filter((r) => r.id !== e.id);
  commit([...rest, isSaved ? { id: e.id, event: null, at: now, deleted: true } : { id: e.id, event: e, at: now }]);
};

export function useSavedEvents() {
  const saved = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot
  );
  return { saved, isSaved: (id: string) => saved.some((s) => s.id === id), toggle: toggleSavedEvent };
}

/** Every like and unlike with its time, newest first, for the activity timeline. */
export function useSavedRecords(): SavedRecord[] {
  useSavedEvents();
  return [...records].sort((a, b) => b.at - a.at);
}
