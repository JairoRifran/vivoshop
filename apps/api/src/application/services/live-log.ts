import { Logger } from '@nestjs/common';

/**
 * One structured line per live event.
 *
 * A broadcast that goes wrong is reported as "no se veía nada", hours later,
 * with no reproduction. The only way to answer that is a log you can filter by
 * session, so every line carries the same shape: an event name, the session,
 * and a small bag of scalars.
 *
 * ## What must never appear here
 *
 * A JWT — ours or the provider's. A provider API secret. A full session token.
 * A raw viewer key (it contains an IP and a user agent). Logs are copied into
 * tickets and pasted into chats; anything in them should be safe there.
 *
 * `redact` is the enforcement, not the convention: fields whose name looks
 * like a credential are dropped rather than trusted to be absent.
 */
const FORBIDDEN = /token|secret|authorization|password|jwt|credential|apikey|api_key/i;

/** Anything longer than this is not a scalar we meant to log. */
const MAX_VALUE_LENGTH = 120;

export type LiveLogEvent =
  | 'live.created'
  | 'live.starting'
  | 'live.started'
  | 'live.start_failed'
  | 'live.interrupted'
  | 'live.resumed'
  | 'live.ending'
  | 'live.ended'
  | 'live.cancelled'
  | 'live.abandoned'
  | 'live.credentials_issued'
  | 'live.credentials_denied'
  | 'live.featured';

export class LiveLogger {
  private readonly logger = new Logger('Live');

  log(event: LiveLogEvent, liveSessionId: string, fields: Record<string, unknown> = {}): void {
    this.logger.log(this.line(event, liveSessionId, fields));
  }

  warn(event: LiveLogEvent, liveSessionId: string, fields: Record<string, unknown> = {}): void {
    this.logger.warn(this.line(event, liveSessionId, fields));
  }

  private line(event: string, liveSessionId: string, fields: Record<string, unknown>): string {
    const parts = [`event=${event}`, `session=${liveSessionId}`];
    for (const [key, value] of Object.entries(redact(fields))) {
      parts.push(`${key}=${value}`);
    }
    return parts.join(' ');
  }
}

/** Exported for the test that proves a token cannot get into a log line. */
export function redact(fields: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if (value === null || value === undefined) continue;

    const text = String(value);
    safe[key] = text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
  }

  return safe;
}
