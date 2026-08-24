import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO with the same origin allowlist as the REST surface.
 *
 * Nest's default adapter leaves CORS wide open, which would let any page on
 * the internet open a socket to this API and read a shop's chat. The handshake
 * is a separate HTTP request from the ones `app.enableCors` covers, so the
 * allowlist has to be repeated here — and it is derived from the same env
 * value, never hardcoded.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: unknown,
    private readonly origins: readonly string[],
  ) {
    super(app as never);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: [...this.origins],
        // No cookies on this channel: the client authenticates by putting its
        // bearer token in the handshake, which keeps CSRF off the table.
        credentials: false,
        methods: ['GET', 'POST'],
      },
    });
  }
}
