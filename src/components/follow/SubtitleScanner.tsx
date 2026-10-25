import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageUp, ScanText, X } from 'lucide-react';
import type { Theme } from './prefs';

const OCR_LANG: Record<string, string> = {
  italian: 'ita',
  french: 'fra',
  german: 'deu',
  english: 'eng',
  spanish: 'spa',
  russian: 'rus',
  czech: 'ces',
  latin: 'lat',
};

type OcrWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

interface Props {
  theme: Theme;
  /** The work's language, which picks the OCR model. */
  language?: string;
  /** Called with each reading; the reader decides what to do with it (jump, or add it as a line). */
  onRead: (text: string, confidence: number, auto: boolean) => void;
  onClose: () => void;
}

const AUTO_MS = 2800;

/**
 * Point the camera at the surtitles or a printed libretto, zoom to the band that holds the words, and read it.
 * Recognition runs in the browser (Tesseract); each reading goes to `onRead`, which finds the place in the work.
 */
export const SubtitleScanner: React.FC<Props> = ({ theme: t, language, onRead, onClose }) => {
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLImageElement | null>(null);
  const worker = useRef<OcrWorker | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const busy = useRef(false);
  const [camera, setCamera] = useState<'idle' | 'on' | 'error'>('idle');
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [top, setTop] = useState(0.62);
  const [height, setHeight] = useState(0.3);
  const [invert, setInvert] = useState(true);
  const [auto, setAuto] = useState(false);
  const [reading, setReading] = useState(false);
  const [last, setLast] = useState<{ text: string; confidence: number } | null>(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    video.current?.srcObject && (video.current.srcObject as MediaStream).getTracks().forEach((x) => x.stop());
    track.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError('');
    setPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } });
      const tr = stream.getVideoTracks()[0];
      track.current = tr;
      const caps = (tr.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
      setHwZoom(caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null);
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
      }
      setCamera('on');
    } catch {
      setCamera('error');
      setError('The camera could not be opened. You can still read from a photo.');
    }
  }, []);

  useEffect(
    () => () => {
      stopCamera();
      worker.current?.terminate().catch(() => {});
      worker.current = null;
    },
    [stopCamera]
  );

  const setZoomLevel = (z: number) => {
    setZoom(z);
    if (hwZoom && track.current) {
      (track.current.applyConstraints as (c: unknown) => Promise<void>)({ advanced: [{ zoom: z }] }).catch(() => {});
    }
  };

  /** The band the person framed, upscaled and cleaned up for the recogniser. */
  const grab = (): HTMLCanvasElement | null => {
    const src = photo ? still.current : video.current;
    const w = photo ? still.current?.naturalWidth : video.current?.videoWidth;
    const h = photo ? still.current?.naturalHeight : video.current?.videoHeight;
    if (!src || !w || !h) return null;
    // Digital zoom crops the middle of the frame; hardware zoom has already done it.
    const dz = hwZoom && !photo ? 1 : zoom;
    const vw = w / dz;
    const vh = h / dz;
    const vx = (w - vw) / 2;
    const vy = (h - vh) / 2;
    const sy = vy + vh * top;
    const sh = Math.max(8, vh * height);
    const scale = Math.min(3, 1800 / vw);
    const c = document.createElement('canvas');
    c.width = Math.round(vw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.filter = `grayscale(1) ${invert ? 'invert(1) ' : ''}contrast(1.6)`;
    ctx.drawImage(src, vx, sy, vw, sh, 0, 0, c.width, c.height);
    return c;
  };

  const read = useCallback(
    async (isAuto: boolean) => {
      if (busy.current) return;
      const canvas = grab();
      if (!canvas) {
        if (!isAuto) setError('Nothing to read yet: start the camera or choose a photo.');
        return;
      }
      busy.current = true;
      setReading(true);
      setError('');
      try {
        if (!worker.current) {
          const { createWorker } = await import('tesseract.js');
          const code = OCR_LANG[(language ?? 'english').toLowerCase().split(/[,\s/]/)[0]] ?? 'eng';
          worker.current = (await createWorker(code)) as unknown as OcrWorker;
        }
        const { data } = await worker.current.recognize(canvas);
        const text = data.text.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && data.confidence >= 35) {
          setLast({ text, confidence: data.confidence });
          onRead(text, data.confidence, isAuto);
        } else if (!isAuto) {
          setError('No clear words in that band. Zoom in and line the band up with the text.');
        }
      } catch {
        setError('Reading failed. The text recogniser may not have loaded; check the connection and try again.');
        setAuto(false);
      } finally {
        busy.current = false;
        setReading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, onRead, photo, zoom, top, height, invert, hwZoom]
  );

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => read(true), AUTO_MS);
    return () => window.clearInterval(id);
  }, [auto, read]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    stopCamera();
    setCamera('idle');
    setAuto(false);
    setPhoto(URL.createObjectURL(f));
  };

  const chipCls = 'px-3 py-1.5 rounded-full border font-mono text-[11px] uppercase tracking-wider cursor-pointer flex items-center gap-1.5';
  const chip = (on: boolean): React.CSSProperties => ({ borderColor: on ? t.gold : t.hair, color: on ? t.gold : t.dim });
  const slider = (label: string, v: number, min: number, max: number, step: number, set: (n: number) => void) => (
    <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: t.dim }}>
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="flex-1" style={{ accentColor: t.accent }} />
    </label>
  );

  // The band, drawn over the visible (zoomed) part of the picture.
  const dz = hwZoom ? 1 : zoom;

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ backgroundColor: t.bg, color: t.ink }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: t.hair }}>
        <div>
          <p className="font-instrument italic text-xl">Read the subtitles</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: t.dim }}>
            Zoom to the words, then read once or keep reading
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="p-2 rounded-full cursor-pointer" style={{ color: t.dim }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 max-w-2xl w-full mx-auto">
        <div className="relative w-full overflow-hidden rounded-xl border" style={{ borderColor: t.hair, backgroundColor: '#000', aspectRatio: '16 / 9' }}>
          {photo && (
            <img
              ref={still}
              src={photo}
              alt="Photo to read"
              className="absolute inset-0 w-full h-full object-contain"
              style={{ transform: `scale(${zoom})` }}
            />
          )}
          {/* Always mounted, so a stream started after a photo has somewhere to go. */}
          <video
            ref={video}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: hwZoom ? undefined : `scale(${dz})`, display: camera === 'on' && !photo ? 'block' : 'none' }}
          />
          {camera !== 'on' && !photo && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xs" style={{ color: t.dim }}>
              {camera === 'error' ? 'Camera unavailable' : 'Camera off'}
            </div>
          )}
          <div
            className="absolute left-0 right-0 border-y-2 pointer-events-none"
            style={{ top: `${top * 100}%`, height: `${height * 100}%`, borderColor: t.accent, backgroundColor: 'rgba(255,255,255,0.06)' }}
          />
        </div>

        <div className="space-y-2">
          {slider('Zoom', zoom, hwZoom?.min ?? 1, hwZoom?.max ?? 4, 0.1, setZoomLevel)}
          {slider('Band at', top, 0, 0.9, 0.01, (n) => setTop(Math.min(n, 1 - height)))}
          {slider('Height', height, 0.06, 0.6, 0.01, (n) => {
            setHeight(n);
            setTop((p) => Math.min(p, 1 - n));
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={chipCls} style={chip(camera === 'on')} onClick={camera === 'on' ? () => (stopCamera(), setCamera('idle')) : startCamera}>
            <Camera className="w-3.5 h-3.5" /> {camera === 'on' ? 'Camera off' : 'Camera'}
          </button>
          <label className={chipCls} style={chip(!!photo)}>
            <ImageUp className="w-3.5 h-3.5" /> Photo
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button type="button" className={chipCls} style={chip(invert)} onClick={() => setInvert((v) => !v)} aria-pressed={invert} title="Pale words on a dark background">
            Pale on dark
          </button>
          <button type="button" className={chipCls} style={chip(auto)} onClick={() => setAuto((v) => !v)} aria-pressed={auto}>
            Keep reading
          </button>
          <button
            type="button"
            className={`${chipCls} ml-auto`}
            style={{ borderColor: t.accent, color: t.accent }}
            onClick={() => read(false)}
            disabled={reading}
          >
            <ScanText className="w-3.5 h-3.5" /> {reading ? 'Reading…' : 'Read'}
          </button>
        </div>

        {error && (
          <p className="text-sm font-fraunces" style={{ color: t.accent }}>
            {error}
          </p>
        )}
        {last && (
          <div className="border-t pt-3 space-y-1" style={{ borderColor: t.hair }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: t.dim }}>
              Read ({Math.round(last.confidence)}% sure)
            </p>
            <p className="font-fraunces text-base leading-relaxed">{last.text}</p>
          </div>
        )}
      </div>
    </div>
  );
};
