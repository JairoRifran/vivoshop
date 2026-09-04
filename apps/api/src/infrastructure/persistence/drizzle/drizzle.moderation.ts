import { Inject, Injectable } from '@nestjs/common';
import type { Block, Report, ReportReason, ReportStatus, ReportTarget, UserId } from '@vivo/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { ModerationRepository, ReportQuery } from '../../../application/ports/moderation';
import { DRIZZLE, type VivoDatabase } from './client';
import { schema as t } from './schema';

type FilaReporte = typeof t.reports.$inferSelect;
type FilaBloqueo = typeof t.blocks.$inferSelect;

/** El borde donde el texto de la base vuelve a ser un tipo del dominio. */
function aReporte(fila: FilaReporte): Report {
  return {
    id: fila.id,
    reporterId: fila.reporterId as UserId,
    target: fila.target as ReportTarget,
    targetId: fila.targetId,
    reason: fila.reason as ReportReason,
    detail: fila.detail,
    status: fila.status as ReportStatus,
    createdAt: fila.createdAt,
    resolvedAt: fila.resolvedAt,
    resolvedBy: (fila.resolvedBy as UserId | null) ?? null,
  };
}

function aBloqueo(fila: FilaBloqueo): Block {
  return {
    blockerId: fila.blockerId as UserId,
    blockedId: fila.blockedId as UserId,
    createdAt: fila.createdAt,
  };
}

@Injectable()
export class DrizzleModerationRepository implements ModerationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async createReport(report: Report): Promise<Report> {
    await this.db.insert(t.reports).values({
      id: report.id,
      reporterId: String(report.reporterId),
      target: report.target,
      targetId: report.targetId,
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
      resolvedBy: report.resolvedBy ? String(report.resolvedBy) : null,
    });
    return report;
  }

  async findReport(id: string): Promise<Report | null> {
    const filas = await this.db.select().from(t.reports).where(eq(t.reports.id, id)).limit(1);
    const fila = filas[0];
    return fila ? aReporte(fila) : null;
  }

  async listReports(query: ReportQuery = {}): Promise<Report[]> {
    const filas = await this.db
      .select()
      .from(t.reports)
      .where(query.status ? eq(t.reports.status, query.status) : undefined)
      // Lo más viejo primero: una cola se atiende por orden de llegada.
      .orderBy(asc(t.reports.createdAt))
      .limit(query.limit ?? 200);
    return filas.map(aReporte);
  }

  async countOpenReports(): Promise<number> {
    const filas = await this.db
      .select({ total: sql<string>`count(*)` })
      .from(t.reports)
      .where(eq(t.reports.status, 'open'));
    const n = Number(filas[0]?.total ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  async resolveReport(id: string, status: ReportStatus, by: UserId, at: Date): Promise<Report> {
    const filas = await this.db
      .update(t.reports)
      .set({ status, resolvedAt: at, resolvedBy: String(by) })
      .where(eq(t.reports.id, id))
      .returning();
    const fila = filas[0];
    if (!fila) throw new Error(`No existe la denuncia ${id}`);
    return aReporte(fila);
  }

  async block(block: Block): Promise<void> {
    // `do nothing` y no `do update`: volver a tocar el botón no debe mover el
    // "bloqueado desde". La clave primaria compuesta hace el resto.
    await this.db
      .insert(t.blocks)
      .values({
        blockerId: String(block.blockerId),
        blockedId: String(block.blockedId),
        createdAt: block.createdAt,
      })
      .onConflictDoNothing();
  }

  async unblock(blockerId: UserId, blockedId: UserId): Promise<void> {
    await this.db
      .delete(t.blocks)
      .where(
        and(eq(t.blocks.blockerId, String(blockerId)), eq(t.blocks.blockedId, String(blockedId))),
      );
  }

  async listBlockedIds(blockerId: UserId): Promise<string[]> {
    const filas = await this.db
      .select({ id: t.blocks.blockedId })
      .from(t.blocks)
      .where(eq(t.blocks.blockerId, String(blockerId)));
    return filas.map((f) => f.id).sort();
  }

  async listBlocks(blockerId: UserId): Promise<Block[]> {
    const filas = await this.db
      .select()
      .from(t.blocks)
      .where(eq(t.blocks.blockerId, String(blockerId)))
      .orderBy(desc(t.blocks.createdAt));
    return filas.map(aBloqueo);
  }
}
