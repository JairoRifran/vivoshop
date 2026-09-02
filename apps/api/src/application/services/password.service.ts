import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  PASSWORD_RESET_TTL_SECONDS,
  assertCanChangePassword,
  isResetTokenUsable,
  normalizeEmail,
  type User,
  type UserId,
} from '@vivo/domain';
import { PasswordService as PasswordHasher } from '../../infrastructure/security/password.service';
import type { Clock, EmailProvider } from '../ports/infrastructure';
import type { PasswordResetRepository, UserRepository } from '../ports/repositories';
import {
  CLOCK,
  EMAIL_PROVIDER,
  PASSWORD_RESET_REPOSITORY,
  USER_REPOSITORY,
} from '../ports/tokens';
import { ENV, type AppEnv } from '../../config/env';

/**
 * Contraseñas: recuperarla, cambiarla, y ponerse una si nunca se tuvo.
 *
 * ## La regla que atraviesa todo: no decir quién existe
 *
 * `requestReset` responde **siempre lo mismo**, exista o no la cuenta. Si
 * dijera "no encontramos ese email", el formulario se convierte en un padrón:
 * cualquiera puede probar direcciones y quedarse con la lista de quién tiene
 * cuenta en VivoShop. Eso alimenta phishing dirigido y relleno de credenciales,
 * y no le sirve a nadie más.
 *
 * La incomodidad es real —quien se equivocó de email no se entera— y se resuelve
 * en la pantalla: el mensaje dice que si esa dirección tiene cuenta, va a
 * llegar un correo. Es cierto, y no revela nada.
 */
@Injectable()
export class PasswordFlowService {
  private readonly logger = new Logger(PasswordFlowService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resets: PasswordResetRepository,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: AppEnv,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Si la recuperación está disponible, para que la pantalla no ofrezca lo que no hay. */
  get canRecover(): boolean {
    return this.env.EMAIL_PROVIDER !== 'none';
  }

  /**
   * Manda el enlace para elegir una contraseña nueva.
   *
   * No devuelve nada y no falla si el email no existe: ver el comentario de la
   * clase. Tampoco falla si el correo no sale —eso se registra y se sigue—,
   * porque un error del proveedor tampoco tiene por qué contarle a quien está
   * del otro lado si esa cuenta existe.
   */
  async requestReset(rawEmail: string): Promise<void> {
    if (!this.canRecover) {
      throw new BadRequestException({
        code: 'EMAIL_UNAVAILABLE',
        message: 'La recuperación por correo no está disponible.',
      });
    }

    const email = normalizeEmail(rawEmail);
    const user = await this.users.findByEmail(email);

    // Sin cuenta no se hace nada, y se responde igual que si la hubiera.
    if (!user) {
      this.logger.log('Pedido de recuperación para un email sin cuenta.');
      return;
    }

    const now = this.clock.now();
    // 32 bytes de aleatoriedad criptográfica. Es lo único que separa una cuenta
    // de quien tenga el enlace, así que no puede ser adivinable ni corto.
    const token = randomBytes(32).toString('base64url');

    await this.resets.create({
      // El hash, nunca el token. Ver `PasswordResetToken`.
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1_000),
      consumedAt: null,
    });

    const link = `${this.webBase()}/ingresar/restablecer?token=${encodeURIComponent(token)}`;

    try {
      await this.email.send({
        to: user.email,
        subject: 'Restablecé tu contraseña de VivoShop',
        text: [
          `Hola${user.name ? ` ${user.name.split(' ')[0]}` : ''},`,
          '',
          'Pediste restablecer tu contraseña. Entrá acá para elegir una nueva:',
          link,
          '',
          'El enlace vence en una hora y sirve una sola vez.',
          '',
          'Si no lo pediste vos, podés ignorar este correo: tu contraseña no cambió.',
        ].join('\n'),
      });
    } catch (cause) {
      // Se registra y se sigue: el pedido ya quedó guardado, y contar que el
      // envío falló diría que esa cuenta existe.
      this.logger.error(
        `No se pudo enviar el correo de recuperación: ${cause instanceof Error ? cause.message : 'desconocido'}`,
      );
    }
  }

