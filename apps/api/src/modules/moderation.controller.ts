import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { UserId } from '@vivo/domain';
import {
  createReportRequestSchema,
  resolveReportRequestSchema,
  type BlockedPersonDto,
  type CreateReportRequest,
  type ReportDto,
  type ResolveReportRequest,
} from '@vivo/shared';
import { ModerationService } from '../application/services/moderation.service';
import { Roles, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

/** Un `Report` del dominio, tal como sale por HTTP. */
function aDto(report: Awaited<ReturnType<ModerationService['report']>>): ReportDto {
  return {
    id: report.id,
    reporterId: String(report.reporterId),
    target: report.target,
    targetId: report.targetId,
    reason: report.reason,
    detail: report.detail,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    resolvedBy: report.resolvedBy ? String(report.resolvedBy) : null,
  };
}

/**
 * Denunciar y bloquear.
 *
 * Las dos cosas que la política de Contenido Generado por Usuarios de Google
 * Play exige a cualquier aplicación donde la gente publique. VivoShop tiene chat
 * en vivo y transmisiones, así que le aplica.
 *
 * Todo pide sesión: una denuncia anónima no se puede investigar ni contrastar, y
 * un bloqueo sin dueño no significa nada.
 */
@Controller()
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  async report(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(createReportRequestSchema)) body: Required<CreateReportRequest>,
  ): Promise<ReportDto> {
    const creada = await this.moderation.report(requireUser(user).id, body);
    return aDto(creada);
  }

  @Get('me/blocks')
  blocked(@CurrentUser() user: AuthenticatedUser | null): Promise<BlockedPersonDto[]> {
    return this.moderation.blockedPeople(requireUser(user).id);
  }

  @Post('users/:userId/block')
  @HttpCode(204)
  block(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.moderation.block(requireUser(user).id, userId as UserId);
  }

  @Delete('users/:userId/block')
  @HttpCode(204)
  unblock(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.moderation.unblock(requireUser(user).id, userId as UserId);
  }
}

/**
 * La cola de moderación.
 *
 * `@Roles('admin')` sobre la clase entera, igual que en `AdminController` y por
 * la misma razón: acá se ve quién denunció a quién, y una ruta nueva que alguien
 * agregue sin acordarse de decorarla quedaría abierta.
 */
@Roles('admin')
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  async reports(@Query('estado') estado?: string): Promise<ReportDto[]> {
    const status =
      estado === 'dismissed' || estado === 'actioned' || estado === 'open' ? estado : 'open';
    const filas = await this.moderation.listReports(status, 200);
    return filas.map(aDto);
  }

  @Post('reports/:id/resolve')
  async resolve(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(resolveReportRequestSchema)) body: ResolveReportRequest,
  ): Promise<ReportDto> {
    const resuelta = await this.moderation.resolve(id, body.status, requireUser(user).id);
    return aDto(resuelta);
  }
}
