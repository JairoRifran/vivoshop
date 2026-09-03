import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  anonymizedEmailFor,
  assertCanDeleteAccount,
  assertConfirmationMatches,
  DELETED_ACCOUNT_NAME,
  type UserId,
} from '@vivo/domain';
import type { AccountDeletionRepository, UserRepository } from '../ports/repositories';
import type { Clock, StorageProvider } from '../ports/infrastructure';
import { ACCOUNT_DELETION_REPOSITORY, CLOCK, STORAGE_PROVIDER, USER_REPOSITORY } from '../ports/tokens';

/**
 * Borrar la cuenta.
 *
 * ## El orden importa, y este es el orden
 *
 * 1. Buscar la cuenta.
 * 2. Comprobar la confirmación —el correo escrito a mano—.
 * 3. Comprobar que no quede nada en vuelo.
 * 4. Anonimizar, en una transacción.
 * 5. Borrar el archivo de la foto.
 *
 * Los pasos 2 y 3 van **antes** de tocar nada. El 5 va **después** y fuera de
 * la transacción: el almacenamiento no participa de ella, y si Supabase está
 * caído lo que queda es un archivo huérfano, no una cuenta a medio borrar.
 *
 * ## Por qué no hay confirmación por correo
 *
 * Sería más seguro contra una sesión robada. Pero quien tiene una sesión
 * robada ya puede cambiar la contraseña y quedarse con la cuenta, que hace más
 * daño que borrarla; y un borrado en dos pasos por correo se abandona a la
 * mitad y deja a la persona creyendo que borró algo que sigue ahí.
 *
 * La sesión, más escribir el propio correo, es la barrera. Está anotado como
 * deuda en `docs/m11.md`.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ACCOUNT_DELETION_REPOSITORY) private readonly deletion: AccountDeletionRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Qué le impide a esta cuenta borrarse, si algo.
   *
   * La pantalla lo pregunta antes de mostrar el formulario: es mejor explicar
   * por qué no se puede que dejar escribir el correo y fallar al enviar.
   */
  async deletionBlockers(userId: UserId): Promise<{
    canDelete: boolean;
    pendingOrders: number;
    pendingSales: number;
  }> {
    const { comoComprador, comoVendedor } = await this.deletion.countOrdersInFlight(userId);
    return {
      canDelete: comoComprador === 0 && comoVendedor === 0,
      pendingOrders: comoComprador,
      pendingSales: comoVendedor,
    };
  }

  async delete(input: { userId: UserId; confirmation: string }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario inexistente.' });
    }

    assertConfirmationMatches(input.confirmation, user.email);

    const { comoComprador, comoVendedor } = await this.deletion.countOrdersInFlight(input.userId);
    assertCanDeleteAccount({ comoComprador, comoVendedor });

    const { avatarUrl } = await this.deletion.anonymize({
      userId: input.userId,
      email: anonymizedEmailFor(input.userId),
      name: DELETED_ACCOUNT_NAME,
      changedAt: this.clock.now(),
    });

    await this.removeAvatarFile(avatarUrl);

    // Sin el correo ni el nombre: el log de un borrado no puede ser el lugar
    // donde sobreviven los datos que se acaban de borrar.
    this.logger.log(`Cuenta anonimizada: ${String(input.userId)}`);
  }

  /**
   * Borra el archivo de la foto, si era nuestro y si se puede.
   *
   * Un fallo acá **no** revierte el borrado ni se le muestra a la persona: los
   * datos ya se fueron, y decirle "no se pudo borrar tu cuenta" cuando sí se
   * borró sería peor que el archivo que quedó. Se registra para poder barrerlo.
   */
  private async removeAvatarFile(avatarUrl: string | null): Promise<void> {
    if (!avatarUrl) return;

    const key = this.storage.keyFromPublicUrl(avatarUrl);
    // `null` es lo normal en cuentas viejas: su `avatarUrl` apunta a un avatar
    // generado que nunca fue un archivo.
    if (!key) return;

    try {
      await this.storage.remove(key);
    } catch (cause) {
      this.logger.warn(
        `Quedó un archivo huérfano en el almacenamiento: ${key} (${
          cause instanceof Error ? cause.message : 'desconocido'
        })`,
      );
    }
  }
}
