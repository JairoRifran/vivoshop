import { Logger } from '@nestjs/common';
import { DomainError } from '@vivo/domain';
import type { EmailProvider } from '../../application/ports/infrastructure';
import type { AppEnv } from '../../config/env';

/**
 * Escribe el correo en el log en vez de mandarlo.
 *
 * Es el driver de desarrollo, por lo mismo que `mock` en streaming y `fake` en
 * cobros: un clon del repositorio tiene que poder recorrer el restablecimiento
 * de contraseña entero sin que nadie contrate un servicio de correo. El enlace
 * aparece en la consola y se hace clic desde ahí.
 *
 * **Prohibido en producción**, y no por prolijidad. La pantalla dice "te
 * mandamos un email" y ningún email sale: alguien que perdió su contraseña se
 * queda esperando algo que nunca va a llegar, sin ningún error a la vista. Es
 * exactamente la clase de fallo silencioso que este proyecto ya pagó una vez.
 * `env.ts` corta el arranque.
 */
export class LogEmailProvider implements EmailProvider {
  readonly key = 'log';

  private readonly logger = new Logger(LogEmailProvider.name);

  /**
   * El último correo, en memoria.
   *
   * Existe para la suite de punta a punta: el enlace llega por correo y en una
   * prueba no hay buzón. Sin esto, el token que usa el navegador tendría que
   * inventarlo la prueba, y entonces no probaría el token real.
   *
   * Solo lo lee `TestingController`, que no existe fuera de `NODE_ENV=test`.
   */
  private last: { to: string; subject: string; text: string } | null = null;

  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    this.last = { to: input.to, subject: input.subject, text: input.text };
    this.logger.log(`\n--- correo para ${input.to} ---\n${input.subject}\n\n${input.text}\n---`);
  }

  lastEmail(): { to: string; subject: string; text: string } | null {
    return this.last;
  }
}

/**
 * El correo, por Resend.
 *
 * Se eligió por lo mismo que Supabase: una cuenta, una clave, y una API que
 * hace una cosa. Los servicios grandes de correo transaccional traen consolas,
 * plantillas y analítica que acá no se usan, y su configuración inicial pide
 * más de lo que este producto necesita hoy.
 *
 * Si mañana conviene mudarse, lo que cambia es este archivo.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly key = 'resend';

  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(env: AppEnv) {
    this.apiKey = env.RESEND_API_KEY ?? '';
    this.from = env.EMAIL_FROM;
  }

  async send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new DomainError('EMAIL_UNAVAILABLE', 'No pudimos enviar el correo.', {
        cause: cause instanceof Error ? cause.message : 'unknown',
      });
    }

    if (!response.ok) {
      // Al log va el estado, no el cuerpo: la respuesta puede repetir el
      // destinatario, y a quién le escribimos no tiene por qué quedar escrito.
      this.logger.error(`Resend respondió ${response.status} al enviar un correo.`);
      throw new DomainError('EMAIL_UNAVAILABLE', 'No pudimos enviar el correo.', {
        status: response.status,
      });
    }
  }
}
