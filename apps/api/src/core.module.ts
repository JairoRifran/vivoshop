import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './config/env';
import { CLOCK, ID_GENERATOR } from './application/ports/tokens';
import { PasswordService } from './infrastructure/security/password.service';
import { TokenService } from './infrastructure/security/token.service';
import { SystemClock, UuidGenerator } from './infrastructure/system';

/**
 * Cross-cutting singletons that every other module may assume exist:
 * validated configuration, the clock, id generation and the security
 * primitives. Global so nothing has to import it explicitly, and the single
 * owner of these tokens so there is never an ambiguous duplicate binding.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    PasswordService,
    TokenService,
  ],
  exports: [ENV, CLOCK, ID_GENERATOR, PasswordService, TokenService],
})
export class CoreModule {}
