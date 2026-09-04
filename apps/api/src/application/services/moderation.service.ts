import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertCanBlock,
  assertCanReportUser,
  assertNotResolved,
  assertValidDetail,
  type Block,
  type Report,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
  type UserId,
} from '@vivo/domain';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import { MODERATION_REPOSITORY, type ModerationRepository } from '../ports/moderation';
import type { UserRepository } from '../ports/repositories';
import { CLOCK, ID_GENERATOR, USER_REPOSITORY } from '../ports/tokens';

export interface CreateReportInput {
  readonly target: ReportTarget;
  readonly targetId: string;
  readonly reason: ReportReason;
  readonly detail: string;
}

@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY) private readonly repo: ModerationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async report(reporterId: UserId, input: CreateReportInput): Promise<Report> {
    assertValidDetail(input.detail);
    if (input.target === 'user') assertCanReportUser(reporterId, input.targetId as UserId);

    const report: Report = {
      id: this.ids.generate('rep'),
      reporterId,
      target: input.target,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail.trim(),
      status: 'open',
      createdAt: this.clock.now(),
      resolvedAt: null,
      resolvedBy: null,
    };
    return this.repo.createReport(report);
  }

  /**
   * No comprueba que lo denunciado exista.
   *
   * A propósito: un mensaje del chat puede desaparecer entre que alguien lo lee
   * y toca denunciar, y en ese momento lo último que hay que hacer es negarle
   * la denuncia. La cola de moderación muestra "esto ya no existe" cuando
   * corresponde; perder el registro de que alguien se quejó es peor.
   */

  async block(blockerId: UserId, blockedId: UserId): Promise<void> {
    assertCanBlock(blockerId, blockedId);
    // Sí se comprueba que la persona exista: bloquear a un identificador
    // inventado dejaría filas basura que nadie puede deshacer desde la pantalla.
    const existe = await this.users.findById(blockedId);
    if (!existe)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No encontramos esa cuenta.' });

    const block: Block = { blockerId, blockedId, createdAt: this.clock.now() };
    await this.repo.block(block);
  }

  async unblock(blockerId: UserId, blockedId: UserId): Promise<void> {
    await this.repo.unblock(blockerId, blockedId);
  }

  /** Los identificadores, para filtrar. Es lo que usa el chat en vivo. */
  async blockedIds(blockerId: UserId): Promise<Set<string>> {
    return new Set(await this.repo.listBlockedIds(blockerId));
  }

  /** Con nombre y foto, para la pantalla de "cuentas bloqueadas". */
  async blockedPeople(
    blockerId: UserId,
  ): Promise<{ id: string; name: string; avatarUrl: string | null; since: string }[]> {
    const bloqueos = await this.repo.listBlocks(blockerId);
    const gente = await Promise.all(bloqueos.map((b) => this.users.findById(b.blockedId)));
    return bloqueos.flatMap((b, i) => {
      const u = gente[i];
      if (!u) return [];
      return [
        {
          id: String(u.id),
          name: u.name,
          avatarUrl: u.avatarUrl,
          since: b.createdAt.toISOString(),
        },
      ];
    });
  }

  // --- Administración -------------------------------------------------------

  listReports(status?: ReportStatus, limit?: number): Promise<Report[]> {
    return this.repo.listReports({
      ...(status ? { status } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  countOpen(): Promise<number> {
    return this.repo.countOpenReports();
  }

  async resolve(id: string, status: ReportStatus, by: UserId): Promise<Report> {
    const actual = await this.repo.findReport(id);
    if (!actual)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No encontramos esa denuncia.' });
    assertNotResolved(actual.status);
    return this.repo.resolveReport(id, status, by, this.clock.now());
  }
}
