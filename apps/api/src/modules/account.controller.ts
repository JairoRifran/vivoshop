import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { deleteAccountRequestSchema, type DeleteAccountRequest } from '@vivo/shared';
import { AccountService } from '../application/services/account.service';
import { requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

/**
 * Borrar la cuenta.
 *
 * Las dos rutas exigen sesión: no hay forma de borrar la cuenta de otro, ni
 * siquiera sabiendo su correo. El identificador sale del token, nunca del
 * cuerpo de la petición.
 */
@Controller('auth/account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  /**
   * Qué le impide borrarse a esta cuenta, si algo.
   *
   * La pantalla lo consulta **antes** de dibujar el formulario. Dejar escribir
   * el correo y recién ahí decir "no se puede porque tenés una venta abierta"
   * es hacerle perder el tiempo a alguien que ya decidió algo difícil.
   */
  @Get('deletion')
  async deletion(@CurrentUser() user: AuthenticatedUser | null): Promise<{
    canDelete: boolean;
    pendingOrders: number;
    pendingSales: number;
  }> {
    return this.accounts.deletionBlockers(requireUser(user).id);
  }

  /**
   * Borra la cuenta.
   *
   * Tres por minuto. No es una ruta que alguien necesite repetir: el límite
   * está para que un intento de adivinar la confirmación por fuerza bruta no
   * tenga sentido, aunque la confirmación sea el propio correo de la sesión y
   * adivinarla ya sea absurdo.
   *
   * Responde **204**. No hay nada que devolver: la sesión que hizo la petición
   * queda muerta en el mismo acto, porque anonimizar fecha el corte igual que
   * lo hace un cambio de contraseña.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('delete')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(deleteAccountRequestSchema)) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.accounts.delete({
      userId: requireUser(user).id,
      confirmation: body.confirmation,
    });
  }
}
