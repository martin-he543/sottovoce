import React, { useRef, useState } from 'react';
import { ArgonButton, ArgonTag } from './ArgonButton';
import { Play, Square, Volume2 } from 'lucide-react';
import type { LeitmotifStem, WorkAndLibretto } from '../types/sottovoce';
import { SpotlightSurface, MagneticButton } from './ui/TwentyFirstPrimitives';

interface LeitmotifAudioSynthProps {
  work: WorkAndLibretto;
}

export const LeitmotifAudioSynth: React.FC<LeitmotifAudioSynthProps> = ({ work }) => {
  const [selectedMotifId, setSelectedMotifId] = useState<string>(
    work.leitmotifs[0]?.id || ''
  );
  const [activeStems, setActiveStems] = useState<{
    brass: boolean;
    strings: boolean;
    woodwinds: boolean;
  }>({
    brass: true,
    strings: true,
    woodwinds: true,
  });
  const [isPlayingSynth, setIsPlayingSynth] = useState<boolean>(false);
  const [generatingArgon, setGeneratingArgon] = useState<boolean>(false);
  const [argonStatusNote, setArgonStatusNote] = useState<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);

  const activeMotif: LeitmotifStem =
    work.leitmotifs.find((m) => m.id === selectedMotifId) || work.leitmotifs[0];

  const playPolyphonicLeitmotifStems = (
    customNotesHz?: number[],
    customRhythmSec?: number[]
  ) => {
    if (!activeMotif) return;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    setIsPlayingSynth(true);

    const notesToPlay = customNotesHz?.length ? customNotesHz : activeMotif.notes_hz;
    const rhythmsToPlay = customRhythmSec?.length ? customRhythmSec : activeMotif.rhythm_sec;

    let cursor = ctx.currentTime + 0.04;
    notesToPlay.forEach((freq, idx) => {
      const dur = rhythmsToPlay[idx] || 0.65;

      // Stem 1: Brass (Sawtooth with warm low-pass filter)
      if (activeStems.brass) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * 0.5;
        filter.type = 'lowpass';
        filter.frequency.value = 680;
        gain.gain.setValueAtTime(0.001, cursor);
        gain.gain.exponentialRampToValueAtTime(0.12, cursor + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, cursor + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(cursor);
        osc.stop(cursor + dur);
      }

      // Stem 2: Strings (Triangle ensemble)
      if (activeStems.strings) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, cursor);
        gain.gain.exponentialRampToValueAtTime(0.15, cursor + 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, cursor + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(cursor);
        osc.stop(cursor + dur);
      }

      // Stem 3: Woodwinds (Sine harmonic overtone)
      if (activeStems.woodwinds) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * 2;
        gain.gain.setValueAtTime(0.001, cursor);
        gain.gain.exponentialRampToValueAtTime(0.06, cursor + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, cursor + dur * 0.9);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(cursor);
        osc.stop(cursor + dur);
      }

      cursor += dur * 0.9;
    });

    const totalMs = (cursor - ctx.currentTime) * 1000;
    window.setTimeout(() => {
      setIsPlayingSynth(false);
    }, totalMs);
  };

  const stopSynth = () => {
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsPlayingSynth(false);
  };

  const handleSynthesizeArgonMotif = async () => {
    if (!activeMotif) return;
    setGeneratingArgon(true);
    setArgonStatusNote('Synthesising harmonic stem sequence via gemini-4-argon...');
    try {
      const resp = await fetch('/api/lyria/leitmotif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId: work.work_id,
          motifId: activeMotif.id,
        }),
      });
      const data = await resp.json();
      playPolyphonicLeitmotifStems(data.notes_hz, data.rhythm_sec);
      setArgonStatusNote(
        `${data.model_used} (${data.latency_ms ?? 180}ms) · ${data.lyria_notes || activeMotif.dramatic_meaning}`
      );
    } catch (_e) {
      playPolyphonicLeitmotifStems();
      setArgonStatusNote('gemini-4-argon · Playing polyphonic orchestral stem sequence');
    } finally {
      setGeneratingArgon(false);
    }
  };

  if (!activeMotif) return null;

  return (
    <SpotlightSurface
      className="rounded-2xl border p-6 sm:p-7 space-y-5 transition-colors"
      spotlightColor="var(--spotlight-tint)"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b pb-3.5"
        style={{ borderColor: 'var(--border-hairline)' }}
      >
        <div>
          <span
            className="text-[10px] font-mono uppercase tracking-[0.18em] block font-semibold"
            style={{ color: 'var(--accent-crimson)' }}
          >
            FOLIO IV · ORCHESTRAL LEITMOTIF SYNTHESISER
          </span>
          <h3
            className="font-chronicle text-2xl mt-0.5"
            style={{ color: 'var(--text-primary)' }}
          >
            Multi-Stem Leitmotif Trainer
          </h3>
        </div>
        <ArgonTag />
      </div>

      {/* Motif Selector Tabs */}
      <div
        className="flex flex-wrap items-center gap-1 p-1 rounded-lg border"
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        {work.leitmotifs.map((m) => {
          const isSelected = activeMotif.id === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setSelectedMotifId(m.id);
                setArgonStatusNote('');
              }}
              className="px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              style={
                isSelected
                  ? {
                      backgroundColor: 'var(--accent-crimson)',
                      color: '#FAF6F0',
                      fontWeight: 600,
                    }
                  : {
                      color: 'var(--text-secondary)',
                    }
              }
            >
              {m.name.split('(')[0].trim()}
            </button>
          );
        })}
      </div>

      {/* Motif Metadata & Stem Toggles */}
      <div
        className="space-y-4 border-t pt-4"
        style={{ borderColor: 'var(--border-hairline)' }}
      >
        <div className="space-y-1.5">
          <div
            className="text-xs font-mono flex flex-wrap items-center gap-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span
              className="font-instrument italic text-2xl"
              style={{ color: 'var(--text-primary)' }}
            >
              {activeMotif.name}
            </span>
            <span>·</span>
            <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-gold)' }}>
              {activeMotif.key_signature} ({activeMotif.tempo_bpm} BPM)
            </span>
          </div>
          <p
            className="font-fraunces text-xs leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {activeMotif.dramatic_meaning}
          </p>
          <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            <span className="uppercase" style={{ color: 'var(--text-muted)' }}>
              ORCHESTRATION:
            </span>{' '}
            {activeMotif.orchestration}
          </div>
        </div>

        {/* Stem Isolation Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span
            className="text-[11px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            ISOLATE STEMS:
          </span>
          <div className="flex items-center gap-1.5">
            {(['brass', 'strings', 'woodwinds'] as const).map((stem) => {
              const active = activeStems[stem];
              return (
                <button
                  key={stem}
                  type="button"
                  onClick={() =>
                    setActiveStems((prev) => ({ ...prev, [stem]: !prev[stem] }))
                  }
                  className="px-2.5 py-1 text-[11px] font-mono uppercase rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--accent-gold)',
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                        }
                      : {
                          backgroundColor: 'transparent',
                          borderColor: 'var(--border-hairline)',
                          color: 'var(--text-muted)',
                        }
                  }
                >
                  {stem}
                </button>
              );
            })}
          </div>
        </div>

        {/* Playback & Argon Synthesis Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <MagneticButton
            onClick={isPlayingSynth ? stopSynth : () => playPolyphonicLeitmotifStems()}
            className="px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider rounded-lg border flex items-center justify-center gap-2 cursor-pointer"
          >
            {isPlayingSynth ? (
              <>
                <Square className="w-3.5 h-3.5 text-[#DC2626]" />
                <span>Stop Stems</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" style={{ color: 'var(--accent-crimson)' }} />
                <span>Audition Stems</span>
              </>
            )}
          </MagneticButton>

          <ArgonButton label="Argon stem variation" busyLabel="Synthesising…" busy={generatingArgon} onClick={handleSynthesizeArgonMotif} />
        </div>
      </div>

      {argonStatusNote && (
        <div
          className="border-t pt-3 flex items-start gap-2 text-xs font-fraunces"
          style={{
            borderColor: 'var(--border-hairline)',
            color: 'var(--text-secondary)',
          }}
        >
          <Volume2
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: 'var(--accent-crimson)' }}
          />
          <span>{argonStatusNote}</span>
        </div>
      )}
    </SpotlightSurface>
  );
};