  /**
   * Cambia la contraseña usando el enlace del correo.
   *
   * El token se consume antes de escribir nada: si dos pestañas llegan a la vez,
   * una sola gana. Y `passwordChangedAt` mata las sesiones anteriores, que es la
   * mitad del punto de restablecer.
   */
  async resetWithToken(token: string, newPassword: string): Promise<void> {
    const now = this.clock.now();
    const pending = await this.resets.consume(hashToken(token), now);

    if (!pending || !isResetTokenUsable({ ...pending, consumedAt: null }, now)) {
      throw new BadRequestException({
        code: 'RESET_TOKEN_INVALID',
        message: 'Ese enlace venció o ya se usó. Pedí uno nuevo.',
      });
    }

    const user = await this.users.findById(pending.userId);
    if (!user) {
      throw new BadRequestException({
        code: 'RESET_TOKEN_INVALID',
        message: 'Ese enlace venció o ya se usó. Pedí uno nuevo.',
      });
    }

    await this.applyNewPassword(user, newPassword, now);
    // Los demás enlaces pendientes dejan de servir: quien pidió tres correos y
    // usó el último no debería tener dos llaves más dando vueltas en su buzón.
    await this.resets.consumeAllFor(user.id, now);
  }

  /**
   * Cambia la contraseña de quien está en sesión.
   *
   * Pide la actual si la cuenta tiene una. Sin eso, una sesión robada alcanza
   * para cambiar la contraseña y dejar afuera al dueño. Ver
   * `assertCanChangePassword`.
   */
  async change(userId: UserId, input: { current?: string; next: string }): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new BadRequestException({ code: 'NOT_FOUND', message: 'Usuario inexistente.' });
    }

    const credentials = await this.users.findCredentialsByEmail(user.email);
    const hasPassword = credentials !== null;

    assertCanChangePassword({
      hasPassword,
      currentPasswordProvided: (input.current ?? '').length > 0,
    });

    if (hasPassword) {
      const matches = await this.hasher.verify(input.current ?? '', credentials.passwordHash);
      if (!matches) {
        throw new BadRequestException({
          code: 'CURRENT_PASSWORD_INVALID',
          message: 'Esa no es tu contraseña actual.',
        });
      }
    }

    await this.applyNewPassword(user, input.next, this.clock.now());
  }

  /** Si esta cuenta se abre con contraseña, para que la pantalla sepa qué pedir. */
  async hasPassword(userId: UserId): Promise<boolean> {
    const user = await this.users.findById(userId);
    if (!user) return false;
    return (await this.users.findCredentialsByEmail(user.email)) !== null;
  }

  private async applyNewPassword(user: User, plain: string, now: Date): Promise<void> {
    await this.users.setPassword(user.id, await this.hasher.hash(plain), now);
  }

  /**
   * De dónde sale el enlace del correo.
   *
   * `WEB_PUBLIC_URL` primero, y el primer origen de CORS como respaldo — que es
   * el mismo valor en la práctica. Nunca del `Host` de la petición: eso dejaría
   * que alguien con un proxy propio se haga mandar un enlace de recuperación
   * apuntando a su dominio, con un token válido adentro.
   */
  private webBase(): string {
    const base = this.env.WEB_PUBLIC_URL ?? this.env.corsOrigins[0] ?? 'http://localhost:3000';
    return base.replace(/\/+$/, '');
  }
}

/**
 * La huella del token, con SHA-256.
 *
 * Alcanza porque el token son 32 bytes aleatorios y no una palabra elegida por
 * alguien: no hay diccionario contra el que defenderse ni nada que adivinar por
 * fuerza bruta, que es lo que obliga a usar un KDF lento con las contraseñas.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
