import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Clock, IdGenerator } from '../application/ports/infrastructure';

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Prefixed UUIDs. The prefix costs nothing and makes every log line, URL and
 * database row self-describing: `ord_3f2a...` is unmistakably an order.
 */
@Injectable()
export class UuidGenerator implements IdGenerator {
  generate(prefix?: string): string {
    const id = randomUUID();
    return prefix ? `${prefix}_${id}` : id;
  }
}

/** Deterministic counterpart used by tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(value: Date): void {
    this.current = value;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  generate(prefix?: string): string {
    this.counter += 1;
    const id = String(this.counter).padStart(6, '0');
    return prefix ? `${prefix}_${id}` : id;
  }
}
