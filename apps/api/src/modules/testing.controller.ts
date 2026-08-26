import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Module,
  Post,
  type DynamicModule,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/auth.guard';
import { ENV, type AppEnv } from '../config/env';
import { MemoryDatabase } from '../infrastructure/persistence/memory/memory-database';
import { PasswordService } from '../infrastructure/security/password.service';

/**
 * Devolver el mundo al estado sembrado, entre pruebas.
 *
 * ## Por qué existe
 *
 * El E2E corría contra una API compartida por toda la suite, así que cada spec
 * heredaba lo que el anterior había dejado: una puja con pedido, un pedido a
 * medio pagar, stock consumido. El resultado dependía del orden, y peor,
 * dependía de si el servidor venía de una corrida previa. Un test que falla por
 * basura vieja miente en las dos direcciones — a veces falla sin haber roto
 * nada, a veces pasa porque el estado que necesitaba lo dejó otro.
 *
 * La alternativa era que cada spec se creara sus propios datos. Es más trabajo,
 * y además abandona lo que el conjunto sembrado aporta: los specs se leen como
 * el producto, con Ana comprándole a Martina, en vez de como una fábrica de
 * fixtures.
 *
 * ## Por qué es seguro
 *
 * El módulo **no se registra** salvo que se cumplan las tres a la vez:
 *
 *  1. `NODE_ENV=test`
 *  2. `DATA_DRIVER=memory` — no hay forma de que apunte a una base real
 *  3. `E2E_RESET_TOKEN` presente
 *
 * En producción falla la primera, y aunque alguien lograra las tres, la ruta
 * exige el token en un header y lo compara en tiempo constante. No es que sea
 * improbable llegar acá: es que la ruta no existe.
 */
@Controller('testing')
export class TestingController {
  private readonly logger = new Logger('Testing');

  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly passwords: PasswordService,
    private readonly db: MemoryDatabase,
  ) {}

  /**
   * Vuelve a sembrar. Idempotente y sin efectos fuera del proceso.
   *
   * `force: true` limpia todo primero, incluidos pagos, pujas, cuentas de cobro
   * e idempotencia: si algo quedara, sería exactamente lo que hace que un spec
   * dependa de otro.
   */
  @Public()
  @Post('reset')
  @HttpCode(204)
  async reset(@Headers('x-e2e-reset') token?: string): Promise<void> {
    const expected = this.env.E2E_RESET_TOKEN ?? '';
    const given = token ?? '';
    const ok =
      expected.length > 0 &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));

    if (!ok) throw new ForbiddenException();

    await this.db.seed((plain) => this.passwords.hash(plain), { force: true });
    this.logger.log('Estado reiniciado al conjunto sembrado.');
  }
}

@Module({})
export class TestingModule {
  /**
   * Devuelve el módulo solo cuando las tres condiciones se cumplen.
   *
   * Un `DynamicModule` vacío es la forma de decir "esta ruta no existe": no se
   * registra el controlador, así que no hay nada que proteger con un guard ni
   * nada que alguien pueda alcanzar por error.
   */
  static register(env: AppEnv): DynamicModule {
    const enabled =
      env.NODE_ENV === 'test' && env.DATA_DRIVER === 'memory' && Boolean(env.E2E_RESET_TOKEN);

    return enabled
      ? { module: TestingModule, controllers: [TestingController] }
      : { module: TestingModule };
  }
}
