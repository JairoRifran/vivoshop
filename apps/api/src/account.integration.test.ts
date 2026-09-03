import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';
import { CLOCK } from './application/ports/tokens';
import { MemoryDatabase } from './infrastructure/persistence/memory/memory-database';
import { PasswordService } from './infrastructure/security/password.service';
import { FixedClock } from './infrastructure/system';
import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * Borrar la cuenta, sobre HTTP real.
 *
 * Lo que se afirma acá no es que la ruta devuelva 204: es **qué quedó en la
 * base después**. Un borrado que responde bien y deja el correo intacto es
 * exactamente el fallo que estas pruebas existen para atrapar.
 */
let app: INestApplication;
let http: () => request.Agent;
let clock: FixedClock;
let db: MemoryDatabase;
let throttler: ThrottlerStorage;

const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };
const MARTINA = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

/** Busca a alguien por correo en la base sembrada. */
function userByEmail(email: string) {
  return [...db.users.values()].find((u) => u.email === email);
}

/**
 * Cierra todo lo que esta persona tiene en vuelo, de los dos lados.
 *
 * El mundo sembrado le deja pedidos abiertos a casi todos —es lo que hace que
 * las demás suites tengan algo que mirar— y sin esto ninguna prueba del camino
 * feliz llega a borrar nada. Cerrarlos acá es establecer la precondición, no
 * heredarla.
 */
function cerrarPedidosDe(email: string): void {
  const usuario = userByEmail(email);
  const id = String(usuario?.id);
  const suyas = new Set(
    [...db.stores.values()].filter((s) => String(s.ownerId) === id).map((s) => String(s.id)),
  );
  for (const [clave, order] of db.orders) {
    const mio = String(order.buyerId) === id || suyas.has(String(order.storeId));
    if (mio) db.orders.set(clave, { ...order, status: 'completed' });
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'account-integration-secret-00000000';
  process.env.RATE_LIMIT = '100000';

  clock = new FixedClock(new Date('2026-09-01T12:00:00Z'));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
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

beforeEach(async () => {
  clock.set(new Date('2026-09-01T12:00:00Z'));
  (throttler as unknown as { storage: Map<string, unknown> }).storage.clear();
  await db.seed((plain) => new PasswordService().hash(plain), { force: true });
});

describe('quién puede borrar', () => {
  it('sin sesión no se puede ni consultar', async () => {
    await http().get('/auth/account/deletion').expect(401);
    await http().post('/auth/account/delete').send({ confirmation: ANA.email }).expect(401);
  });

  it('la cuenta que se borra sale del token, no del cuerpo', async () => {
    // No hay forma de nombrar a otra persona: el cuerpo solo lleva la
    // confirmación, y se compara contra el correo de la sesión.
    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: MARTINA.email })
      .expect(400);
  });
});

describe('la confirmación', () => {
  it('rechaza cualquier cosa que no sea el propio correo', async () => {
    const token = await tokenFor(ANA);
    const response = await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: 'ELIMINAR' })
      .expect(400);
    expect(response.body.code).toBe('ACCOUNT_CONFIRMATION_MISMATCH');
  });

  it('acepta el correo con otras mayúsculas y con espacios', async () => {
    cerrarPedidosDe(ANA.email);
    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: '  ANA@VIVO.UY  ' })
      .expect(204);
  });

  it('no borra nada cuando la confirmación falla', async () => {
    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: 'no' })
      .expect(400);

    expect(userByEmail(ANA.email)?.status).toBe('active');
  });
});

