'use client';

import type { LiveMessageDto } from '@vivo/shared';
import { cn } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Chat overlay.
 *
 * Only the last few messages are rendered, fading toward the top, because the
 * chat sits over the video and must never become a wall of text that hides the
 * product. Scrolling is still possible for anyone who wants the history.
 */
export function LiveChatOverlay({ messages }: { messages: LiveMessageDto[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const visible = messages.slice(-14);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Only auto-scroll when the reader is already at the bottom, so reading
    // history is not yanked away by an incoming message.
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  return (
    <ul
      ref={listRef}
      aria-label="Comentarios en vivo"
      aria-live="polite"
      className={cn(
        'no-scrollbar flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-16',
        '[mask-image:linear-gradient(to_bottom,transparent,black_28%)]',
      )}
    >
      {visible.map((message) => (
        <li
          key={message.id}
          className="flex animate-rise items-start gap-2 motion-reduce:animate-none"
        >
          <span className="mt-0.5 shrink-0 text-[13px] font-bold text-white/70">
            {message.authorName.split(' ')[0]}
          </span>
          <span className="text-pretty text-[13px] leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            {message.body}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ChatSendResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
}

/**
 * The composer.
 *
 * Messages go over the realtime channel rather than a server action, because
 * a comment that appears two seconds after you typed it does not feel like a
 * conversation. The server still owns everything that matters: it derives the
 * author from the handshake token, rate limits, sanitises, persists, and only
 * then broadcasts — nothing the browser sends is trusted as-is.
 */
export function LiveChatComposer({
  liveSessionId,
  signedIn,
  send,
  connected = true,
  onSent,
}: {
  liveSessionId: string;
  signedIn: boolean;
  send: (body: string) => Promise<ChatSendResult>;
  connected?: boolean;
  onSent?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Counts down after a rate limit so the button explains itself. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = value.trim();
    if (!body || cooldown > 0 || !connected) return;

    if (!signedIn) {
      router.push(`/ingresar?next=${encodeURIComponent(`/live/${liveSessionId}`)}`);
      return;
    }

    setValue('');
    setError(null);
    startTransition(async () => {
      const result = await send(body);
      if (result.ok) {
        onSent?.();
        return;
      }

      if (result.error === 'RATE_LIMITED') {
        setCooldown(result.retryAfterSeconds ?? 2);
        setError('Esperá un momento antes de seguir comentando.');
      } else {
        setError('No pudimos enviar tu mensaje. Reintentá.');
      }
      setValue(body);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      {/* Visible, not just announced: a comment that silently failed to send
          is the worst outcome — the buyer thinks the seller ignored them. */}
      {error ? (
        <p role="alert" className="px-3 text-[12px] font-semibold text-white/85">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <label htmlFor="mensaje" className="sr-only">
          Escribir un comentario
        </label>
        <input
          id="mensaje"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={240}
          enterKeyHint="send"
          autoComplete="off"
          placeholder={
            !connected
              ? 'Reconectando…'
              : cooldown > 0
                ? `Esperá ${cooldown} s`
                : signedIn
                  ? 'Escribí un comentario…'
                  : 'Ingresá para comentar'
          }
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-11 min-w-0 flex-1 rounded-full border border-white/20 bg-black/45 px-4 text-[16px] text-white backdrop-blur-md',
            'placeholder:text-white/50 focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/25',
          )}
        />
        <button
          type="submit"
          disabled={pending || cooldown > 0 || !connected || value.trim().length === 0}
          aria-label="Enviar comentario"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-ink transition-opacity disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  );
}
