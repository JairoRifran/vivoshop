import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  DomainError,
  asUserId,
  normalizeEmail,
  resolveIdentityOutcome,
  safeReturnPath,
  type AuthProvider,
  type ProviderProfile,
  type User,
  type UserIdentity,
} from '@vivo/domain';
import type { SessionDto } from '@vivo/shared';
import { TokenService } from '../../infrastructure/security/token.service';
import { toUserDto } from '../mappers/dto.mappers';
import type { Clock, IdGenerator, IdentityProvider } from '../ports/infrastructure';
import type {
  LoginStateRepository,
  UserIdentityRepository,
  UserRepository,
} from '../ports/repositories';
import {
  CLOCK,
  ID_GENERATOR,
  IDENTITY_PROVIDERS,
  LOGIN_STATE_REPOSITORY,
  USER_IDENTITY_REPOSITORY,
  USER_REPOSITORY,
} from '../ports/tokens';

/**
 * Diez minutos, igual que el `state` de Mercado Pago.
 *
 * Alcanza de sobra para autorizar —incluso eligiendo cuenta y escribiendo una
 * contraseña— y no deja la ventana abierta toda la tarde.
 */
const LOGIN_STATE_TTL_SECONDS = 600;

export interface SocialSignInResult {
  /**
   * El vale de un minuto para canjear por la sesión, no la sesión.
   *
   * Viaja por la URL de vuelta a la web, y por eso es un vale y no un JWT de
   * sesión. Ver `EXCHANGE_AUDIENCE` en `TokenService`.
   */
  readonly ticket: string | null;
  readonly returnTo: string;
  /**
   * Cuando hay que pedir la contraseña en vez de entrar.
   *
   * Es el desenlace incómodo de `resolveIdentityOutcome`: existe una cuenta con
   * ese email y el proveedor no lo verificó. Ver el porqué allá.
   */
  readonly needsPasswordFor: string | null;
}

