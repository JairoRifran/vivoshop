import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';
import { CLOCK, EMAIL_PROVIDER } from './application/ports/tokens';
import { MemoryDatabase } from './infrastructure/persistence/memory/memory-database';
import { PasswordService } from './infrastructure/security/password.service';
import { FixedClock } from './infrastructure/system';
import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * Contraseñas, sobre HTTP real.
 *
 * El correo está espiado —lo que se afirma es a quién se le escribió y con qué
 * enlace, no que un servidor de terceros lo entregue— y todo lo demás es real:
 * el token hasheado en la base, su único uso, el vencimiento, y el corte de
 * sesiones que hace que restablecer sirva de algo.
 */
let app: INestApplication;
let http: () => request.Agent;
/**
 * El reloj del arnés, adelantable.
 *
 * Hace falta por una razón concreta: el `iat` de un JWT tiene resolución de un
 * segundo, así que una sesión emitida en el mismo segundo del cambio de
 * contraseña sobrevive —a propósito: es la de quien acaba de cambiarla—. Sin
 * poder mover el reloj, una prueba de "las sesiones viejas mueren" no puede
 * distinguir vieja de recién emitida, y afirmaría algo falso.
 *
 * Adelantarlo es honesto y además instantáneo. Dormir un segundo por prueba
 * sería una suite que nadie corre.
 */
let clock: FixedClock;
let db: MemoryDatabase;
/**
 * El contador del limitador, para vaciarlo entre pruebas.
 *
 * `forgot` acepta cinco por minuto, que es el limite mas bajo de la API y esta
 * bien que lo sea: cada llamada manda un correo a una direccion que elige quien
 * llama. Sin vaciarlo, la sexta prueba del archivo recibe 429 y falla por el
 * limite y no por lo que quiere medir.
 *
 * Vaciarlo es mejor que aflojar el limite en pruebas: asi el numero que corre
 * en la suite es el mismo que corre en produccion, y hay una prueba que lo
 * afirma de frente.
 */
let throttler: ThrottlerStorage;

const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };
const NUEVA = 'contrasena-nueva-larga';

/** Lo que el proveedor de correo recibió. */
const sent: Array<{ to: string; text: string }> = [];

