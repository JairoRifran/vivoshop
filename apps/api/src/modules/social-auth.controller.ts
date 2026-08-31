import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { safeReturnPath } from '@vivo/domain';
import { z } from 'zod';
import { SocialAuthService } from '../application/services/social-auth.service';
import { Public } from '../common/auth.guard';
import { zodPipe } from '../common/http';
import type { SessionDto } from '@vivo/shared';
import { ENV, type AppEnv } from '../config/env';

const exchangeSchema = z.object({ vale: z.string().min(1).max(2_048) });

const callbackSchema = z.object({
  code: z.string().min(1).max(2_048).optional(),
  state: z.string().min(1).max(512).optional(),
  /** Lo que manda el proveedor cuando la persona cancela en su pantalla. */
  error: z.string().max(120).optional(),
});

/**
 * Ingresar con Google (o con Meta).
 *
 * Dos rutas y las dos son redirecciones del navegador, no llamadas de la
 * aplicación. Es lo que exige OAuth: la persona **sale** de nuestro sitio, se
 * autentica en el del proveedor, y vuelve. Por eso no hay `fetch` de por medio
 * ni cuerpo JSON en ningún lado.
 *
 * ## Dónde termina la sesión
 *
 * La API no puede escribir la cookie de sesión: vive en el dominio de la web,
 * que es otro origen. Así que el callback vuelve a la web con un token de un
 * solo uso en la URL y **la web** lo canjea por su cookie. Es la misma razón
 * por la que suscribirse a los avisos pasa por una acción de servidor.
 */
@Controller('auth')
export class SocialAuthController {
  constructor(
    private readonly social: SocialAuthService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  /**
   * Qué botones dibujar.
   *
   * La pantalla no adivina: pregunta. Así una instalación sin credenciales de
   * Google no muestra un botón que lleva a un error, y agregar Meta el día que
   * pase la revisión no exige recompilar la web.
   */
  @Public()
  @Get('providers')
  providers(): { providers: string[] } {
    return { providers: this.social.available() };
  }

  /**
   * Manda a la persona al proveedor.
   *
   * El límite es bajo porque cada llamada escribe una fila de `login_states`:
   * sin él, alguien podría llenar la tabla pidiendo ingresos que nunca completa.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Public()
  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Query('next') next: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const { url } = await this.social.start({
      provider,
      returnTo: next ?? null,
      redirectUri: this.redirectUriFor(provider),
    });

    response.redirect(url);
  }

  /**
   * Vuelve del proveedor.
   *
   * Siempre termina en una redirección a la web —nunca en un JSON—: quien está
   * mirando esto es un navegador que viene de otra pestaña, no un cliente de
   * API. Un error acá tiene que verse como una pantalla de ingreso con un
   * mensaje, no como un objeto en crudo.
   */
  @Public()
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = callbackSchema.safeParse(query);
    const params = parsed.success ? parsed.data : {};

    // Canceló en la pantalla del proveedor. No es un error nuestro y no merece
    // un mensaje de error: vuelve al ingreso como si nada.
    if (params.error || !params.code || !params.state) {
      response.redirect(this.webUrl('/ingresar', { cancelado: '1' }));
      return;
    }

    try {
      const result = await this.social.callback({
        provider,
        code: params.code,
        state: params.state,
        redirectUri: this.redirectUriFor(provider),
      });

      if (result.needsPasswordFor) {
        // Ya existe una cuenta con ese email y el proveedor no lo verificó.
        // Se la manda a ingresar con contraseña, con el email precargado.
        response.redirect(
          this.webUrl('/ingresar', {
            email: result.needsPasswordFor,
            motivo: 'verificar',
            next: result.returnTo,
          }),
        );
        return;
      }

      response.redirect(
        this.webUrl('/ingresar/social', {
          // Un vale de un minuto, no la sesión: esta URL queda en el historial
          // y en el `Referer`. Ver `EXCHANGE_AUDIENCE`.
          vale: result.ticket ?? '',
          next: result.returnTo,
        }),
      );
    } catch {
      // El detalle ya quedó en los logs del servicio. Al navegador va una
      // pantalla, no una traza: qué proveedor falló y por qué no le sirve a
      // quien está intentando entrar, y a quien prueba ataques sí.
      response.redirect(this.webUrl('/ingresar', { error: 'social' }));
    }
  }

  /**
   * Canjea el vale por la sesión.
   *
   * La llama el servidor de la web, no el navegador: el vale llegó por la URL y
   * lo que vuelve de acá es la credencial de siete días, que solo tiene que
   * existir del lado del servidor el tiempo de escribir la cookie.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @Post('session/exchange')
  @HttpCode(200)
  exchange(
    @Body(zodPipe(exchangeSchema)) body: z.infer<typeof exchangeSchema>,
  ): Promise<SessionDto> {
    return this.social.exchange(body.vale);
  }

  /**
   * La URL de retorno que se registra en la consola del proveedor.
   *
   * Se arma desde `API_PUBLIC_URL` y no desde la petición: usar el `Host` que
   * mandó el navegador dejaría que alguien con un proxy propio dirija el
   * callback a su dominio. Tiene que ser exactamente igual a la que está
   * cargada en Google, carácter por carácter.
   */
  private redirectUriFor(provider: string): string {
    return `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/auth/${provider}/callback`;
  }

  private webUrl(path: string, params: Record<string, string>): string {
    const base = (this.env.corsOrigins[0] ?? 'http://localhost:3000').replace(/\/+$/, '');
    const url = new URL(`${base}${safeReturnPath(path)}`);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }
}
