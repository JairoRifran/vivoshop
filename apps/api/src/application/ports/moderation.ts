import type { Block, Report, ReportStatus, UserId } from '@vivo/domain';

export const MODERATION_REPOSITORY = Symbol('ModerationRepository');

export interface ReportQuery {
  readonly status?: ReportStatus;
  readonly limit?: number;
}

/**
 * Denuncias y bloqueos.
 *
 * Los dos viven en el mismo puerto porque se usan juntos —la pantalla que
 * denuncia también ofrece bloquear— pero no comparten ninguna regla: bloquear
 * es privado e inmediato, denunciar es una cola que mira la administración.
 */
export interface ModerationRepository {
  createReport(report: Report): Promise<Report>;
  findReport(id: string): Promise<Report | null>;
  listReports(query?: ReportQuery): Promise<Report[]>;
  /** Cuántas hay sin resolver. El panel del dueño lo muestra en "Para atender". */
  countOpenReports(): Promise<number>;
  resolveReport(id: string, status: ReportStatus, by: UserId, at: Date): Promise<Report>;

  /**
   * Idempotente: bloquear dos veces a la misma persona deja una sola fila y no
   * falla. En PostgreSQL lo garantiza la clave primaria compuesta.
   */
  block(block: Block): Promise<void>;
  unblock(blockerId: UserId, blockedId: UserId): Promise<void>;
  /** A quiénes bloqueó esta persona. Es lo que el chat usa para filtrar. */
  listBlockedIds(blockerId: UserId): Promise<string[]>;
  listBlocks(blockerId: UserId): Promise<Block[]>;
}
