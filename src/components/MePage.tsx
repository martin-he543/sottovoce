import React, { useMemo, useState } from 'react';
import { Activity, Check, Download, Heart, History, Link2, Search } from 'lucide-react';
import type { TimetableEvent } from '../data/timetableCategories';
import { downloadText, fileDate, toCsv } from '../utils/csv';
import { useAllHistory, type HistoryItem } from '../utils/history';
import { useSavedEvents, useSavedRecords, type SavedRecord } from '../utils/savedEvents';
import { dayKey, eventDay, timeLabel } from '../utils/timetableFormat';
import { eventPath, mePath, venuePath, type MeSection } from '../utils/urlState';
import { BackLink, EventListRow, SectionHeading, useDocumentTitle } from './DetailParts';

const TABS: { id: MeSection; label: string; icon: React.ReactNode }[] = [
  { id: 'likes', label: 'Likes', icon: <Heart className="w-3.5 h-3.5" /> },
  { id: 'history', label: 'History', icon: <History className="w-3.5 h-3.5" /> },
  { id: 'activity', label: 'Activity', icon: <Activity className="w-3.5 h-3.5" /> },
];

const when = (at: number) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
const iso = (at: number) => new Date(at).toISOString();

const KIND_LABEL: Record<HistoryItem['kind'], string> = { search: 'Searched', event: 'Viewed event', venue: 'Viewed venue', page: 'Opened page' };

/** Where a history entry leads back to. */
function historyHref(h: HistoryItem): string {
  if (h.kind === 'event') return eventPath(h.ref);
  if (h.kind === 'venue') return venuePath(h.ref);
  if (h.kind === 'search') return `/discover/events?q=${encodeURIComponent(h.label ?? h.ref)}&range=all`;
  return h.ref.startsWith('/') ? h.ref : `/${h.ref}`;
}

const likesCsv = (events: TimetableEvent[]) =>
  toCsv(events, [
    ['Title', (e) => e.title],
    ['Date', (e) => eventDay(e)],
    ['Time', (e) => timeLabel(e)],
    ['Venue', (e) => e.venue_name],
    ['Hall', (e) => e.hall],
    ['Category', (e) => e.category],
    ['Price', (e) => e.price],
    ['Sold out', (e) => (e.sold_out ? 'yes' : '')],
    ['Booking link', (e) => e.url],
    ['sottovoce link', (e) => `${window.location.origin}${eventPath(e.id)}`],
  ]);

const historyCsv = (items: HistoryItem[]) =>
  toCsv(items, [
    ['When', (h) => iso(h.at)],
    ['What', (h) => KIND_LABEL[h.kind]],
    ['Label', (h) => h.label ?? h.ref],
    ['Link', (h) => `${window.location.origin}${historyHref(h)}`],
  ]);

interface ActivityRow {
  at: number;
  what: string;
  label: string;
  href?: string;
}

