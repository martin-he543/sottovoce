import { useCallback, useEffect, useRef, useState } from 'react';

/** What the app knows about the work being heard, sent along to steady the transcription. */
export interface ListenSubject {
  title: string;
  composer?: string;
  venue?: string;
  language?: string;
  lead?: string;
  synopsis?: string;
}

/** One moment of the performance as heard: what was sung, in English, and what it means. */
export interface Heard {
  id: number;
  text: string;
  translation: string;
  explanation: string;
  where: string;
  confidence: number;
  /** The libretto line it was matched to, when the work has one. */
  line: number | null;
}

export type ListenState = 'idle' | 'starting' | 'listening' | 'error';

interface Options {
  subject: ListenSubject | null;
  /** The libretto, when the work has a synced one. */
  lines?: { original_text: string }[];
  lineIdx: number;
  onLine: (idx: number) => void;
}

/** Seconds of audio per clip sent to the server. Long enough to carry a phrase, short enough to feel live. */
const CLIP_MS = 2500;

interface Run {
  stream: MediaStream;
  audio: AudioContext | null;
  meter: number | null;
  recorder: MediaRecorder | null;
  timer: number | null;
  on: boolean;
}

const pickMime = () =>
  typeof MediaRecorder.isTypeSupported === 'function'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m))
    : undefined;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export const listeningSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/**
 * Audio recognition for Immerse. While on, the microphone is cut into short clips that Argon (the server) transcribes,
 * translates and explains. For a work with a synced libretto, Argon also says which line it heard, and that alone
 * moves the text: forward only, and never behind the last place the reader confirmed with Correct sync.
 */
