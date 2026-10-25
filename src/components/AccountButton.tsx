import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ChevronRight, Cloud, CloudOff, Download, FileJson, Heart, History, LogIn, LogOut, Trash2, User, X } from 'lucide-react';
import { apiUrl, authClient, authToken, clearAuthToken } from '../utils/authClient';
import { downloadText, fileDate, toCsv } from '../utils/csv';
import { getHistory } from '../utils/history';
import { getSavedRecords, useSavedEvents } from '../utils/savedEvents';
import { signOutAndStop, useAccount } from '../utils/sync';
import { eventDay, timeLabel } from '../utils/timetableFormat';
import { eventPath, mePath, openPage, type MeSection } from '../utils/urlState';

const field =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1';
const fieldStyle = {
  backgroundColor: 'var(--bg-surface)',
  borderColor: 'var(--border-hairline)',
  color: 'var(--text-primary)',
};

/** The profile picture (Google's, for a Google account), or initials. */
const Avatar: React.FC<{ user: { name?: string | null; email?: string | null; image?: string | null } | null; size: number }> = ({ user, size }) => {
  const [broken, setBroken] = useState(false);
  const initials = (user?.name || user?.email || '')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const box: React.CSSProperties = { width: size, height: size };
  if (user?.image && !broken) {
    return (
      <img
        src={user.image}
        alt=""
        width={size}
        height={size}
        // Google's photo host refuses some referrers.
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="rounded-full object-cover shrink-0 ring-1 ring-[var(--border-hairline)]"
        style={box}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="rounded-full shrink-0 flex items-center justify-center font-mono font-semibold"
      style={{ ...box, fontSize: size * 0.38, backgroundColor: user ? 'var(--accent-gold)' : 'var(--bg-surface)', color: user ? '#0C0A0E' : 'var(--text-secondary)' }}
    >
      {user ? initials || <User className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
    </span>
  );
};

/**
 * Header profile button: your picture, and a menu with your likes, history and activity (each a page with its own link),
 * exports, and signing in to sync them across devices. Likes and history live on the device, so the menu works signed out.
 */
export const AccountButton: React.FC = () => {
  const { config, user, syncStatus } = useAccount();
  const { saved } = useSavedEvents();
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accounts = !!config?.enabled;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res =
      mode === 'up'
        ? await authClient.signUp.email({ email, password, name: name.trim() || email.split('@')[0] })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) setError(res.error.message || 'Something went wrong');
    else {
      setOpen(false);
      setPassword('');
    }
  };

  const google = async () => {
    setError('');
    const res = await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });
    if (res.error) setError(res.error.message || 'Google sign-in failed');
  };

  const deleteAccount = async () => {
    if (!window.confirm('Delete your account and everything synced to it? Data on this device stays.')) return;
    const pw = window.prompt('Enter your password to confirm');
    if (pw === null) return;
    const res = await authClient.deleteUser({ password: pw });
    if (res.error) setError(res.error.message || 'Could not delete the account');
    else {
      clearAuthToken();
      setOpen(false);
    }
  };

  const label = user ? user.name || user.email : 'You';
  const SyncIcon = syncStatus === 'error' ? CloudOff : Cloud;

  const go = (section: MeSection) => {
    setMenu(false);
    openPage(mePath(section));
  };
  const exportLikes = () => {
    setMenu(false);
    const events = getSavedRecords()
      .filter((r) => !r.deleted && r.event)
      .map((r) => r.event!)
      .sort((a, b) => a.start.localeCompare(b.start));
    downloadText(
      `sottovoce-likes-${fileDate()}.csv`,
      toCsv(events, [
        ['Title', (e) => e.title],
        ['Date', (e) => eventDay(e)],
        ['Time', (e) => timeLabel(e)],
        ['Venue', (e) => e.venue_name],
        ['Hall', (e) => e.hall],
        ['Category', (e) => e.category],
        ['Price', (e) => e.price],
        ['Booking link', (e) => e.url],
        ['sottovoce link', (e) => `${window.location.origin}${eventPath(e.id)}`],
      ])
    );
  };
  // Everything held for you: the server's copy when signed in, this device's otherwise.
  const exportAll = async () => {
    setMenu(false);
    let body: unknown = { saved: getSavedRecords(), history: getHistory() };
    if (user) {
      try {
        const token = authToken();
        const res = await fetch(apiUrl('/api/me/export'), { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (res.ok) body = { account: { name: user.name, email: user.email }, ...(await res.json()) };
      } catch {
        /* offline: this device's copy */
      }
    }
    downloadText(`sottovoce-data-${fileDate()}.json`, JSON.stringify(body, null, 2), 'application/json');
  };

  // Close on Escape or a click outside; keep it under the button as the page scrolls or resizes.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const item = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left cursor-pointer hover:bg-[var(--bg-subtle)]';
  const muted = { color: 'var(--text-muted)' };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={user ? `Account: ${label}` : 'Your likes, history and sign in'}
        title={user ? `Signed in as ${user.email}` : 'Your likes and history, and sign in to sync them'}
        className="pl-1.5 pr-3 py-1.5 rounded-lg border font-mono text-[11px] uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors"
        style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
      >
        <Avatar user={user} size={24} />
        <span className="hidden sm:inline max-w-[8rem] truncate">{user ? label : accounts ? 'Sign in' : 'You'}</span>
      </button>

      {menu &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[999]" onClick={() => setMenu(false)} aria-hidden />
            <div
              role="menu"
              aria-label="Your account"
              className="fixed z-[1000] w-[min(20rem,calc(100vw-1rem))] rounded-2xl border p-2 shadow-2xl"
              style={{ top: pos.top, right: pos.right, backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
            >
              <div className="flex items-center gap-3 px-2 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border-hairline)' }}>
                <Avatar user={user} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-fraunces text-base truncate">{user ? user.name || user.email : 'Not signed in'}</p>
                  <p className="text-xs truncate flex items-center gap-1" style={muted}>
                    {user ? (
                      <>
                        <SyncIcon className="w-3 h-3 shrink-0" />
                        {syncStatus === 'error' ? 'Sync paused, will retry' : syncStatus === 'syncing' ? 'Syncing…' : user.email}
                      </>
                    ) : (
                      'Likes and history stay on this device'
                    )}
                  </p>
                </div>
              </div>
              {!user && accounts && (
                <div className="p-2 space-y-1.5 border-b" style={{ borderColor: 'var(--border-hairline)' }}>
                  {config?.google && (
                    <button type="button" onClick={google} className="w-full rounded-lg border px-3 py-2 text-sm cursor-pointer flex items-center justify-center gap-2" style={{ borderColor: 'var(--border-hairline)' }}>
                      <GoogleG /> Continue with Google
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setOpen(true);
                    }}
                    className="w-full rounded-lg bg-[#9E1B32] hover:bg-[#7F1527] px-3 py-2 text-sm text-[#FAF6F0] cursor-pointer flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-3.5 h-3.5" /> Sign in with email
                  </button>
                </div>
              )}
              <div className="py-1.5 border-b" style={{ borderColor: 'var(--border-hairline)' }}>
                <button type="button" role="menuitem" className={item} onClick={() => go('likes')}>
                  <Heart className="w-4 h-4" style={{ color: 'var(--accent-crimson)' }} /> <span className="flex-1">Your likes</span>
                  <span className="text-xs font-mono" style={muted}>{saved.length}</span>
                  <ChevronRight className="w-3.5 h-3.5" style={muted} />
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => go('history')}>
                  <History className="w-4 h-4" style={muted} /> <span className="flex-1">History</span>
                  <ChevronRight className="w-3.5 h-3.5" style={muted} />
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => go('activity')}>
                  <Activity className="w-4 h-4" style={muted} /> <span className="flex-1">Activity</span>
                  <ChevronRight className="w-3.5 h-3.5" style={muted} />
                </button>
              </div>
              <div className="py-1.5" >
                <button type="button" role="menuitem" className={item} onClick={exportLikes} disabled={!saved.length}>
                  <Download className="w-4 h-4" style={muted} /> <span className="flex-1">Export likes (CSV)</span>
                </button>
                <button type="button" role="menuitem" className={item} onClick={() => void exportAll()}>
                  <FileJson className="w-4 h-4" style={muted} /> <span className="flex-1">Download all my data</span>
                </button>
                {user && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      onClick={() => {
                        void signOutAndStop();
                        setMenu(false);
                      }}
                    >
                      <LogOut className="w-4 h-4" style={muted} /> <span className="flex-1">Sign out</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      onClick={() => {
                        setMenu(false);
                        setOpen(true);
                      }}
                    >
                      <User className="w-4 h-4" style={muted} /> <span className="flex-1">Account settings</span>
                    </button>
                  </>
                )}
              </div>
              {error && <p className="px-3 pb-2 text-xs text-[#9E1B32]">{error}</p>}
            </div>
          </>,
          document.body
        )}

      {/* Portalled: the header's backdrop blur would otherwise pin this fixed overlay to the header, not the viewport. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Account"
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5 shadow-xl"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-hairline)', color: 'var(--text-primary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-fraunces text-lg">{user ? 'Your account' : mode === 'in' ? 'Sign in' : 'Create account'}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {user ? (
              <div className="space-y-3 text-sm">
                <p>
                  {user.name} <span style={{ color: 'var(--text-muted)' }}>· {user.email}</span>
                </p>
                <p className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <SyncIcon className="w-3.5 h-3.5" />
                  {syncStatus === 'syncing' && 'Syncing…'}
                  {syncStatus === 'synced' && 'Saved events, history and taste are synced.'}
                  {syncStatus === 'error' && "Couldn't reach the server; will retry."}
                  {syncStatus === 'off' && 'Starting sync…'}
                </p>
                {error && <p className="text-[#9E1B32]">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      void signOutAndStop();
                      setOpen(false);
                    }}
                    className="rounded-lg border px-3 py-2 cursor-pointer"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  >
                    Sign out
                  </button>
                  <button
                    type="button"
                    onClick={deleteAccount}
                    className="rounded-lg border px-3 py-2 cursor-pointer text-[#9E1B32]"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  >
                    Delete account
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Keep your saved events, recent searches and views, and taste in step across your devices.
                </p>
                {mode === 'up' && (
                  <input className={field} style={fieldStyle} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                )}
                <input className={field} style={fieldStyle} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <input
                  className={field}
                  style={fieldStyle}
                  type="password"
                  required
                  minLength={8}
                  placeholder="Password (8+ characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                />
                {error && <p className="text-sm text-[#9E1B32]">{error}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-[#9E1B32] hover:bg-[#7F1527] px-3 py-2 text-sm text-[#FAF6F0] cursor-pointer disabled:opacity-60"
                >
                  {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
                </button>
                {config?.google && (
                  <button
                    type="button"
                    onClick={google}
                    className="w-full rounded-lg border px-3 py-2 text-sm cursor-pointer flex items-center justify-center gap-2"
                    style={{ borderColor: 'var(--border-hairline)' }}
                  >
                    <GoogleG /> Continue with Google
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'in' ? 'up' : 'in');
                    setError('');
                  }}
                  className="w-full text-xs underline cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
                </button>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/** Google's "G", for the sign-in button. */
const GoogleG: React.FC = () => (
  <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
