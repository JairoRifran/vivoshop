import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { asLiveSessionId, type LiveStatus } from '@vivo/domain';
import {
  postMessageRequestSchema,
  reactRequestSchema,
  type LiveDetailDto,
  type LiveMessageDto,
  type LiveStatsDto,
  type LiveSummaryDto,
  type PostMessageRequest,
  type ReactRequest,
} from '@vivo/shared';
import { LiveService } from '../application/services/live.service';
import { TokenService } from '../infrastructure/security/token.service';
import { OptionalAuth, Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, ViewerKey, zodPipe } from '../common/http';

@Controller('live')
export class LiveController {
  constructor(
    private readonly live: LiveService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * A credential for the WebSocket handshake.
   *
   * The session itself lives in an httpOnly cookie that browser JavaScript
   * cannot read, which is the point — so the socket gets its own short-lived
   * token, minted here, valid only on the realtime audience.
   *
   * Anonymous visitors get `null` and connect as guests: watching, presence
   * and reading chat never require an account.
   */
  @OptionalAuth()
  @Post('realtime-token')
  async realtimeToken(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<{ token: string; expiresAt: string } | { token: null; expiresAt: null }> {
    if (!user) return { token: null, expiresAt: null };

    const issued = await this.tokens.issueRealtime({ userId: user.id, roles: user.roles });
    return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
  }

  @OptionalAuth()
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<LiveSummaryDto[]> {
    return this.live.list(
      {
        ...(status ? { status: status as LiveStatus } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
      },
      user?.id ?? null,
    );
  }

  /** Sessions from stores the signed-in buyer follows. */
  @Get('following')
  following(@CurrentUser() user: AuthenticatedUser | null): Promise<LiveSummaryDto[]> {
    return this.live.listFollowed(requireUser(user).id);
  }

  @OptionalAuth()
  @Get(':id')
  detail(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<LiveDetailDto> {
    return this.live.detail(asLiveSessionId(id), user?.id ?? null);
  }

  @Public()
  @Get(':id/messages')
  messages(@Param('id') id: string, @Query('limit') limit?: string): Promise<LiveMessageDto[]> {
    return this.live.listMessages(asLiveSessionId(id), limit ? Number(limit) : undefined);
  }

  @Post(':id/messages')
  postMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(postMessageRequestSchema)) body: PostMessageRequest,
  ): Promise<LiveMessageDto> {
    return this.live.postMessage(asLiveSessionId(id), requireUser(user), body.body);
  }

  /** Hearts arrive batched from the client, never one request per tap. */
  @Public()
  @Post(':id/reactions')
  react(
    @Param('id') id: string,
    @Body(zodPipe(reactRequestSchema)) body: ReactRequest,
  ): Promise<{ likeCount: number }> {
    return this.live.react(asLiveSessionId(id), body.count);
  }

  @Public()
  @Post(':id/join')
  join(@Param('id') id: string, @ViewerKey() viewerKey: string): Promise<{ viewerCount: number }> {
    return this.live.join(asLiveSessionId(id), viewerKey);
  }

  @Public()
  @Post(':id/leave')
  leave(@Param('id') id: string, @ViewerKey() viewerKey: string): Promise<{ viewerCount: number }> {
    return this.live.leave(asLiveSessionId(id), viewerKey);
  }

  @Public()
  @Get(':id/stats')
  stats(@Param('id') id: string): Promise<LiveStatsDto> {
    return this.live.stats(asLiveSessionId(id));
  }

  /**
   * A subscribe-only credential to watch.
   *
   * Public, because watching must never require an account: the distribution
   * model is a link pasted into WhatsApp.
   *
   * The anonymous identity is **random per request**, not derived from the
   * viewer's IP and user agent. That distinction only bites in production: two
   * people on the same home Wi-Fi, the same office, or behind the same carrier
   * NAT would hash to the same fingerprint, and a video provider treats a
   * duplicate participant identity as a reconnection — silently kicking the
   * first viewer out. Presence de-duplication still happens, but over the
   * realtime socket, where it belongs.
   *
   * Returns 200 with a null payload - not an error - when the session has no
   * video yet or is already over. That is a normal state, and the client
   * renders the right thing for it.
   */
  @OptionalAuth()
  @Post(':id/viewer-token')
  async viewerToken(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<{ credentials: unknown | null }> {
    const credentials = await this.live.issueViewerCredentials(asLiveSessionId(id), {
      userId: user?.id ?? null,
      identityKey: `guest_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      displayName: user?.name ?? 'Invitado',
    });
    return { credentials };
  }
}
