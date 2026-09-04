import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PipeTransform,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { DomainError, type DomainErrorCode } from '@vivo/domain';
import type { ApiErrorBody } from '@vivo/shared';
import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { AuthenticatedUser } from './auth.guard';

// --- Validation ------------------------------------------------------------------

/**
 * Validates request bodies and queries with the very same zod schemas the web
 * app uses for its forms. One definition, both sides, so client and server can
 * never disagree about what is valid.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }

    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Revisá los datos ingresados.',
      fieldErrors,
    } satisfies ApiErrorBody);
  }
}

export const zodPipe = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);

// --- Error translation -------------------------------------------------------------

/** Domain failures carry meaning; the transport only has to pick a status. */
const DOMAIN_STATUS: Partial<Record<DomainErrorCode, HttpStatus>> = {
  // Moderación (M14). Los tres son conflictos de estado, no cuerpos inválidos:
  // el pedido está bien formado y aun así no se puede hacer.
  CANNOT_BLOCK_SELF: HttpStatus.CONFLICT,
  CANNOT_REPORT_SELF: HttpStatus.CONFLICT,
  REPORT_ALREADY_RESOLVED: HttpStatus.CONFLICT,
  OUT_OF_STOCK: HttpStatus.CONFLICT,
  PRODUCT_NOT_PURCHASABLE: HttpStatus.CONFLICT,
  STORE_NOT_ACTIVE: HttpStatus.CONFLICT,
  INVALID_ORDER_TRANSITION: HttpStatus.CONFLICT,
  INVALID_LIVE_TRANSITION: HttpStatus.CONFLICT,
  VARIANT_NOT_FOUND: HttpStatus.NOT_FOUND,
  LIVE_PRODUCT_NOT_ATTACHED: HttpStatus.NOT_FOUND,
  NOT_STORE_OWNER: HttpStatus.FORBIDDEN,
  // --- Commerce hardening ------------------------------------------------
  PRODUCT_UNAVAILABLE: HttpStatus.CONFLICT,
  VARIANT_UNAVAILABLE: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  INVALID_IDEMPOTENCY_KEY: HttpStatus.BAD_REQUEST,
  ORDER_CREATION_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  // --- Live infrastructure -------------------------------------------------
  // A session in the wrong state is a conflict, not bad input: the same
  // request would have succeeded a minute earlier.
  LIVE_NOT_JOINABLE: HttpStatus.CONFLICT,
  NOT_BROADCASTER: HttpStatus.FORBIDDEN,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  // The provider is down, not the request wrong. 503 tells a client it is
  // worth retrying, which for a seller pressing "Transmitir" it usually is.
  STREAMING_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  // --- Cobros y confianza --------------------------------------------------
  // Un aviso viejo que llega tarde no es una petición mal formada: es un
  // conflicto con el estado actual.
  INVALID_PAYMENT_TRANSITION: HttpStatus.CONFLICT,
  // El vendedor tiene que conectar su cuenta. La petición está bien.
  SELLER_PAYMENT_ACCOUNT_MISSING: HttpStatus.CONFLICT,
  SELLER_PAYMENT_ACCOUNT_INVALID: HttpStatus.CONFLICT,
  PAYMENT_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INVALID_OAUTH_STATE: HttpStatus.BAD_REQUEST,
  INVALID_VERIFICATION_TRANSITION: HttpStatus.CONFLICT,
  VERIFICATION_DETAILS_INCOMPLETE: HttpStatus.BAD_REQUEST,
  INVALID_PROTECTION_TRANSITION: HttpStatus.CONFLICT,
  // --- Modo Puja -----------------------------------------------------------
  // Igual que arriba: una puja que se cerró mientras la oferta viajaba es un
  // conflicto. La misma petición habría funcionado un segundo antes, y un 400
  // le diría al comprador que se equivocó cuando no fue así.
  INVALID_BID_SESSION_TRANSITION: HttpStatus.CONFLICT,
  BID_SESSION_NOT_OPEN: HttpStatus.CONFLICT,
  BID_SESSION_ALREADY_OPEN: HttpStatus.CONFLICT,
  BID_NOT_ACTIVE: HttpStatus.CONFLICT,
  BID_RESERVATION_EXPIRED: HttpStatus.CONFLICT,
  // Estos sí son la petición: el monto es inválido, o la oferta no pertenece
  // a esta puja.
  BID_TOO_LOW: HttpStatus.BAD_REQUEST,
  INVALID_BID_AMOUNT: HttpStatus.BAD_REQUEST,
  BID_NOT_IN_SESSION: HttpStatus.BAD_REQUEST,
  // --- Borrado de cuenta ---------------------------------------------------
  // Conflicto y no 400: la petición está perfecta, lo que pasa es que el mundo
  // todavía no permite ese borrado. La misma petición va a funcionar cuando se
  // cierre el último pedido, y un 400 diría que se equivocó al pedirlo.
  ACCOUNT_HAS_PENDING_SALES: HttpStatus.CONFLICT,
  ACCOUNT_HAS_PENDING_ORDERS: HttpStatus.CONFLICT,
  // Esta sí es la petición: lo que escribió no coincide.
  ACCOUNT_CONFIRMATION_MISMATCH: HttpStatus.BAD_REQUEST,
  // No es un error de datos: es algo que esta persona no puede hacer.
  CANNOT_BID_ON_OWN_STORE: HttpStatus.FORBIDDEN,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const { status, body } = this.describe(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: DOMAIN_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST,
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const status = exception.getStatus();

      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        return { status, body: payload as ApiErrorBody };
      }
      return {
        status,
        body: { code: defaultCodeFor(status), message: exception.message },
      };
    }

    // Nothing unexpected leaks outward: the stack is logged, the client gets a
    // stable code and a sentence it can show a person.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' },
    };
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

// --- Request-scoped helpers ---------------------------------------------------------

/** Injects the authenticated user, or null on a public route. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | null => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user ?? null;
  },
);

/**
 * A stable key for one anonymous viewer, used by the presence store so viewer
 * counts do not depend on being signed in.
 */
export const ViewerKey = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  if (request.user) return `user:${String(request.user.id)}`;

  const forwarded = request.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? request.ip ?? 'unknown');
  const agent = request.headers['user-agent'] ?? '';
  return `anon:${ip}:${agent.slice(0, 40)}`;
});