describe('qué queda después de borrar', () => {
  it('el correo se libera y el nombre desaparece', async () => {
    cerrarPedidosDe(ANA.email);
    const antes = userByEmail(ANA.email);
    expect(antes).toBeTruthy();

    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: ANA.email })
      .expect(204);

    // El correo original ya no le pertenece a nadie: se puede volver a
    // registrar mañana con la misma dirección.
    expect(userByEmail(ANA.email)).toBeUndefined();

    const despues = db.users.get(String(antes?.id));
    expect(despues?.status).toBe('deleted');
    expect(despues?.name).toBe('Cuenta eliminada');
    expect(despues?.email).toMatch(/\.invalid$/);
    expect(despues?.phone).toBeNull();
    expect(despues?.avatarUrl).toBeNull();
  });

  it('la sesión que borró muere en la petición siguiente', async () => {
    cerrarPedidosDe(ANA.email);
    const token = await tokenFor(ANA);
    await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: ANA.email })
      .expect(204);

    // Reusa la maquinaria de M08: anonimizar fecha el corte de sesiones igual
    // que lo hace cambiar la contraseña.
    clock.advance(2_000);
    await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('la contraseña deja de servir', async () => {
    cerrarPedidosDe(ANA.email);
    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: ANA.email })
      .expect(204);

    await http().post('/auth/login').send(ANA).expect(401);
  });

  it('se van las suscripciones a avisos y lo que seguía', async () => {
    cerrarPedidosDe(ANA.email);
    const usuario = userByEmail(ANA.email);
    const id = String(usuario?.id);
    const seguiaAntes = [...db.follows.values()].filter((f) => String(f.userId) === id);
    expect(seguiaAntes.length).toBeGreaterThan(0);

    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: ANA.email })
      .expect(204);

    expect([...db.follows.values()].filter((f) => String(f.userId) === id)).toHaveLength(0);
    expect(
      [...db.pushSubscriptions.values()].filter((s) => String(s.userId) === id),
    ).toHaveLength(0);
  });

  it('los mensajes del chat se despersonalizan pero el texto queda', async () => {
    cerrarPedidosDe(ANA.email);
    const usuario = userByEmail(ANA.email);
    const id = String(usuario?.id);
    const mios = [...db.liveMessages.values()].filter((m) => String(m.authorId ?? '') === id);
    expect(mios.length, 'la siembra tenía que dejarle mensajes a Ana').toBeGreaterThan(0);
    const textos = mios.map((m) => m.body);

    const token = await tokenFor(ANA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: ANA.email })
      .expect(204);

    const despues = [...db.liveMessages.values()].filter((m) => String(m.authorId ?? '') === id);
    // Hubo otras personas en esa conversación: borrar el texto le sacaría
    // sentido a lo que escribieron los demás.
    expect(despues.map((m) => m.body)).toEqual(textos);
    for (const mensaje of despues) {
      expect(mensaje.authorName).toBe('Cuenta eliminada');
      expect(mensaje.authorAvatarUrl).toBeNull();
    }
  });
});

describe('lo que impide borrarse', () => {
  it('una venta sin cerrar bloquea, y lo dice antes del formulario', async () => {
    // Martina vende y el mundo sembrado le deja pedidos abiertos.
    const token = await tokenFor(MARTINA);
    const estado = await http()
      .get('/auth/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(estado.body.canDelete).toBe(false);
    expect(estado.body.pendingSales).toBeGreaterThan(0);

    const intento = await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: MARTINA.email })
      .expect(409);
    expect(intento.body.code).toBe('ACCOUNT_HAS_PENDING_SALES');

    // Y no tocó nada.
    expect(userByEmail(MARTINA.email)?.status).toBe('active');
  });

  it('la tienda queda pausada, no borrada, cuando el dueño se va', async () => {
    // Los pedidos históricos referencian la tienda: borrarla le rompe el
    // historial a quien compró ahí.
    const martina = userByEmail(MARTINA.email);
    const suTienda = [...db.stores.values()].find(
      (s) => String(s.ownerId) === String(martina?.id),
    );
    expect(suTienda).toBeTruthy();

    cerrarPedidosDe(MARTINA.email);

    const token = await tokenFor(MARTINA);
    await http()
      .post('/auth/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: MARTINA.email })
      .expect(204);

    const despues = db.stores.get(String(suTienda?.id));
    expect(despues, 'la tienda no se borra').toBeTruthy();
    expect(despues?.status).toBe('paused');
  });
});
