import React from 'react';
import { X } from 'lucide-react';
import { FONTS, THEMES, type FollowPrefs, type Theme } from './prefs';

interface Props {
  theme: Theme;
  prefs: FollowPrefs;
  set: (p: Partial<FollowPrefs>) => void;
  onClose: () => void;
}

/** Appearance and reading mode: theme, font, size, scroll or tap, vertical or horizontal, and what to show. */
export const SettingsPanel: React.FC<Props> = ({ theme: t, prefs, set, onClose }) => {
  const chip = (on: boolean): React.CSSProperties => ({ borderColor: on ? t.gold : t.hair, color: on ? t.gold : t.dim });
  const cls = 'px-3 py-1.5 rounded-full border font-mono text-[11px] uppercase tracking-wider cursor-pointer';
  const head = (s: string) => (
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-1.5" style={{ color: t.dim }}>
      {s}
    </p>
  );
  const toggle = (label: string, key: 'original' | 'translation' | 'explanation' | 'names' | 'focus' | 'chat') => (
    <button type="button" aria-pressed={prefs[key]} className={cls} style={chip(prefs[key])} onClick={() => set({ [key]: !prefs[key] })}>
      {label}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-label="Reading settings"
      className="absolute right-3 top-2 z-20 w-[min(22rem,calc(100%-1.5rem))] max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border p-4 space-y-4 shadow-2xl"
      style={{ backgroundColor: t.panel, borderColor: t.hair, color: t.ink }}
    >
      <div className="flex items-center justify-between">
        <p className="font-instrument italic text-lg">Reading</p>
        <button type="button" onClick={onClose} aria-label="Close settings" className="p-1 cursor-pointer" style={{ color: t.dim }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        {head('Mode')}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cls} style={chip(prefs.layout === 'scroll')} onClick={() => set({ layout: 'scroll' })}>
            Continuous scroll
          </button>
          <button type="button" className={cls} style={chip(prefs.layout === 'tap')} onClick={() => set({ layout: 'tap' })}>
            Tap through
          </button>
        </div>
      </div>

      <div>
        {head('Direction')}
        <div className="flex gap-2">
          <button type="button" className={cls} style={chip(prefs.axis === 'vertical')} onClick={() => set({ axis: 'vertical' })}>
            Vertical
          </button>
          <button type="button" className={cls} style={chip(prefs.axis === 'horizontal')} onClick={() => set({ axis: 'horizontal' })}>
            Horizontal
          </button>
        </div>
      </div>

      <div>
        {head('Theme')}
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((th) => (
            <button
              key={th.id}
              type="button"
              aria-pressed={prefs.theme === th.id}
              onClick={() => set({ theme: th.id })}
              className="rounded-lg border px-2 py-2 text-left cursor-pointer"
              style={{ backgroundColor: th.bg, borderColor: prefs.theme === th.id ? t.gold : t.hair, color: th.ink }}
            >
              <span className="block font-instrument italic text-base leading-none">Aa</span>
              <span className="block font-mono text-[9px] uppercase tracking-wider mt-1 truncate" style={{ color: th.accent }}>
                {th.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        {head('Font')}
        <div className="flex flex-wrap gap-2">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={!prefs.customFont && prefs.font === f.id}
              className={cls}
              style={{ ...chip(!prefs.customFont && prefs.font === f.id), fontFamily: f.family }}
              onClick={() => set({ font: f.id, customFont: '' })}
            >
              {f.name}
            </button>
          ))}
        </div>
        <input
          value={prefs.customFont}
          onChange={(e) => set({ customFont: e.target.value })}
          placeholder="Or any installed font, e.g. Garamond"
          aria-label="Custom font name"
          className="mt-2 w-full bg-transparent rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: t.hair, color: t.ink }}
        />
      </div>

      <div>
        {head(`Size · ${Math.round(prefs.size * 100)}%`)}
        <input
          type="range"
          min={0.7}
          max={1.8}
          step={0.05}
          value={prefs.size}
          onChange={(e) => set({ size: Number(e.target.value) })}
          aria-label="Text size"
          className="w-full"
          style={{ accentColor: t.accent }}
        />
      </div>

      <div>
        {head('Translation layout')}
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!prefs.sideBySide} className={cls} style={chip(!prefs.sideBySide)} onClick={() => set({ sideBySide: false })}>
            Stacked
          </button>
          <button type="button" aria-pressed={prefs.sideBySide} className={cls} style={chip(prefs.sideBySide)} onClick={() => set({ sideBySide: true })}>
            Side by side
          </button>
          {prefs.sideBySide && (
            <button
              type="button"
              className={cls}
              style={chip(false)}
              onClick={() => set({ englishSide: prefs.englishSide === 'right' ? 'left' : 'right' })}
              title="Swap the columns"
            >
              ⇄ English on the {prefs.englishSide}
            </button>
          )}
        </div>
      </div>

      <div>
        {head('Show')}
        <div className="flex flex-wrap gap-2">
          {toggle('Original', 'original')}
          {toggle('Translation', 'translation')}
          {toggle('Explanations', 'explanation')}
          {toggle('Who sings', 'names')}
          {toggle('Focus blur', 'focus')}
          {toggle('Argon sidebar', 'chat')}
        </div>
      </div>
    </div>
  );
};
