import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User, UserId, UserRole } from '@vivo/domain';
import type { Request } from 'express';
import type { UserRepository } from '../application/ports/repositories';
import { USER_REPOSITORY } from '../application/ports/tokens';
import { TokenService } from '../infrastructure/security/token.service';

export type AuthenticatedUser = User;

/** Route is reachable without a token. */
export const PUBLIC_KEY = 'auth:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Route works signed in or out, but resolves the user when a token is present.
 * Used by browse surfaces that show "following" state to signed-in visitors.
 */
export const OPTIONAL_KEY = 'auth:optional';
export const OptionalAuth = () => SetMetadata(OPTIONAL_KEY, true);

export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Bearer-token authentication, applied globally. Routes opt out with
 * `@Public()` or soften to `@OptionalAuth()`; the default is closed, which is
 * the only default worth having.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ?? false;
    const isOptional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_KEY, targets) ?? false;
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? [];

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearer(request);

    if (!token) {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Iniciá sesión para continuar.',
      });
    }

    const claims = await this.tokens.verify(token);
    const user = claims ? await this.users.findById(claims.userId as UserId) : null;

    if (!user || user.status !== 'active') {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Tu sesión expiró. Ingresá de nuevo.',
      });
    }

    request.user = user;

    if (requiredRoles.length > 0 && !requiredRoles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Activá el modo vendedor para acceder a esta sección.',
      });
    }

    return true;
  }
}

function extractBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}

/** Narrows `CurrentUser` for routes that already require authentication. */
export function requireUser(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Iniciá sesión para continuar.',
    });
  }
  return user;
}
