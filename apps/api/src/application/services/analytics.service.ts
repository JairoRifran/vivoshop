import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UserId } from '@vivo/domain';
import type { AnalyticsEventRequest } from '@vivo/shared';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { AnalyticsRepository } from '../ports/repositories';
import { ANALYTICS_REPOSITORY, CLOCK, ID_GENERATOR } from '../ports/tokens';

/**
 * Analytics collection point.
 *
 * M01 records events into the active driver and logs them. The value is not
 * the storage, it is that every call site already emits a named event with a
 * typed payload, so pointing this at PostHog, BigQuery or Segment later is a
 * change to this one method.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('Analytics');

  constructor(
    @Inject(ANALYTICS_REPOSITORY) private readonly repository: AnalyticsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async record(event: AnalyticsEventRequest, userId: UserId | null): Promise<void> {
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : this.clock.now();

    await this.repository.record({
      id: this.ids.generate('evt'),
      name: event.name,
      userId,
      properties: event.properties,
      occurredAt,
    });

    this.logger.debug?.(`${event.name} ${JSON.stringify(event.properties)}`);
  }
}
