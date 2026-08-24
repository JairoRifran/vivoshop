import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { User, UserId } from '@vivo/domain';
import { asUserId, normalizeEmail, withRole } from '@vivo/domain';
import type { RegisterRequest, SessionDto, UpdateProfileRequest, UserDto } from '@vivo/shared';
import { PasswordService } from '../../infrastructure/security/password.service';
import { TokenService } from '../../infrastructure/security/token.service';
import { toUserDto } from '../mappers/dto.mappers';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { UserRepository } from '../ports/repositories';
import { CLOCK, ID_GENERATOR, USER_REPOSITORY } from '../ports/tokens';

/**
 * Accounts are single and additive: everybody registers as a buyer, and
 * becoming a seller adds a role to that same account. There is no separate
 * seller sign-up, and no way to end up with two identities for one person.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterRequest): Promise<SessionDto> {
    const email = normalizeEmail(input.email);

    if (await this.users.findByEmail(email)) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Ya existe una cuenta con ese email.',
      });
    }

    const now = this.clock.now();
    const user: User = {
      id: asUserId(this.ids.generate('usr')),
      name: input.name.trim(),
      email,
      phone: input.phone ?? null,
      avatarUrl: null,
      country: input.country,
      roles: ['buyer'],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.users.create(user, await this.passwords.hash(input.password));
    return this.issueSession(created);
  }

  async login(email: string, password: string): Promise<SessionDto> {
    const credentials = await this.users.findCredentialsByEmail(normalizeEmail(email));

    // A missing account and a wrong password must be indistinguishable, and
    // both must take a comparable amount of time.
    const hash = credentials?.passwordHash ?? PLACEHOLDER_HASH;
    const valid = await this.passwords.verify(password, hash);

    if (!credentials || !valid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email o contraseña incorrectos.',
      });
    }

    const user = await this.users.findById(credentials.userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email o contraseña incorrectos.',
      });
    }

    return this.issueSession(user);
  }

  async requireUser(id: UserId): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario inexistente.' });
    return user;
  }

  async me(id: UserId): Promise<UserDto> {
    return toUserDto(await this.requireUser(id));
  }

  async updateProfile(id: UserId, input: UpdateProfileRequest): Promise<UserDto> {
    const current = await this.requireUser(id);
    const updated = await this.users.update({
      ...current,
      name: input.name?.trim() ?? current.name,
      phone: input.phone === undefined ? current.phone : input.phone,
      avatarUrl: input.avatarUrl === undefined ? current.avatarUrl : input.avatarUrl,
      updatedAt: this.clock.now(),
    });
    return toUserDto(updated);
  }

  /** Called by the store service once a store exists for this user. */
  async grantSellerRole(id: UserId): Promise<User> {
    const current = await this.requireUser(id);
    if (current.roles.includes('seller')) return current;

    return this.users.update({
      ...current,
      roles: withRole(current.roles, 'seller'),
      updatedAt: this.clock.now(),
    });
  }

  private async issueSession(user: User): Promise<SessionDto> {
    const { token, expiresAt } = await this.tokens.issue({ userId: user.id, roles: user.roles });
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(user) };
  }
}

/**
 * A real scrypt hash of a value nobody knows, used to keep the failure path
 * for an unknown email as expensive as the one for a wrong password.
 */
const PLACEHOLDER_HASH =
  'scrypt$64$00000000000000000000000000000000$' + '0'.repeat(128);
