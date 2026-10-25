import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Navigation, RotateCcw, X } from 'lucide-react';
import { ArgonMark } from '../ArgonButton';
import type { ListenSubject } from '../useLiveListener';
import type { Theme } from './prefs';

export interface ChatMessage {
  id: number;
  role: 'user' | 'argon';
  text: string;
  /** Where Argon moved the reader, for going back there. */
  jump?: { id: string; label: string };
  error?: boolean;
  /** A question about one line of the work: the slide it came from, so the reader can click back to it. */
  line?: { slideId: string; who?: string };
  /** Live commentary rather than an answer: where it was said, and the place to go back to. */
  note?: { label: string; slideId?: string };
}

/** What the reader can tell Argon about where the listener is. */
export interface ChatContext {
  trail: string;
  lines: { who?: string; text: string; translation?: string }[];
  scenes: { id: string; title: string; note?: string; who?: string; lines: string[] }[];
}

/**
 * The conversation with Argon in Immerse: questions typed into the sidebar, or moments described in the contents box.
 * Each request carries the work and the reader's place, and an answer that names a scene moves the reader there.
 */
export function useArgonChat(subject: ListenSubject, context: () => ChatContext, onJump: (sectionId: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const live = useRef({ messages, subject, context, onJump });
  live.current = { messages, subject, context, onJump };

  // A new work starts a new conversation.
  useEffect(() => setMessages([]), [subject.title]);

  const ask = useCallback(async (text: string, line?: ChatMessage['line']) => {
    const q = text.trim();
    if (!q) return;
    const { subject: s, context: ctx, messages: before } = live.current;
    const mine: ChatMessage = { id: ++seq.current, role: 'user', text: q, line };
    setMessages((m) => [...m, mine]);
    setBusy(true);
    try {
      const where = ctx();
      const res = await fetch('/api/immerse/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...before.filter((m) => !m.error), mine].map((m) => ({ role: m.role, text: m.text })),
          work: { title: s.title, composer: s.composer, language: s.language, lead: s.lead, synopsis: s.synopsis },
          where: { trail: where.trail, lines: where.lines },
          scenes: where.scenes,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; jump?: string; jumpLabel?: string; error?: string };
      if (!res.ok || !data.reply) {
        const why = res.status === 501 ? 'Argon isn’t set up on this server (no Gemini key).' : data.error ? `Argon couldn’t answer: ${data.error}` : 'Argon couldn’t answer just now.';
        setMessages((m) => [...m, { id: ++seq.current, role: 'argon', text: why, error: true }]);
        return;
      }
      const jump = data.jump ? { id: data.jump, label: data.jumpLabel || 'that moment' } : undefined;
      setMessages((m) => [...m, { id: ++seq.current, role: 'argon', text: data.reply!, jump }]);
      if (jump) live.current.onJump(jump.id);
    } catch {
      setMessages((m) => [...m, { id: ++seq.current, role: 'argon', text: 'Couldn’t reach Argon. Check the connection and try again.', error: true }]);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Adds a commentary note without being asked. */
  const addNote = useCallback((text: string, note: NonNullable<ChatMessage['note']>, error?: boolean) => {
    setMessages((m) => [...m, { id: ++seq.current, role: 'argon', text, note, error }]);
  }, []);

  return { messages, busy, ask, addNote, clear: () => setMessages([]) };
}

interface Props {
  theme: Theme;
  title: string;
  messages: ChatMessage[];
  busy: boolean;
  onAsk: (text: string) => void;
  onJump: (sectionId: string) => void;
  /** Go back to the line a question was about. */
  onLine?: (slideId: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Live commentary: Argon adds a note every few lines. */
  commentary: boolean;
  commentaryBusy: boolean;
  onCommentary: (on: boolean) => void;
  /** Starting points for an empty conversation. */
  suggestions: string[];
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/** The Argon sidebar: the conversation, a box to ask anything, and suggestions to start from. */
export const ArgonChat: React.FC<Props> = ({ theme: t, title, messages, busy, onAsk, onJump, onLine, onClear, onClose, commentary, commentaryBusy, onCommentary, suggestions, inputRef }) => {
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);
  const send = () => {
    if (!draft.trim() || busy) return;
    onAsk(draft);
    setDraft('');
  };

  return (
    <section className="flex flex-col h-full min-h-0" aria-label="Ask Argon">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: t.hair }}>
        <span className={`argon-btn__mark ${busy ? 'argon-btn--busy' : ''}`} style={{ width: '1.4rem', height: '1.4rem' }}>
          <ArgonMark />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: t.gold }}>
            Ask Argon
          </p>
          <p className="text-[11px] truncate" style={{ color: t.dim }}>
            About {title}, or where you are in it
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={onClear} className="p-1.5 rounded-full cursor-pointer" style={{ color: t.dim }} aria-label="Start a new conversation" title="New conversation">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" onClick={onClose} className="p-1.5 rounded-full cursor-pointer" style={{ color: t.dim }} aria-label="Hide the Argon sidebar" title="Hide">
          <X className="w-4 h-4" />
        </button>
      </header>

      <button
        type="button"
        role="switch"
        aria-checked={commentary}
        onClick={() => onCommentary(!commentary)}
        className="flex items-center gap-3 px-3 py-2 border-b text-left cursor-pointer"
        style={{ borderColor: t.hair }}
        title="Argon adds a short note to this panel every few lines, and explains each line under the text"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm" style={{ color: t.ink }}>
            Live commentary
          </span>
          <span className="block text-[11px]" style={{ color: t.dim }}>
            {commentary ? (commentaryBusy ? 'Argon is writing a note…' : 'Notes here every few lines, and under each line') : 'Argon comments as you go'}
          </span>
        </span>
        <span className="relative shrink-0 w-9 h-5 rounded-full transition-colors" style={{ backgroundColor: commentary ? t.gold : t.hair }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ left: commentary ? '1.15rem' : '0.125rem', backgroundColor: commentary ? t.bg : t.dim }} />
        </span>
      </button>

      <div ref={list} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: t.dim }}>
              Ask anything: what’s happening, who someone is, what a line means, what to listen for. Describe a moment and Argon takes you
              there.
            </p>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onAsk(s)}
                  disabled={busy}
                  className="text-left text-sm px-3 py-2 rounded-lg border cursor-pointer disabled:opacity-50"
                  style={{ borderColor: t.hair, color: t.ink }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            m.line && onLine ? (
              <button
                key={m.id}
                type="button"
                onClick={() => onLine(m.line!.slideId)}
                className="block w-[calc(100%-1.5rem)] ml-6 px-3 py-2 rounded-2xl rounded-br-sm text-sm leading-relaxed text-left cursor-pointer border"
                style={{ backgroundColor: t.hair, color: t.ink, borderColor: 'transparent' }}
                title="Go back to this line"
              >
                {m.line.who && (
                  <span className="block font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: t.accent }}>
                    {m.line.who}
                  </span>
                )}
                <span className="italic">{m.text}</span>
                <span className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: t.gold }}>
                  <Navigation className="w-3 h-3" /> Go to this line
                </span>
              </button>
            ) : (
              <p key={m.id} className="ml-6 px-3 py-2 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap" style={{ backgroundColor: t.hair, color: t.ink }}>
                {m.text}
              </p>
            )
          ) : m.note ? (
            <div key={m.id} className="mr-2 pl-3 border-l-2 space-y-1" style={{ borderColor: t.gold }}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: t.gold }}>
                {m.note.slideId && onLine ? (
                  <button type="button" onClick={() => onLine(m.note!.slideId!)} className="uppercase tracking-[0.16em] cursor-pointer text-left" title="Go to this moment">
                    {m.note.label}
                  </button>
                ) : (
                  m.note.label
                )}
              </p>
              <p className="text-sm leading-relaxed italic" style={{ color: m.error ? t.accent : t.ink }}>
                {m.text}
              </p>
            </div>
          ) : (
            <div key={m.id} className="mr-2 space-y-1.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: m.error ? t.accent : t.ink }}>
                {m.text}
              </p>
              {m.jump && (
                <button
                  type="button"
                  onClick={() => onJump(m.jump!.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[10px] uppercase tracking-wider cursor-pointer"
                  style={{ borderColor: t.gold, color: t.gold }}
                  title="Go back to this moment"
                >
                  <Navigation className="w-3 h-3" /> {m.jump.label}
                </button>
              )}
            </div>
          )
        )}
        {busy && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] animate-pulse" style={{ color: t.dim }}>
            Argon is thinking…
          </p>
        )}
      </div>

      <form
        className="p-3 border-t"
        style={{ borderColor: t.hair }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border px-3 py-2" style={{ borderColor: t.hair }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(5, Math.max(1, draft.split('\n').length))}
            placeholder="Ask Argon anything…"
            aria-label="Ask Argon"
            className="flex-1 min-w-0 bg-transparent outline-none resize-none text-sm leading-relaxed"
            style={{ color: t.ink }}
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            className="shrink-0 p-1.5 rounded-lg cursor-pointer disabled:opacity-40"
            style={{ backgroundColor: t.gold, color: t.bg }}
            aria-label="Send"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </section>
  );
};
