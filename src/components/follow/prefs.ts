import { useCallback, useState } from 'react';

export interface Theme {
  id: string;
  name: string;
  bg: string;
  panel: string;
  ink: string;
  dim: string;
  faint: string;
  /** English translation text: tinted apart from the original and legible on this theme. */
  trans: string;
  hair: string;
  accent: string;
  gold: string;
}

/** Colour schemes for the reader. Dark ones are for the auditorium; Page is for a bright foyer or the daytime. */
export const THEMES: Theme[] = [
  { id: 'stage', name: 'Stage', bg: '#050406', panel: '#0c0a0e', ink: '#FAF6F0', dim: 'rgba(250,246,240,0.55)', faint: 'rgba(250,246,240,0.28)', hair: 'rgba(250,246,240,0.12)', accent: '#E5546C', gold: '#C9A24B', trans: '#8EC5DB' },
  { id: 'oled', name: 'Black', bg: '#000000', panel: '#000000', ink: '#EDEDED', dim: 'rgba(237,237,237,0.5)', faint: 'rgba(237,237,237,0.25)', hair: 'rgba(237,237,237,0.14)', accent: '#FF5F7A', gold: '#D9B45A', trans: '#8EC9E0' },
  { id: 'velvet', name: 'Velvet', bg: '#1a0709', panel: '#240b0e', ink: '#F7E9DC', dim: 'rgba(247,233,220,0.58)', faint: 'rgba(247,233,220,0.3)', hair: 'rgba(247,233,220,0.15)', accent: '#FF8A7A', gold: '#E0B35C', trans: '#9AD0C2' },
  { id: 'midnight', name: 'Midnight', bg: '#070b16', panel: '#0d1424', ink: '#E8EEFB', dim: 'rgba(232,238,251,0.55)', faint: 'rgba(232,238,251,0.28)', hair: 'rgba(232,238,251,0.13)', accent: '#7FB0FF', gold: '#E6C068', trans: '#8FD6C4' },
  { id: 'page', name: 'Page', bg: '#FAF6F0', panel: '#F1EBE1', ink: '#1B1713', dim: 'rgba(27,23,19,0.6)', faint: 'rgba(27,23,19,0.32)', hair: 'rgba(27,23,19,0.14)', accent: '#9E1B32', gold: '#8A6A1F', trans: '#1F5F7A' },
  { id: 'contrast', name: 'High contrast', bg: '#000000', panel: '#000000', ink: '#FFFFFF', dim: 'rgba(255,255,255,0.75)', faint: 'rgba(255,255,255,0.45)', hair: 'rgba(255,255,255,0.4)', accent: '#FFE600', gold: '#FFE600', trans: '#7DF0FF' },
];

export interface FontChoice {
  id: string;
  name: string;
  family: string;
  italic: boolean;
}

export const FONTS: FontChoice[] = [
  { id: 'instrument', name: 'Instrument', family: "'Instrument Serif', 'Fraunces', Georgia, serif", italic: true },
  { id: 'fraunces', name: 'Fraunces', family: "'Fraunces', Georgia, serif", italic: false },
  { id: 'classic', name: 'Classic serif', family: "Georgia, 'Times New Roman', serif", italic: false },
  { id: 'sans', name: 'Sans', family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", italic: false },
  { id: 'mono', name: 'Mono', family: "'Fira Code', ui-monospace, SFMono-Regular, monospace", italic: false },
];

export type Layout = 'scroll' | 'tap';
export type Axis = 'vertical' | 'horizontal';

export interface FollowPrefs {
  theme: string;
  font: string;
  /** Any installed font family the reader should use instead of the presets. */
  customFont: string;
  /** Multiplier on the base size. */
  size: number;
  layout: Layout;
  axis: Axis;
  /** Synced follows the room (microphone, scanner); manual only moves when you do. */
  sync: boolean;
  original: boolean;
  translation: boolean;
  explanation: boolean;
  names: boolean;
  /** Show the original and its English translation in two columns instead of one above the other. */
  sideBySide: boolean;
  /** Which column the English goes in when side by side. */
  englishSide: 'right' | 'left';
  /** Blur and shrink the lines away from the current one, as lyrics do in a music player. */
  focus: boolean;
  /** Width of the contents list, in pixels (dragged by its edge). */
  navWidth: number;
  /** The Argon chat sidebar on the right: shown or hidden, and its width. */
  chat: boolean;
  chatWidth: number;
  /** Argon adds a short note to the sidebar every few lines. */
  commentary: boolean;
}

export const NAV_WIDTH = { min: 180, max: 560 };
export const CHAT_WIDTH = { min: 260, max: 640 };

export const DEFAULT_PREFS: FollowPrefs = {
  theme: 'stage',
  font: 'instrument',
  customFont: '',
  size: 1,
  layout: 'scroll',
  axis: 'vertical',
  sync: true,
  original: true,
  translation: true,
  explanation: false,
  names: true,
  sideBySide: true,
  englishSide: 'right',
  focus: true,
  navWidth: 240,
  chat: true,
  chatWidth: 340,
  commentary: false,
};

const KEY = 'sottovoce.follow.prefs';

/** Settings saved by an older version (or edited by hand) are checked field by field, so a bad one cannot break the reader. */
function clean(raw: unknown): FollowPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof FollowPrefs>(k: K, ok: (v: unknown) => boolean): FollowPrefs[K] =>
    (ok(r[k]) ? r[k] : DEFAULT_PREFS[k]) as FollowPrefs[K];
  const bool = (v: unknown) => typeof v === 'boolean';
  return {
    theme: pick('theme', (v) => THEMES.some((t) => t.id === v)),
    font: pick('font', (v) => FONTS.some((f) => f.id === v)),
    customFont: pick('customFont', (v) => typeof v === 'string'),
    size: pick('size', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.6 && v <= 2),
    layout: pick('layout', (v) => v === 'scroll' || v === 'tap'),
    axis: pick('axis', (v) => v === 'vertical' || v === 'horizontal'),
    sync: pick('sync', bool),
    original: pick('original', bool),
    translation: pick('translation', bool),
    explanation: pick('explanation', bool),
    names: pick('names', bool),
    sideBySide: pick('sideBySide', bool),
    englishSide: pick('englishSide', (v) => v === 'right' || v === 'left'),
    focus: pick('focus', bool),
    navWidth: pick('navWidth', (v) => typeof v === 'number' && v >= NAV_WIDTH.min && v <= NAV_WIDTH.max),
    chat: pick('chat', bool),
    commentary: pick('commentary', bool),
    chatWidth: pick('chatWidth', (v) => typeof v === 'number' && v >= CHAT_WIDTH.min && v <= CHAT_WIDTH.max),
  };
}

const load = (): FollowPrefs => {
  try {
    return clean(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return DEFAULT_PREFS;
  }
};

/** Reader settings, remembered between visits. */
export function useFollowPrefs() {
  const [prefs, setPrefs] = useState<FollowPrefs>(load);
  const set = useCallback((patch: Partial<FollowPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode: settings last for the visit */
      }
      return next;
    });
  }, []);
  return [prefs, set] as const;
}

export const themeOf = (p: FollowPrefs) => THEMES.find((t) => t.id === p.theme) ?? THEMES[0];

export function fontOf(p: FollowPrefs): { family: string; italic: boolean } {
  const custom = p.customFont.trim();
  if (custom) return { family: `'${custom.replace(/['"\\]/g, '')}', Georgia, serif`, italic: false };
  const f = FONTS.find((x) => x.id === p.font) ?? FONTS[0];
  return { family: f.family, italic: f.italic };
}