/** Saca el token del enlace del último correo. */
function tokenFromLastEmail(): string {
  const last = sent.at(-1);
  expect(last, 'no se envió ningún correo').toBeTruthy();
  const match = /token=([^\s&]+)/.exec(last?.text ?? '');
  expect(match, 'el correo no traía un enlace con token').toBeTruthy();
  return decodeURIComponent(match?.[1] ?? '');
}

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.EMAIL_PROVIDER = 'log';
  process.env.WEB_PUBLIC_URL = 'http://web.local';
  process.env.JWT_SECRET = 'password-integration-secret-000000000';
  process.env.RATE_LIMIT = '100000';

  clock = new FixedClock(new Date('2026-09-01T12:00:00Z'));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue({
      key: 'spy',
      send: async (input: { to: string; text: string }) => {
        sent.push({ to: input.to, text: input.text });
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
  db = app.get(MemoryDatabase);
  throttler = app.get(ThrottlerStorage);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

/**
 * Cada prueba arranca del mundo sembrado.
 *
 * Sin esto, una prueba que cambia la contraseña de Ana obliga a la siguiente a
 * saber cuál quedó, y aparecen coreografías de restaurar el estado que fallan
 * en cuanto se reordena un `it`. La precondición se establece, no se hereda.
 */
beforeEach(async () => {
  sent.length = 0;
  clock.set(new Date('2026-09-01T12:00:00Z'));
  (throttler as unknown as { storage: Map<string, unknown> }).storage.clear();
  await db.seed((plain) => new PasswordService().hash(plain), { force: true });
});

describe('pedir el enlace', () => {
  it('manda un correo con un enlace a la web', async () => {
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(ANA.email);
    expect(sent[0]?.text).toContain('http://web.local/ingresar/restablecer?token=');
  });

  it('un email sin cuenta responde igual, y no manda nada', async () => {
    /**
     * La regla que atraviesa todo el milestone. Si la respuesta distinguiera,
     * el formulario sería un padrón: cualquiera podría probar direcciones y
     * quedarse con la lista de quién tiene cuenta acá. Eso alimenta phishing
     * dirigido y relleno de credenciales.
     */
    await http()
      .post('/auth/password/forgot')
      .send({ email: 'nadie-tiene-este-email@vivo.uy' })
      .expect(204);

    expect(sent).toHaveLength(0);
  });

  it('el enlace no lleva la contraseña ni nada de la cuenta', async () => {
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);

    const body = sent[0]?.text ?? '';
    expect(body).not.toContain(ANA.password);
    // Y dice qué hacer si no lo pidió, que es la mitad de para qué sirve avisar.
    expect(body).toContain('Si no lo pediste vos');
  });
});

describe('usar el enlace', () => {
  it('cambia la contraseña, y la vieja deja de servir', async () => {
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    const token = tokenFromLastEmail();

    await http()
      .post('/auth/password/reset')
      .send({ token, password: NUEVA })
      .expect(204);

    await http().post('/auth/login').send({ email: ANA.email, password: NUEVA }).expect(201);
    await http().post('/auth/login').send(ANA).expect(401);
  });

  it('el mismo enlace no sirve dos veces', async () => {
    /**
     * Sin esto, quien consigue el enlace —del historial, de un buzón
     * compartido, de una captura— puede volver a cambiar la contraseña después
     * de que su dueño ya la cambió, y quedarse con la cuenta.
     */
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    const token = tokenFromLastEmail();

    await http().post('/auth/password/reset').send({ token, password: NUEVA }).expect(204);
    await http().post('/auth/password/reset').send({ token, password: 'otra-mas' }).expect(400);

    // Y la contraseña quedó en la del primer uso, no en la del segundo intento.
    await http().post('/auth/login').send({ email: ANA.email, password: NUEVA }).expect(201);
  });

  it('pedir dos enlaces invalida el primero al usar el segundo', async () => {
    // Quien pidió tres correos y usó el último no debería quedarse con dos
    // llaves más dando vueltas en su buzón.
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    const primero = tokenFromLastEmail();

    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    const segundo = tokenFromLastEmail();
    expect(segundo).not.toBe(primero);

    await http().post('/auth/password/reset').send({ token: segundo, password: NUEVA }).expect(204);
    await http().post('/auth/password/reset').send({ token: primero, password: 'x'.repeat(12) }).expect(400);
  });

  it('un token inventado se rechaza', async () => {
    await http()
      .post('/auth/password/reset')
      .send({ token: 'no-es-un-token', password: NUEVA })
      .expect(400);
  });

  it('una contraseña muy corta se rechaza', async () => {
    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    await http()
      .post('/auth/password/reset')
      .send({ token: tokenFromLastEmail(), password: 'corta' })
      .expect(400);
  });
});

describe('las sesiones que había abiertas', () => {
  it('mueren al restablecer', async () => {
    /**
     * La mitad del punto de restablecer.
     *
     * Alguien entró a la cuenta y se cambia la contraseña para echarlo. Si su
     * sesión sobrevive, no lo echaste: sigue adentro hasta que su token venza
     * solo, que acá son siete días. Un restablecimiento que no cierra sesiones
     * es un teatro de seguridad.
     */
    const intruso = { Authorization: `Bearer ${await tokenFor(ANA)}` };
    await http().get('/auth/me').set(intruso).expect(200);

    // El `iat` de un JWT cuenta segundos enteros, así que sin mover el reloj
    // esta sesión sería del mismo segundo que el cambio y sobreviviría —que es
    // el comportamiento correcto para la sesión de quien acaba de cambiarla, y
    // no lo que esta prueba quiere medir.
    clock.advance(5_000);

    await http().post('/auth/password/forgot').send({ email: ANA.email }).expect(204);
    await http()
      .post('/auth/password/reset')
      .send({ token: tokenFromLastEmail(), password: NUEVA })
      .expect(204);

    await http().get('/auth/me').set(intruso).expect(401);

    // La sesión nueva sí funciona.
    const propia = { Authorization: `Bearer ${await tokenFor({ email: ANA.email, password: NUEVA })}` };
    await http().get('/auth/me').set(propia).expect(200);
  });
});

describe('cambiar la contraseña estando adentro', () => {
  it('exige la actual', async () => {
    // Sin esto, una sesión robada —una computadora que quedó abierta— alcanza
    // para cambiar la contraseña y dejar afuera al dueño de la cuenta.
    const auth = { Authorization: `Bearer ${await tokenFor(ANA)}` };

    await http().post('/auth/password/change').set(auth).send({ password: NUEVA }).expect(400);
  });

  it('rechaza una actual equivocada', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(ANA)}` };

    await http()
      .post('/auth/password/change')
      .set(auth)
      .send({ currentPassword: 'no-es-esa', password: NUEVA })
      .expect(400);
  });

  it('con la actual correcta, cambia y corta las demás sesiones', async () => {
    const vieja = { Authorization: `Bearer ${await tokenFor(ANA)}` };
    clock.advance(5_000);
    const propia = { Authorization: `Bearer ${await tokenFor(ANA)}` };

    await http()
      .post('/auth/password/change')
      .set(propia)
      .send({ currentPassword: ANA.password, password: NUEVA })
      .expect(204);

    await http().get('/auth/me').set(vieja).expect(401);
  });

  it('sin sesión no se puede', async () => {
    await http().post('/auth/password/change').send({ password: NUEVA }).expect(401);
  });
});

describe('quien entró con un proveedor y no tiene contraseña', () => {
  it('puede ponerse una sin que se le pida la actual', async () => {
    /**
     * Pedirle "la actual" sería pedirle algo que no existe. Y no abre un
     * agujero nuevo: quien tiene esa sesión ya podía usar la cuenta, y ponerle
     * una contraseña no le quita a nadie su forma de entrar.
     */
    const { body: target } = await http()
      .get('/auth/google/start')
      .expect(302)
      .then(async (response) => {
        const location = new URL(response.headers.location as string);
        const callback = await http()
          .get(`/auth/google/callback${location.search}`)
          .expect(302);
        return { body: new URL(callback.headers.location as string) };
      });

    const vale = target.searchParams.get('vale') as string;
    const { body: session } = await http().post('/auth/session/exchange').send({ vale }).expect(200);
    const auth = { Authorization: `Bearer ${session.token as string}` };

    // La API confirma que esta cuenta todavía no se abre con contraseña.
    const estado = await http().get('/auth/password/mine').set(auth).expect(200);
    expect(estado.body.hasPassword).toBe(false);

    await http().post('/auth/password/change').set(auth).send({ password: NUEVA }).expect(204);

    // Y ahora sí entra con contraseña, además de con el proveedor.
    await http()
      .post('/auth/login')
      .send({ email: session.user.email as string, password: NUEVA })
      .expect(201);

    const despues = await http()
      .get('/auth/password/mine')
      .set({ Authorization: `Bearer ${(await tokenFor({ email: session.user.email as string, password: NUEVA }))}` })
      .expect(200);
    expect(despues.body.hasPassword).toBe(true);
  });
});

describe('si la recuperación está disponible', () => {
  it('la pantalla lo puede preguntar sin sesión', async () => {
    const response = await http().get('/auth/password/status').expect(200);
    expect(response.body.canRecover).toBe(true);
  });
});