function activityRows(records: SavedRecord[], history: HistoryItem[]): ActivityRow[] {
  const rows: ActivityRow[] = [
    ...records
      .filter((r) => r.at > 1)
      .map((r) =>
        r.deleted || !r.event
          ? { at: r.at, what: 'Removed a like', label: r.id, href: eventPath(r.id) }
          : { at: r.at, what: 'Liked', label: `${r.event.title} · ${r.event.venue_name}`, href: eventPath(r.id) }
      ),
    ...history.map((h) => ({ at: h.at, what: KIND_LABEL[h.kind], label: h.label ?? h.ref, href: historyHref(h) })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

const activityCsv = (rows: ActivityRow[]) =>
  toCsv(rows, [
    ['When', (r) => iso(r.at)],
    ['What', (r) => r.what],
    ['Label', (r) => r.label],
    ['Link', (r) => (r.href ? `${window.location.origin}${r.href}` : '')],
  ]);

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono uppercase tracking-wider cursor-pointer disabled:opacity-40';
const btnStyle = { borderColor: 'var(--border-hairline)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' };

/** Your own pages: liked events (to open, share by link or export), recent searches and views, and both on one timeline. */
export const MePage: React.FC<{ section: MeSection }> = ({ section }) => {
  useDocumentTitle(section === 'likes' ? 'Your likes' : section === 'history' ? 'Your history' : 'Your activity');
  const { saved, toggle } = useSavedEvents();
  const records = useSavedRecords();
  const history = useAllHistory();
  const [copied, setCopied] = useState(false);
  const today = dayKey(new Date());
  const [upcoming, past] = useMemo(() => {
    const sorted = [...saved].sort((a, b) => a.start.localeCompare(b.start));
    return [sorted.filter((e) => eventDay(e) >= today), sorted.filter((e) => eventDay(e) < today).reverse()];
  }, [saved, today]);
  const activity = useMemo(() => activityRows(records, history), [records, history]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${mePath(section)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the address bar has it */
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <BackLink href="/discover/events">Events</BackLink>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-fraunces text-3xl">Your sottovoce</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Likes, recent searches and pages you’ve opened. Kept on this device, and synced when you’re signed in.
          </p>
        </div>
        <button type="button" onClick={copyLink} className={btn} style={btnStyle} title="Copy a link to this page">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <nav className="inline-flex rounded-xl border p-1" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)' }} aria-label="Your pages">
        {TABS.map((tab) => {
          const on = tab.id === section;
          return (
            <a
              key={tab.id}
              href={mePath(tab.id)}
              data-route
              aria-current={on ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-fraunces text-sm ${on ? 'shadow-sm font-semibold' : 'hover:opacity-80'}`}
              style={{ backgroundColor: on ? 'var(--bg-surface)' : 'transparent', color: on ? 'var(--accent-crimson)' : 'var(--text-secondary)' }}
            >
              {tab.icon} {tab.label}
            </a>
          );
        })}
      </nav>

      {section === 'likes' && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} style={btnStyle} disabled={!saved.length} onClick={() => downloadText(`sottovoce-likes-${fileDate()}.csv`, likesCsv([...upcoming, ...past]))}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              {saved.length} liked · {upcoming.length} coming up
            </span>
          </div>
          {!saved.length && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Nothing liked yet. Tap the heart on any event in Discover to keep it here.
            </p>
          )}
          {upcoming.length > 0 && <LikeList title="Coming up" events={upcoming} onUnlike={toggle} />}
          {past.length > 0 && <LikeList title="Past" events={past} onUnlike={toggle} />}
        </section>
      )}

      {section === 'history' && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} style={btnStyle} disabled={!history.length} onClick={() => downloadText(`sottovoce-history-${fileDate()}.csv`, historyCsv(history))}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
          {(['search', 'event', 'venue', 'page'] as const).map((kind) => {
            const list = history.filter((h) => h.kind === kind);
            if (!list.length) return null;
            return (
              <div key={kind}>
                <SectionHeading count={list.length}>{kind === 'search' ? 'Searches' : kind === 'event' ? 'Events viewed' : kind === 'venue' ? 'Venues viewed' : 'Pages'}</SectionHeading>
                <ul className="space-y-1">
                  {list.map((h) => (
                    <HistoryRow key={`${h.kind}:${h.ref}`} at={h.at} label={h.label ?? h.ref} href={historyHref(h)} icon={kind === 'search' ? <Search className="w-3.5 h-3.5" /> : <History className="w-3.5 h-3.5" />} />
                  ))}
                </ul>
              </div>
            );
          })}
          {!history.length && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No history yet: searches and the events and venues you open show up here.
            </p>
          )}
        </section>
      )}

      {section === 'activity' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} style={btnStyle} disabled={!activity.length} onClick={() => downloadText(`sottovoce-activity-${fileDate()}.csv`, activityCsv(activity))}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              {activity.length} things, newest first
            </span>
          </div>
          <ol className="relative border-l pl-5 space-y-3" style={{ borderColor: 'var(--border-hairline)' }}>
            {activity.slice(0, 300).map((r, i) => (
              <li key={`${r.at}:${i}`} className="relative">
                <span className="absolute -left-[1.45rem] top-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: r.what === 'Liked' ? 'var(--accent-crimson)' : 'var(--text-muted)' }} />
                <p className="text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                  {when(r.at)} · {r.what}
                </p>
                {r.href ? (
                  <a href={r.href} data-route className="text-sm hover:underline underline-offset-2" style={{ color: 'var(--text-primary)' }}>
                    {r.label}
                  </a>
                ) : (
                  <p className="text-sm">{r.label}</p>
                )}
              </li>
            ))}
          </ol>
          {!activity.length && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Nothing yet. Likes, searches and the pages you open will appear here as a timeline.
            </p>
          )}
        </section>
      )}
    </div>
  );
};

const LikeList: React.FC<{ title: string; events: TimetableEvent[]; onUnlike: (e: TimetableEvent) => void }> = ({ title, events, onUnlike }) => (
  <div>
    <SectionHeading count={events.length}>{title}</SectionHeading>
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-2">
          <ul className="flex-1 min-w-0">
            <EventListRow e={e} showVenue />
          </ul>
          <button
            type="button"
            onClick={() => onUnlike(e)}
            className="shrink-0 p-2 rounded-full cursor-pointer"
            style={{ color: 'var(--accent-crimson)' }}
            aria-label={`Unlike ${e.title}`}
            title="Unlike"
          >
            <Heart className="w-4 h-4" fill="currentColor" />
          </button>
        </div>
      ))}
    </div>
  </div>
);

const HistoryRow: React.FC<{ at: number; label: string; href: string; icon: React.ReactNode }> = ({ at, label, href, icon }) => (
  <li>
    <a
      href={href}
      data-route
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:opacity-80"
      style={{ backgroundColor: 'var(--bg-subtle)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <span className="flex-1 min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
      <span className="shrink-0 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
        {when(at)}
      </span>
    </a>
  </li>
);
