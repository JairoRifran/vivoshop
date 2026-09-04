import { DomainError } from '../errors';
import type { UserId } from '../value-objects/identifiers';

/**
 * Denunciar y bloquear.
 *
 * ## Por qué existe
 *
 * La política de Contenido Generado por Usuarios de Google Play exige dos cosas
 * a cualquier aplicación donde la gente publique: una forma de **denunciar**
 * contenido y una forma de **bloquear** a alguien. VivoShop tiene chat en vivo y
 * transmisiones, así que le aplica de lleno, y hasta ahora no tenía ninguna de
 * las dos — lo declaramos así en el cuestionario de clasificación, porque era la
 * verdad y mentirle a Google se paga con la baja de la aplicación.
 *
 * Pero el motivo de fondo no es Play. Es que alguien que vende en vivo puede
 * recibir insultos en su propio chat delante de sus clientes, y hoy no puede
 * hacer nada. Eso, para quien vive de esto, es motivo suficiente para irse.
 *
 * ## Dos mecanismos distintos, a propósito
 *
 * **Bloquear es privado e inmediato.** No pide permiso a nadie, no notifica a la
 * otra persona y surte efecto al instante: dejás de ver lo que escribe. Es la
 * herramienta de quien está incómodo *ahora*.
 *
 * **Denunciar es público y diferido.** Va a una cola que mira la administración
 * de VivoShop. No hace nada de inmediato, y decirlo así en la pantalla importa:
 * prometer que "se elimina el contenido" y que después siga ahí es peor que no
 * ofrecer el botón.
 *
 * Quien denuncia casi siempre además quiere dejar de ver a esa persona, así que
 * la pantalla ofrece las dos juntas. Pero son operaciones separadas: bloquear no
 * denuncia, y denunciar no bloquea.
 */

export const REPORT_REASONS = [
  /** Publicidad repetida, enlaces, contenido que no viene al caso. */
  'spam',
  /** Insultos, acoso, discriminación. */
  'ofensivo',
  /** Intento de estafa: pedir pagos por fuera, productos que no existen. */
  'estafa',
  /** Contenido sexual. */
  'sexual',
  /** Violencia. */
  'violencia',
  /** Producto prohibido o con restricción de edad. */
  'prohibido',
  'otro',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Qué se puede denunciar. */
export const REPORT_TARGETS = ['live_message', 'product', 'store', 'user'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = [
  'open',
  /** Se miró y no violaba nada. */
  'dismissed',
  /** Se miró y se actuó: contenido bajado, tienda suspendida, cuenta cerrada. */
  'actioned',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Tope del texto libre. Suficiente para explicarse, corto para poder leerlo. */
export const REPORT_DETAIL_MAX = 500;

export interface Report {
  readonly id: string;
  readonly reporterId: UserId;
  readonly target: ReportTarget;
  /** El identificador de lo denunciado, en el espacio de `target`. */
  readonly targetId: string;
  readonly reason: ReportReason;
  readonly detail: string;
  readonly status: ReportStatus;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: UserId | null;
}

export interface Block {
  readonly blockerId: UserId;
  readonly blockedId: UserId;
  readonly createdAt: Date;
}

/**
 * No se puede uno bloquear a sí mismo.
 *
 * Parece una tontería hasta que pasa: el propio vendedor toca "bloquear" sobre
 * su mensaje en su propio vivo y deja de ver su chat, sin entender por qué.
 */
export function assertCanBlock(blockerId: UserId, blockedId: UserId): void {
  if (String(blockerId) === String(blockedId)) {
    throw new DomainError('CANNOT_BLOCK_SELF', 'No podés bloquearte a vos mismo.');
  }
}

/** Tampoco denunciarse a uno mismo, por lo mismo. */
export function assertCanReportUser(reporterId: UserId, reportedId: UserId): void {
  if (String(reporterId) === String(reportedId)) {
    throw new DomainError('CANNOT_REPORT_SELF', 'No podés denunciarte a vos mismo.');
  }
}

export function assertValidDetail(detail: string): void {
  if (detail.length > REPORT_DETAIL_MAX) {
    throw new DomainError(
      'REPORT_DETAIL_TOO_LONG',
      `El detalle no puede pasar de ${REPORT_DETAIL_MAX} caracteres.`,
    );
  }
}

/**
 * Saca de una lista lo que escribió alguien bloqueado.
 *
 * Es una función del dominio y no un `where` en la consulta porque el chat en
 * vivo no siempre viene de la base: los mensajes nuevos llegan por WebSocket ya
 * armados. La misma regla tiene que valer para el historial que se carga al
 * entrar y para lo que aparece mientras mirás; si vive en un solo lado, el
 * bloqueo funciona hasta que la otra persona vuelve a escribir.
 */
export function hideFromBlocked<T extends { readonly authorId: UserId | null }>(
  items: readonly T[],
  blocked: ReadonlySet<string>,
): T[] {
  if (blocked.size === 0) return [...items];
  return items.filter((item) => item.authorId === null || !blocked.has(String(item.authorId)));
}

/**
 * Si una denuncia ya se resolvió.
 *
 * Reabrir una resuelta no está previsto: si vuelve a pasar, es una denuncia
 * nueva, con su propia fecha. Así la cola dice cuántas veces pasó algo y no
 * cuántas veces se reabrió el mismo papel.
 */
export function isResolved(status: ReportStatus): boolean {
  return status !== 'open';
}

export function assertNotResolved(status: ReportStatus): void {
  if (isResolved(status)) {
    throw new DomainError('REPORT_ALREADY_RESOLVED', 'Esta denuncia ya fue resuelta.');
  }
}
