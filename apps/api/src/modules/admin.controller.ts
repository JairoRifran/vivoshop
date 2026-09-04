import { Controller, Get, Header, Query } from '@nestjs/common';
import type { AdminOverviewDto } from '@vivo/shared';
import { AdminService } from '../application/services/admin.service';
import { Roles } from '../common/auth.guard';

/**
 * El panel del dueño de la plataforma.
 *
 * `@Roles('admin')` va en la clase entera, no ruta por ruta: acá se ve la plata
 * de todas las tiendas y los correos de todos los compradores, y una ruta nueva
 * que alguien agregue sin acordarse de decorarla quedaría abierta. Puesto arriba
 * el descuido no es posible.
 *
 * El rol `admin` existía en `USER_ROLES` desde el principio y nunca se había
 * usado. Se otorga con `pnpm db:grant-admin`, que pide tipear el host de la base
 * igual que `db:clear`.
 */
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@Query('dias') dias?: string): Promise<AdminOverviewDto> {
    return this.admin.overview(dias ? Number(dias) : undefined);
  }

  /*
   * Los dos reportes van como archivo, no como JSON.
   *
   * `Content-Disposition: attachment` es lo que hace que el navegador lo
   * guarde en vez de mostrarlo como una pared de texto. El nombre no lleva la
   * fecha porque la pone quien descarga: dos reportes del mismo día con
   * ventanas distintas se pisarían.
   */
  @Get('reportes/pedidos.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vivoshop-pedidos.csv"')
  pedidos(@Query('dias') dias?: string): Promise<string> {
    return this.admin.reportePedidos(dias ? Number(dias) : undefined);
  }

  @Get('reportes/cobros.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vivoshop-cobros.csv"')
  cobros(@Query('dias') dias?: string): Promise<string> {
    return this.admin.reporteCobros(dias ? Number(dias) : undefined);
  }
}
