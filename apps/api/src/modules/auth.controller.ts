import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  type LoginRequest,
  type RegisterRequest,
  type SessionDto,
  type UpdateProfileRequest,
  type UserDto,
} from '@vivo/shared';
import { AuthService } from '../application/services/auth.service';
import { Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body(zodPipe(registerRequestSchema)) body: RegisterRequest): Promise<SessionDto> {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  login(@Body(zodPipe(loginRequestSchema)) body: LoginRequest): Promise<SessionDto> {
    return this.auth.login(body.email, body.password);
  }

  /**
   * Sign-out is a client-side concern while tokens are stateless: the web app
   * clears its cookie. The endpoint exists so clients have one place to call,
   * and so token revocation can be added here without a contract change.
   */
  @Public()
  @Post('logout')
  logout(): { ok: true } {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser | null): Promise<UserDto> {
    return this.auth.me(requireUser(user).id);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<UserDto> {
    return this.auth.updateProfile(requireUser(user).id, body);
  }
}
