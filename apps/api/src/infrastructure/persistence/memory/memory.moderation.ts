import { Injectable } from '@nestjs/common';
import type { Block, Report, ReportStatus, UserId } from '@vivo/domain';
import type { ModerationRepository, ReportQuery } from '../../../application/ports/moderation';
import { MemoryDatabase } from './memory-database';

/** La clave compuesta de `blocks`, como texto. */
const clave = (blockerId: UserId, blockedId: UserId): string =>
  `${String(blockerId)}|${String(blockedId)}`;

@Injectable()
export class MemoryModerationRepository implements ModerationRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async createReport(report: Report): Promise<Report> {
    this.db.reports.set(report.id, report);
    return report;
  }

  async findReport(id: string): Promise<Report | null> {
    return this.db.reports.get(id) ?? null;
  }

  async listReports(query: ReportQuery = {}): Promise<Report[]> {
    let filas = [...this.db.reports.values()];
    if (query.status) filas = filas.filter((r) => r.status === query.status);
    // Lo más viejo primero: una cola de moderación se atiende por orden de
    // llegada, no por lo último que entró.
    filas.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return query.limit ? filas.slice(0, query.limit) : filas;
  }

  async countOpenReports(): Promise<number> {
    let total = 0;
    for (const r of this.db.reports.values()) if (r.status === 'open') total += 1;
    return total;
  }

  async resolveReport(id: string, status: ReportStatus, by: UserId, at: Date): Promise<Report> {
    const actual = this.db.reports.get(id);
    if (!actual) throw new Error(`No existe la denuncia ${id}`);
    const resuelta: Report = { ...actual, status, resolvedAt: at, resolvedBy: by };
    this.db.reports.set(id, resuelta);
    return resuelta;
  }

  async block(block: Block): Promise<void> {
    const k = clave(block.blockerId, block.blockedId);
    // Idempotente: si ya estaba, se conserva la fecha original. Volver a tocar
    // el botón no debería mover el "bloqueado desde".
    if (!this.db.blocks.has(k)) this.db.blocks.set(k, block);
  }

  async unblock(blockerId: UserId, blockedId: UserId): Promise<void> {
    this.db.blocks.delete(clave(blockerId, blockedId));
  }

  async listBlockedIds(blockerId: UserId): Promise<string[]> {
    const ids: string[] = [];
    for (const b of this.db.blocks.values()) {
      if (String(b.blockerId) === String(blockerId)) ids.push(String(b.blockedId));
    }
    return ids.sort();
  }

  async listBlocks(blockerId: UserId): Promise<Block[]> {
    return [...this.db.blocks.values()]
      .filter((b) => String(b.blockerId) === String(blockerId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
