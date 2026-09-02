import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
} from '@vivo/shared';
import { PasswordFlowService } from '../application/services/password.service';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

/**
 * Contraseñas: recuperarla, cambiarla, y saber si se tiene una.
 *
 * Los límites de acá son los más bajos de toda la API, y cada uno tiene su
 * razón. Ver cada ruta.
 */
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordFlowService) {}

  /**
   * Si la recuperación está disponible.
   *
   * La pantalla de ingreso lo consulta para decidir si dibuja "¿Olvidaste tu
   * contraseña?". Sin proveedor de correo el enlace llevaría a un formulario
   * que promete un email que nunca sale, y eso es peor que no ofrecerlo.
   */
  @Public()
  @Get('status')
  status(): { canRecover: boolean } {
    return { canRecover: this.passwords.canRecover };
  }

  /**
   * Pide el enlace de recuperación.
   *
   * **Responde 204 siempre**, exista o no la cuenta. Si distinguiera, el
   * formulario sería un padrón: cualquiera podría probar direcciones y quedarse
   * con la lista de quién tiene cuenta acá.
   *
   * Cinco por minuto es lo más bajo de la API. Cada llamada manda un correo a
   * una dirección que elige quien llama: sin un límite duro, esto es una
   * herramienta gratuita para inundar el buzón de otra persona, y de paso para
   * quemar la reputación de nuestro dominio como remitente.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('forgot')
  @HttpCode(204)
  async forgot(
    @Body(zodPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
  ): Promise<void> {
    await this.passwords.requestReset(body.email);
  }

  /**
   * Elige una contraseña nueva con el enlace del correo.
   *
   * Diez por minuto: el token son 32 bytes aleatorios y adivinarlo por fuerza
   * bruta es inviable con o sin límite, pero un límite bajo hace que ni siquiera
   * valga la pena intentarlo, y de paso corta el ruido en los logs.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('reset')
  @HttpCode(204)
  async reset(
    @Body(zodPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
  ): Promise<void> {
    await this.passwords.resetWithToken(body.token, body.password);
  }

  /** Si esta cuenta se abre con contraseña, para que la pantalla sepa qué pedir. */
  @Get('mine')
  async mine(@CurrentUser() user: AuthenticatedUser | null): Promise<{ hasPassword: boolean }> {
    return { hasPassword: await this.passwords.hasPassword(requireUser(user).id) };
  }

  /**
   * Cambia la contraseña de quien está en sesión.
   *
   * El límite acá también protege la contraseña **actual**: sin él, alguien con
   * una sesión robada podría probar contraseñas contra este campo hasta dar con
   * la verdadera, que es lo que hace falta para cambiarla.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change')
  @HttpCode(204)
  async change(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.passwords.change(requireUser(user).id, {
      ...(body.currentPassword ? { current: body.currentPassword } : {}),
      next: body.password,
    });
  }
}