export function useLiveListener({ subject, lines, lineIdx, onLine }: Options) {
  const [state, setState] = useState<ListenState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<Heard[]>([]);
  /** False once the server says it has no AI: nothing can be heard then. */
  const [aiOn, setAiOn] = useState(true);
  const [busy, setBusy] = useState(false);
  /** How loud the room is, 0–1, so the Listen button can show it is hearing something. */
  const [level, setLevel] = useState(0);
  /** When the last line was placed from what was heard. */
  const [synced, setSynced] = useState<{ line: number; at: number; via: 'argon' | 'correct' } | null>(null);

  // The latest props, read from the long-lived listeners without re-subscribing the microphone.
  const live = useRef({ subject, lines, lineIdx, onLine });
  live.current = { subject, lines, lineIdx, onLine };
  const run = useRef<Run | null>(null);
  /** Bumped by every stop, so a start still waiting on the permission prompt knows it was called off. */
  const gen = useRef(0);
  const seq = useRef(0);
  const last = useRef('');

  /** A far-ahead place heard once, waiting for a second sighting before the reader is moved there. */
  const pending = useRef<{ line: number; at: number } | null>(null);
  /** Where the latest hearing says the performance is, when it is ahead but not trusted enough to move the reader. */
  const [guess, setGuessState] = useState<number | null>(null);
  const guessRef = useRef<number | null>(null);
  const setGuess = useCallback((g: number | null) => {
    guessRef.current = g;
    setGuessState(g);
  }, []);
  /** The place the reader last confirmed with Correct sync: Argon never moves the reader behind it. */
  const floor = useRef(0);
  /** Places Argon chose that the reader then corrected away from, kept out until the performance gets there by itself. */
  const rejected = useRef<number[]>([]);
  /** Bumped by Correct sync, so replies to clips heard before the correction are thrown away. */
  const epoch = useRef(0);

  /**
   * Moves the reader to Argon's `line`. A performance only goes forward, so anything behind the current place (a
   * refrain, a misheard word, an old wrong guess) is ignored. A short step ahead just goes; a long leap ahead has to be
   * heard twice, or be heard with near certainty, first.
   */
  const place = useCallback((line: number, strength: number) => {
    const { lineIdx: at, onLine: set } = live.current;
    const d = line - at;
    if (d <= 0 || line < floor.current) return d === 0;
    // A place that was corrected away from stays out unless it is the very next stretch of the performance.
    if (d > 3 && rejected.current.some((r) => Math.abs(r - line) <= 2)) return false;
    const commit = () => {
      pending.current = null;
      setGuess(null);
      set(line);
      setSynced({ line, at: Date.now(), via: 'argon' });
      return true;
    };
    if (d <= 10) return commit();
    setGuess(line);
    const p = pending.current;
    if (p && Date.now() - p.at < 25000 && Math.abs(p.line - line) <= 3) return commit();
    if (strength >= 0.95) return commit();
    pending.current = { line, at: Date.now() };
    return false;
  }, [setGuess]);

  /** Clips awaiting a reply; when the server falls behind, new clips are dropped rather than queued up stale. */
  const inFlight = useRef(0);

  /** Translation and explanation, from the words alone, filled in after the place has already moved. */
  const enrich = useCallback(async (id: number, transcript: string) => {
    const { subject: s } = live.current;
    if (!s) return;
    try {
      const res = await fetch('/api/live/listen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript, work: s }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setHeard((h) =>
        h.map((x) =>
          x.id === id
            ? { ...x, translation: String(data.translation ?? ''), explanation: String(data.explanation ?? ''), where: String(data.where_in_story ?? '') }
            : x
        )
      );
    } catch {
      /* the transcript stands without its gloss */
    }
  }, []);

  const send = useCallback(
    async (body: { audio: string; mimeType?: string }) => {
      const { subject: s, lines: ls, lineIdx: at } = live.current;
      if (!s || inFlight.current >= 2) return;
      const mine = epoch.current;
      // Only the text from the place onwards: behind it is never where the performance is.
      const from = Math.max(floor.current, at - 1, 0);
      inFlight.current++;
      setBusy(true);
      try {
        const res = await fetch('/api/live/listen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            fast: true,
            work: { title: s.title, language: s.language },
            // The text from the place to well after it, numbered, for Argon to say which line it heard.
            candidates: ls?.slice(from, at + 30).map((l, k) => ({ i: from + k, text: l.original_text })),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setAiOn(data.ai !== false);
        const transcript = String(data.transcript ?? '').trim();
        if (data.instrumental || !transcript || transcript === last.current) return;
        last.current = transcript;
        // Heard before the reader corrected the place: it describes a moment that is already settled.
        const stale = mine !== epoch.current;
        // Argon's own placement among the numbered lines, and only a reasonably sure one, moves the place.
        let line: number | null = null;
        const sure = Number(data.confidence ?? 0);
        if (!stale && Number.isInteger(data.line) && ls && data.line >= 0 && data.line < ls.length && sure >= 0.35) {
          line = place(data.line as number, sure) ? (data.line as number) : null;
        }
        const id = ++seq.current;
        setHeard((h) => [{ id, text: transcript, translation: '', explanation: '', where: '', confidence: sure, line }, ...h].slice(0, 30));
        void enrich(id, transcript);
      } catch {
        /* offline: the next clip tries again */
      } finally {
        inFlight.current--;
        setBusy(inFlight.current > 0);
      }
    },
    [place, enrich]
  );

  /** Takes Argon's latest far-ahead hearing at its word: for when the room has moved on further than the reader. */
  const jump = useCallback(() => {
    const g = guessRef.current;
    if (g == null) return;
    pending.current = null;
    setGuess(null);
    live.current.onLine(g);
    setSynced({ line: g, at: Date.now(), via: 'argon' });
  }, [setGuess]);

  /**
   * The reader says the current line is where the performance is. Argon's earlier placement, if it was somewhere else,
   * is remembered as wrong; nothing behind this line is followed again, and replies to clips already sent are dropped.
   */
  const correct = useCallback(() => {
    const at = live.current.lineIdx;
    const wrong = [synced?.line, guessRef.current, pending.current?.line].filter((x): x is number => x != null && Math.abs(x - at) > 2);
    rejected.current = [...rejected.current.filter((r) => r > at), ...wrong.filter((r) => r > at)].slice(-12);
    floor.current = at;
    epoch.current++;
    pending.current = null;
    last.current = '';
    setGuess(null);
    setSynced({ line: at, at: Date.now(), via: 'correct' });
  }, [synced, setGuess]);

  const stop = useCallback(() => {
    gen.current++;
    const r = run.current;
    run.current = null;
    if (r) {
      r.on = false;
      if (r.timer) window.clearTimeout(r.timer);
      try {
        r.recorder?.state !== 'inactive' && r.recorder?.stop();
      } catch {
        /* already stopped */
      }
      r.stream.getTracks().forEach((t) => t.stop());
      if (r.meter) cancelAnimationFrame(r.meter);
      r.audio?.close().catch(() => {});
    }
    setLevel(0);
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (run.current) return;
    const mine = ++gen.current;
    setError(null);
    setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    } catch (e) {
      if (mine !== gen.current) return;
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'Microphone access was blocked. Allow it for this site and try again.' : 'No microphone found.');
      setState('error');
      return;
    }
    // Stopped, switched work or left the page while the permission prompt was up: let the microphone go.
    if (mine !== gen.current || run.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const r: Run = { stream, audio: null, meter: null, recorder: null, timer: null, on: true };
    run.current = r;

    // A level meter: the loudness of the room, about ten times a second.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let lastPaint = 0;
      const tick = (now: number) => {
        if (!r.on) return;
        if (now - lastPaint > 100) {
          lastPaint = now;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        }
        r.meter = requestAnimationFrame(tick);
      };
      r.audio = ctx;
      r.meter = requestAnimationFrame(tick);
    } catch {
      /* no Web Audio: no meter */
    }

    // Cut the stream into self-contained clips: stop and restart the recorder so each blob is a playable file.
    const mimeType = pickMime();
    const clip = () => {
      if (!r.on) return;
      const chunks: Blob[] = [];
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        // No recorder for this stream: nothing to send Argon.
        r.recorder = null;
        return;
      }
      r.recorder = rec;
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (r.on) clip();
        // A hidden tab or a near-empty clip (silence) is not worth a round trip.
        if (blob.size > 4000 && document.visibilityState === 'visible') {
          toBase64(blob)
            .then((audio) => send({ audio, mimeType: blob.type }))
            .catch(() => {});
        }
      };
      try {
        rec.start();
      } catch {
        r.recorder = null;
        return;
      }
      r.timer = window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), CLIP_MS);
    };
    clip();

    if (!r.recorder) {
      stop();
      setError('This browser can’t record from the microphone.');
      setState('error');
      return;
    }
    setState('listening');
  }, [send, stop]);

  // Never leave the microphone open behind a page change.
  useEffect(() => stop, [stop]);

  // Switching to another work starts a fresh transcript.
  const title = subject?.title;
  useEffect(() => {
    setHeard([]);
    setSynced(null);
    last.current = '';
    pending.current = null;
    floor.current = 0;
    rejected.current = [];
    epoch.current++;
  }, [title]);

  return { state, error, heard, busy, aiOn, level, synced, guess, jump, correct, start, stop, supported: listeningSupported() };
}