/**
 * Entrar con Google (o con Meta), de punta a punta.
 *
 * ```
 * /auth/google/start  ── guarda state+PKCE ──►  proveedor
 *                                                  │
 * /auth/google/callback  ◄── code + state ─────────┘
 *        │
 *        ├─ consume el state (una sola vez)
 *        ├─ canjea el code por un perfil
 *        ├─ el DOMINIO decide: entrar / vincular / registrar / pedir contraseña
 *        └─ emite la misma sesión de siempre
 * ```
 *
 * La sesión que sale de acá es idéntica a la del login con contraseña: mismo
 * `TokenService`, mismo JWT, misma cookie. Eso es lo que hace que todo el resto
 * de la aplicación no se entere de que existe el ingreso social.
 */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    @Inject(IDENTITY_PROVIDERS) private readonly providers: readonly IdentityProvider[],
    @Inject(LOGIN_STATE_REPOSITORY) private readonly states: LoginStateRepository,
    @Inject(USER_IDENTITY_REPOSITORY) private readonly identities: UserIdentityRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly tokens: TokenService,
  ) {}

  /** Los que están habilitados, para que la pantalla dibuje solo esos botones. */
  available(): AuthProvider[] {
    return this.providers.map((provider) => provider.key);
  }

  /**
   * Arranca el ingreso: guarda el `state` y devuelve a dónde mandar a la persona.
   *
   * El `state` y el verificador PKCE se generan acá y se guardan del lado del
   * servidor. Ninguno de los dos viaja al navegador —solo el `state` opaco y el
   * *challenge*, que es un hash— y esa es toda la protección: sin el `state`
   * guardado, cualquiera puede inducir a alguien a completar un ingreso que no
   * pidió; sin el verificador, un código robado se puede canjear.
   */
  async start(input: {
    provider: string;
    returnTo: string | null;
    redirectUri: string;
  }): Promise<{ url: string }> {
    const provider = this.require(input.provider);

    // 32 bytes de aleatoriedad criptográfica en los dos. Un `state` adivinable
    // no es un `state`.
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const now = this.clock.now();

    await this.states.create({
      state,
      provider: provider.key,
      codeVerifier,
      returnTo: safeReturnPath(input.returnTo),
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_STATE_TTL_SECONDS * 1_000),
      consumedAt: null,
    });

    return {
      url: provider.authorizationUrl({
        state,
        codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
        redirectUri: input.redirectUri,
      }),
    };
  }

  /**
   * Vuelve del proveedor: comprueba, decide y emite la sesión.
   *
   * El `state` se consume antes que nada. Si no existe, venció o ya se usó, no
   * se canjea ningún código: un callback sin un `state` nuestro es, por
   * definición, un callback que no pedimos.
   */
  async callback(input: {
    provider: string;
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<SocialSignInResult> {
    const provider = this.require(input.provider);
    const now = this.clock.now();

    const pending = await this.states.consume(input.state, now);
    if (!pending || pending.provider !== provider.key) {
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'El ingreso venció o no lo iniciaste vos. Probá de nuevo.',
      });
    }

    const profile = await provider.exchange({
      code: input.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: input.redirectUri,
    });

    const returnTo = safeReturnPath(pending.returnTo);
    const session = await this.applyOutcome(provider.key, profile);

    if (session.kind === 'needs_password') {
      return { ticket: null, returnTo, needsPasswordFor: session.email };
    }

    const { token } = await this.tokens.issueExchange({
      userId: session.user.id,
      roles: session.user.roles,
    });
    return { ticket: token, returnTo, needsPasswordFor: null };
  }

  /**
   * Aplica lo que decidió el dominio.
   *
   * Esta función no decide nada: traduce cada desenlace a escrituras. Toda la
   * política —cuándo se vincula y cuándo no— vive en `resolveIdentityOutcome`,
   * donde se puede leer y probar sin una base de datos.
   */
  private async applyOutcome(
    provider: AuthProvider,
    profile: ProviderProfile,
  ): Promise<{ kind: 'user'; user: User } | { kind: 'needs_password'; email: string }> {
    const email = profile.email ? normalizeEmail(profile.email) : null;

    const [existingIdentity, userForEmail] = await Promise.all([
      this.identities.find(provider, profile.providerUserId),
      email ? this.users.findByEmail(email) : Promise.resolve(null),
    ]);

    const outcome = resolveIdentityOutcome({
      profile: { ...profile, email },
      existingIdentity,
      userIdForEmail: userForEmail?.id ?? null,
    });

    switch (outcome.kind) {
      case 'sign_in':
        return { kind: 'user', user: await this.requireUser(outcome.userId) };

      case 'link': {
        await this.linkIdentity(provider, profile, outcome.userId, email);
        return { kind: 'user', user: await this.requireUser(outcome.userId) };
      }

      case 'register': {
        const created = await this.register(profile, email);
        await this.linkIdentity(provider, profile, created.id, email);
        return { kind: 'user', user: created };
      }

      case 'needs_password':
        return { kind: 'needs_password', email: outcome.email };
    }
  }

  private async linkIdentity(
    provider: AuthProvider,
    profile: ProviderProfile,
    userId: ReturnType<typeof asUserId>,
    email: string | null,
  ): Promise<UserIdentity> {
    return this.identities.link({
      provider,
      providerUserId: profile.providerUserId,
      userId,
      email,
      createdAt: this.clock.now(),
    });
  }

  /**
   * Crea la cuenta a partir de lo que dijo el proveedor.
   *
   * Sin contraseña: `password_hash` queda nulo, y el login por contraseña lo
   * trata como credenciales inválidas. Quien entró con Google y algún día
   * quiera una contraseña la va a poder poner desde su perfil; hasta entonces,
   * su forma de entrar es Google.
   *
   * La foto **no** se copia. El proveedor sirve una URL de su propio dominio
   * que puede cambiar o desaparecer, y guardarla haría exactamente lo que M06
   * prohibió: un avatar apuntando a un servidor ajeno. Si la quiere, la sube.
   */
  private async register(profile: ProviderProfile, email: string | null): Promise<User> {
    if (!email) {
      throw new DomainError('IDENTITY_EMAIL_REQUIRED', 'El proveedor no compartió un email.', {});
    }

    const now = this.clock.now();
    return this.users.create(
      {
        id: asUserId(this.ids.generate('usr')),
        name: profile.name?.trim() || email.split('@')[0] || 'Sin nombre',
        email,
        phone: null,
        avatarUrl: null,
        bio: null,
        passwordChangedAt: null,
        country: 'UY',
        roles: ['buyer'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      // Null explícito: esta cuenta no se abre con contraseña.
      null,
    );
  }

  /** Canjea el vale por la sesión de verdad. Lo llama la web, del lado del servidor. */
  async exchange(ticket: string): Promise<SessionDto> {
    const claims = await this.tokens.verifyExchange(ticket);
    if (!claims) {
      throw new BadRequestException({
        code: 'INVALID_OAUTH_STATE',
        message: 'El ingreso venció. Probá de nuevo.',
      });
    }
    return this.issueSession(await this.requireUser(claims.userId));
  }

  private async requireUser(userId: ReturnType<typeof asUserId>): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      // El dominio devolvió un id que la base no tiene. No es recuperable y no
      // se puede decir en la pantalla sin filtrar cómo funciona esto por dentro.
      this.logger.error(`El ingreso social resolvió un usuario inexistente: ${String(userId)}`);
      throw new BadRequestException({
        code: 'IDENTITY_UNAVAILABLE',
        message: 'No pudimos completar el ingreso. Probá de nuevo.',
      });
    }
    return user;
  }

  private async issueSession(user: User): Promise<SessionDto> {
    const { token, expiresAt } = await this.tokens.issue({ userId: user.id, roles: user.roles });
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(user) };
  }

  private require(name: string): IdentityProvider {
    const provider = this.providers.find((candidate) => candidate.key === name);
    if (!provider) {
      throw new BadRequestException({
        code: 'IDENTITY_PROVIDER_DISABLED',
        message: 'Ese modo de ingreso no está disponible.',
      });
    }
    return provider;
  }
}
