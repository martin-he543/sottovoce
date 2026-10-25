import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ArgonMark } from '../ArgonButton';
import type { ListenSubject } from '../useLiveListener';
import { FONTS, type Theme } from './prefs';

/** Argon's profile of a character, as the server returns it. */
export interface CharacterProfile {
  name: string;
  nameEn: string;
  voice: string;
  role: string;
  summary: string;
  facts: { label: string; value: string }[];
  nowDoing: string;
  relationships: { name: string; relation: string }[];
  knownFor: string;
  listenFor: string;
}

/** Where the reader is, so the profile can say what the character is doing right now. */
export interface SceneContext {
  /** The section id: a new scene asks again. */
  id: string;
  trail: string;
  summary?: string;
  lines: { who?: string; text: string; translation?: string }[];
  /** Everyone who sings in this scene. */
  cast: string[];
}

type Status = 'idle' | 'loading' | 'error' | 'off';

/**
 * The character being looked at in the Info panel. Each (character, scene) is fetched once; moving to another scene while
 * a profile is open fetches it again for the new place, keeping the old one on screen until it arrives.
 */
export function useCharacterInfo(subject: ListenSubject, scene: SceneContext) {
  const [who, setWho] = useState<string | null>(null);
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [tries, setTries] = useState(0);
  const cache = useRef(new Map<string, CharacterProfile>());
  const live = useRef({ subject, scene });
  live.current = { subject, scene };
  const title = subject.title;
  const sceneId = scene.id;

  // A new work forgets everyone.
  useEffect(() => {
    cache.current.clear();
    setWho(null);
    setProfile(null);
    setStatus('idle');
  }, [title]);

  useEffect(() => {
    if (!who) return;
    const key = `${who.toLowerCase()}|${sceneId}`;
    const hit = cache.current.get(key);
    if (hit) {
      setProfile(hit);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const { subject: s, scene: sc } = live.current;
    void (async () => {
      try {
        const res = await fetch('/api/immerse/character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work: { title: s.title, composer: s.composer, language: s.language, synopsis: s.synopsis },
            character: who,
            where: { trail: sc.trail, scene: sc.summary, lines: sc.lines },
            cast: sc.cast,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus(res.status === 501 ? 'off' : 'error');
          return;
        }
        const data = (await res.json()) as CharacterProfile;
        cache.current.set(key, data);
        setProfile(data);
        setStatus('idle');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [who, sceneId, tries]);

  const open = useCallback((name: string) => {
    setProfile(null);
    setWho(name);
  }, []);
  const retry = useCallback(() => setTries((n) => n + 1), []);

  return { who, profile, status, open, retry, close: () => setWho(null) };
}

/** A name's capitals, for the portrait tile: "Don José" → "DJ". */
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/[\s·-]+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/** The pill switch above the sidebar: Argon (the conversation) or Info (the character panel). */
export const SideTabs: React.FC<{ theme: Theme; tab: 'argon' | 'info'; onTab: (t: 'argon' | 'info') => void }> = ({ theme: t, tab, onTab }) => {
  const pill = (id: 'argon' | 'info', label: string, icon?: React.ReactNode) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-wider cursor-pointer transition-colors"
      style={tab === id ? { backgroundColor: t.gold, color: t.bg } : { color: t.dim }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="px-3 pt-3 pb-1">
      <div role="tablist" aria-label="Sidebar" className="flex gap-1 p-1 rounded-full border" style={{ borderColor: t.hair }}>
        {pill('argon', 'Argon', <ArgonMark className="w-3 h-3" />)}
        {pill('info', 'Info')}
      </div>
    </div>
  );
};

interface PanelProps {
  theme: Theme;
  who: string | null;
  profile: CharacterProfile | null;
  status: Status;
  scene: SceneContext;
  onPick: (name: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** Everyone in `cast` as chips that open their profiles. */
const CastChips: React.FC<{ theme: Theme; names: string[]; current?: string | null; onPick: (n: string) => void }> = ({ theme: t, names, current, onPick }) => (
  <div className="flex flex-wrap gap-1.5">
    {names.map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => onPick(n)}
        className="px-2.5 py-1 rounded-full border text-xs cursor-pointer"
        style={{ borderColor: n === current ? t.gold : t.hair, color: n === current ? t.gold : t.ink }}
      >
        {n}
      </button>
    ))}
  </div>
);

/** The Info sidebar: a character page in the manner of a cast listing, with what they are doing at this very place. */
export const CharacterInfo: React.FC<PanelProps> = ({ theme: t, who, profile, status, scene, onPick, onRetry, onClose }) => {
  const label = (s: string) => (
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-1.5" style={{ color: t.dim }}>
      {s}
    </p>
  );
  const serif = { fontFamily: FONTS[0].family, fontStyle: 'italic' } as const;
  const loading = status === 'loading';
  const bar = (w: string) => <span className="block h-3 rounded animate-pulse" style={{ width: w, backgroundColor: t.hair }} />;
  const others = scene.cast.filter((n) => n.toLowerCase() !== who?.toLowerCase());

  return (
    <section className="flex flex-col h-full min-h-0" aria-label="Character info">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: t.hair }}>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: t.gold }}>
            Info
          </p>
          <p className="text-[11px] truncate" style={{ color: t.dim }}>
            {who ? `Spoiler-safe up to ${scene.trail || 'where you are'}` : 'Tap a character’s name in the text'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="p-1.5 rounded-full cursor-pointer" style={{ color: t.dim }} aria-label="Hide the sidebar" title="Hide">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-5">
        {!who && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: t.dim }}>
              Select a character’s name above a line, or pick someone on stage in this scene, to see who they are and what they are doing right now.
            </p>
            {scene.cast.length > 0 && (
              <div>
                {label('On stage in this scene')}
                <CastChips theme={t} names={scene.cast} onPick={onPick} />
              </div>
            )}
          </div>
        )}

        {who && (
          <>
            <div className="flex gap-3.5">
              <div
                className="shrink-0 w-[4.5rem] h-[6rem] rounded-lg flex items-center justify-center border"
                style={{ background: `linear-gradient(160deg, ${t.accent}55, ${t.gold}33 60%, ${t.panel})`, borderColor: t.hair, color: t.ink, ...serif, fontSize: '1.9rem' }}
                aria-hidden
              >
                {initials(profile?.name || who)}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <h2 className="text-2xl leading-tight break-words" style={serif}>
                  {profile?.name || who}
                </h2>
                {profile?.nameEn && (
                  <p className="text-xs" style={{ color: t.dim }}>
                    {profile.nameEn}
                  </p>
                )}
                {loading && !profile ? (
                  <div className="space-y-1.5 pt-1">
                    {bar('90%')}
                    {bar('60%')}
                  </div>
                ) : (
                  profile?.role && (
                    <p className="text-sm leading-snug" style={{ color: t.ink, opacity: 0.85 }}>
                      {profile.role}
                    </p>
                  )
                )}
                {profile?.voice && (
                  <span className="inline-block px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wider" style={{ color: t.gold, borderColor: t.gold }}>
                    {profile.voice}
                  </span>
                )}
              </div>
            </div>

            {status === 'off' && (
              <p className="text-sm" style={{ color: t.accent }}>
                Argon isn’t set up on this server (no Gemini key).
              </p>
            )}
            {status === 'error' && (
              <p className="text-sm" style={{ color: t.accent }}>
                Argon couldn’t build this profile.{' '}
                <button type="button" onClick={onRetry} className="underline underline-offset-2 cursor-pointer">
                  Try again
                </button>
              </p>
            )}

            {profile && (
              <div className="rounded-lg border-l-2 pl-3 pr-2 py-2.5 space-y-1" style={{ borderColor: t.gold, backgroundColor: `${t.gold}14` }}>
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: t.gold }}>
                  <ArgonMark className="w-3 h-3" /> Right now{scene.trail ? ` · ${scene.trail}` : ''}
                  {loading && <span className="animate-pulse opacity-70"> · updating…</span>}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: t.ink }}>
                  {profile.nowDoing}
                </p>
              </div>
            )}

            {loading && !profile && (
              <div className="space-y-2">
                {bar('100%')}
                {bar('95%')}
                {bar('70%')}
              </div>
            )}

            {profile?.summary && (
              <div>
                {label('About')}
                <p className="text-sm leading-relaxed" style={{ color: t.ink, opacity: 0.9 }}>
                  {profile.summary}
                </p>
              </div>
            )}

            {profile && profile.facts.length > 0 && (
              <div>
                {label('Quick facts')}
                <dl className="rounded-lg border divide-y" style={{ borderColor: t.hair }}>
                  {profile.facts.map((f) => (
                    <div key={f.label} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5" style={{ borderColor: t.hair }}>
                      <dt className="font-mono text-[10px] uppercase tracking-wider pt-0.5" style={{ color: t.dim }}>
                        {f.label}
                      </dt>
                      <dd className="text-sm" style={{ color: t.ink }}>
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {profile && profile.relationships.length > 0 && (
              <div>
                {label('Connections')}
                <div className="space-y-1">
                  {profile.relationships.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => onPick(r.name)}
                      className="w-full flex items-baseline gap-2 text-left px-3 py-1.5 rounded-lg border cursor-pointer"
                      style={{ borderColor: t.hair }}
                    >
                      <span className="text-sm" style={{ color: t.accent }}>
                        {r.name}
                      </span>
                      <span className="text-xs min-w-0 truncate" style={{ color: t.dim }}>
                        {r.relation}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {profile?.knownFor && (
              <div>
                {label('Known for')}
                <p className="text-sm leading-relaxed" style={{ color: t.ink, opacity: 0.9 }}>
                  {profile.knownFor}
                </p>
              </div>
            )}
            {profile?.listenFor && (
              <div>
                {label('Listen for')}
                <p className="text-sm leading-relaxed italic" style={{ color: t.gold }}>
                  {profile.listenFor}
                </p>
              </div>
            )}

            {others.length > 0 && (
              <div>
                {label('Also in this scene')}
                <CastChips theme={t} names={others} onPick={onPick} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
