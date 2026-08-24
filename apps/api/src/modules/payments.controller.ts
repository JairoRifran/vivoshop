import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import { protectionLevel } from '@vivo/domain';
import {
  businessVerificationRequestSchema,
  identityVerificationRequestSchema,
  type BusinessVerificationRequest,
  type IdentityVerificationRequest,
  type PaymentCapabilitiesDto,
  type PaymentDto,
  type SellerPaymentAccountDto,
  type VerificationStatusDto,
} from '@vivo/shared';
import type { Request } from 'express';
import {
  toPaymentDto,
  toSellerPaymentAccountDto,
  toVerificationStatusDto,
} from '../application/mappers/dto.mappers';
import { PaymentService } from '../application/services/payment.service';
import { StoreService } from '../application/services/store.service';
import { VerificationService } from '../application/services/verification.service';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';
import { ENV, type AppEnv } from '../config/env';

/**
 * Todo lo que entra desde afuera con respecto al dinero.
 *
 * Dos rutas son públicas y por muy buenas razones distintas:
 *
 *  - **El webhook** lo llama el proveedor, que no tiene sesión. Su seguridad
 *    es la firma que valida el adaptador, más el hecho de que el estado no se
 *    cree: se consulta contra la API del proveedor.
 *  - **El callback de OAuth** lo abre el navegador del vendedor volviendo del
 *    proveedor, y puede no traer cookie. Su seguridad es el `state`, que se
 *    emitió del lado del servidor y se consume una sola vez.
 *
 * Ninguna de las dos confía en nada que venga en la URL para decidir de quién
 * es la plata.
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  /**
   * Lo que la UI puede prometer.
   *
   * Público porque el escudo de Compra Protegida se muestra —o no— antes de
   * que nadie inicie sesión, y prefiero que la respuesta venga del servidor a
   * que el navegador tenga una copia de la promesa hardcodeada.
   */
  @Public()
  @Get('capabilities')
  capabilities(): PaymentCapabilitiesDto {
    const capabilities = this.payments.capabilities();
    return {
      provider: capabilities.provider,
      level: protectionLevel(capabilities),
      supportsRefunds: capabilities.supportsRefunds,
      supportsDisputes: capabilities.supportsDisputes,
      supportsDelayedSettlement: capabilities.supportsDelayedSettlement,
    };
  }

  /**
   * El aviso del proveedor. La única autoridad sobre si se cobró.
   *
   * Responde 200 pase lo que pase con avisos que no reconoce: un proveedor que
   * recibe un 500 reintenta para siempre, y no hay nada que reintentar cuando
   * el aviso no era para nosotros. Un error real sí propaga, para que el
   * reintento ocurra.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(200)
  async webhook(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true }> {
    await this.payments.handleWebhook({
      body,
      headers,
      rawBody: (request as Request & { rawBody?: string }).rawBody ?? JSON.stringify(body ?? {}),
    });
    return { ok: true };
  }

  /**
   * Vuelta del vendedor después de autorizar en el proveedor.
   *
   * Termina en un redirect al panel: el vendedor no debería ver JSON. El
   * resultado se comunica por query param, que es información de presentación
   * —la conexión ya quedó guardada del lado del servidor—.
   */
  @Public()
  @Get(':provider/oauth/callback')
  @Redirect()
  async oauthCallback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ url: string }> {
    const base = `${this.env.corsOrigins[0] ?? 'http://localhost:3000'}/vender/cobros`;
    if (!code || !state) return { url: `${base}?conexion=cancelada` };

    try {
      await this.payments.completeConnection({ code, state });
      return { url: `${base}?conexion=lista` };
    } catch {
      // Sin detalles en la URL: un mensaje de error del proveedor en la barra
      // de direcciones no le sirve a nadie y puede filtrar datos.
      return { url: `${base}?conexion=error` };
    }
  }
}

/** Lo del vendedor sobre su propia tienda. Todo exige sesión y propiedad. */
@Controller('seller/payments')
export class SellerPaymentsController {
  constructor(
    private readonly payments: PaymentService,
    private readonly stores: StoreService,
  ) {}

  @Get('account')
  async account(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<SellerPaymentAccountDto | null> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    const view = await this.payments.accountView(store);
    return view ? toSellerPaymentAccountDto(view) : null;
  }

  /**
   * Los cobros de la tienda.
   *
   * Lleva montos y comisiones, asi que exige sesion y propiedad: `requireOwned`
   * resuelve la tienda desde el token, nunca desde un parametro.
   */
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser | null): Promise<PaymentDto[]> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    const payments = await this.payments.listForStore(store);
    return payments.map(toPaymentDto);
  }

  @Post('connect')
  async connect(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<{ authorizationUrl: string }> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    return this.payments.startConnection(store);
  }

  @Delete('account')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser | null): Promise<void> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    await this.payments.disconnect(store);
  }
}

/**
 * Verificación: la del comercio y la de la persona.
 *
 * Vale la pena repetirlo acá, donde alguien va a leerlo antes de agregar un
 * guard: **nada de esto es un requisito**. Ningún otro endpoint del producto
 * consulta estos estados para decidir si dejar vender, transmitir o cobrar.
 */
@Controller()
export class VerificationController {
  constructor(
    private readonly verifications: VerificationService,
    private readonly stores: StoreService,
  ) {}

  @Get('seller/verification/business')
  async business(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<VerificationStatusDto | null> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    const verification = await this.verifications.businessFor(store.id);
    return verification ? toVerificationStatusDto(verification) : null;
  }

  @Post('seller/verification/business')
  async submitBusiness(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(businessVerificationRequestSchema)) body: BusinessVerificationRequest,
  ): Promise<VerificationStatusDto> {
    const store = await this.stores.requireOwned(requireUser(user).id);
    return toVerificationStatusDto(await this.verifications.submitBusiness(store, body));
  }

  @Get('me/verification')
  async identity(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<VerificationStatusDto | null> {
    const verification = await this.verifications.identityFor(requireUser(user).id);
    return verification ? toVerificationStatusDto(verification) : null;
  }

  @Post('me/verification')
  async submitIdentity(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(identityVerificationRequestSchema)) body: IdentityVerificationRequest,
  ): Promise<VerificationStatusDto> {
    return toVerificationStatusDto(
      await this.verifications.submitIdentity(requireUser(user).id, body),
    );
  }
}
