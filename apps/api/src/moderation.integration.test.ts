import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { CLOCK } from './application/ports/tokens';
import { ApiExceptionFilter } from './common/http';
import { MemoryDatabase } from './infrastructure/persistence/memory/memory-database';
import { PasswordService } from './infrastructure/security/password.service';
import { FixedClock } from './infrastructure/system';

/**
 * Denunciar y bloquear, sobre HTTP real.
 *
 * Lo que importa acá no es que las rutas devuelvan 200: es que **bloquear
 * cambie lo que se ve**. Un botón de bloquear que responde bien y deja los
 * mensajes en pantalla es exactamente el fallo que estas pruebas existen para
 * atrapar, y es el que Google verifica cuando revisa la política de contenido
 * generado por usuarios.
 */
let app: INestApplication;
let http: () => request.Agent;
let clock: FixedClock;
let db: MemoryDatabase;
let throttler: ThrottlerStorage;

const AHORA = new Date('2026-09-04T12:00:00Z');
const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };
const MARTINA = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function tokenFor(c: { email: string; password: string }): Promise<string> {
  const r = await http().post('/auth/login').send(c).expect(201);
  return r.body.token as string;
}

function idDe(email: string): string {
  return String([...db.users.values()].find((u) => u.email === email)?.id);
}

function hacerAdmin(email: string): void {
  for (const [k, u] of db.users) {
    if (u.email === email) db.users.set(k, { ...u, roles: [...u.roles, 'admin'] });
  }
}

/** Un vivo con dos mensajes: uno de Ana y uno de Martina. */
function sembrarChat(): string {
  const sesion = [...db.liveSessions.values()][0];
  const liveId = String(sesion?.id);
  for (const k of [...db.liveMessages.keys()]) db.liveMessages.delete(k);

  const base = {
    liveSessionId: liveId,
    kind: 'chat' as const,
    createdAt: AHORA,
    authorAvatarUrl: null,
  };
  db.liveMessages.set('m1', {
    ...base,
    id: 'm1',
    authorId: idDe(ANA.email),
    authorName: 'Ana',
    body: 'hola',
  } as never);
  db.liveMessages.set('m2', {
    ...base,
    id: 'm2',
    authorId: idDe(MARTINA.email),
    authorName: 'Martina',
    body: 'que feo todo',
  } as never);
  db.liveMessages.set('m3', {
    ...base,
    id: 'm3',
    authorId: null,
    authorName: 'VivoShop',
    body: 'se agotó el stock',
  } as never);
  return liveId;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'moderation-integration-secret-0000';
  process.env.RATE_LIMIT = '100000';

  clock = new FixedClock(AHORA);
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
  clock.set(AHORA);
  (throttler as unknown as { storage: Map<string, unknown> }).storage.clear();
  await db.seed((plain) => new PasswordService().hash(plain), { force: true });
});

describe('bloquear cambia lo que se ve', () => {
  it('el chat esconde a quien bloqueaste, y solo para vos', async () => {
    const liveId = sembrarChat();
    const ana = await tokenFor(ANA);

    const antes = await http()
      .get(`/live/${liveId}/messages`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(200);
    expect(antes.body.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3']);

    await http()
      .post(`/users/${idDe(MARTINA.email)}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);

    const despues = await http()
      .get(`/live/${liveId}/messages`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(200);
    // Sin el de Martina, con el suyo y con el del sistema.
    expect(despues.body.map((m: { id: string }) => m.id)).toEqual(['m1', 'm3']);

    // Martina sigue viendo todo: el bloqueo es de ida.
    const martina = await tokenFor(MARTINA);
    const paraMartina = await http()
      .get(`/live/${liveId}/messages`)
      .set('Authorization', `Bearer ${martina}`)
      .expect(200);
    expect(paraMartina.body.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('sin sesión se ve el chat completo: no hay a quién esconderle nada', async () => {
    const liveId = sembrarChat();
    const anonimo = await http().get(`/live/${liveId}/messages`).expect(200);
    expect(anonimo.body).toHaveLength(3);
  });

  it('los avisos del sistema nunca se esconden', async () => {
    const liveId = sembrarChat();
    const ana = await tokenFor(ANA);
    await http()
      .post(`/users/${idDe(MARTINA.email)}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);

    const r = await http()
      .get(`/live/${liveId}/messages`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(200);
    // "se agotó el stock" no lo escribió nadie: esconderlo dejaría al comprador
    // sin saber qué pasó por haber bloqueado a otra persona.
    expect(r.body.some((m: { id: string }) => m.id === 'm3')).toBe(true);
  });

  it('desbloquear devuelve los mensajes', async () => {
    const liveId = sembrarChat();
    const ana = await tokenFor(ANA);
    const martinaId = idDe(MARTINA.email);

    await http()
      .post(`/users/${martinaId}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);
    await http()
      .delete(`/users/${martinaId}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);

    const r = await http()
      .get(`/live/${liveId}/messages`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(200);
    expect(r.body).toHaveLength(3);
  });
});

describe('las reglas de bloquear', () => {
  it('bloquearse a uno mismo no se puede', async () => {
    const ana = await tokenFor(ANA);
    const r = await http()
      .post(`/users/${idDe(ANA.email)}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(409);
    expect(r.body.code).toBe('CANNOT_BLOCK_SELF');
  });

  it('bloquear a alguien que no existe da 404, no una fila basura', async () => {
    const ana = await tokenFor(ANA);
    await http().post('/users/no-existe/block').set('Authorization', `Bearer ${ana}`).expect(404);
  });

  it('bloquear dos veces deja un solo bloqueo', async () => {
    const ana = await tokenFor(ANA);
    const martinaId = idDe(MARTINA.email);
    await http()
      .post(`/users/${martinaId}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);
    await http()
      .post(`/users/${martinaId}/block`)
      .set('Authorization', `Bearer ${ana}`)
      .expect(204);

    const lista = await http().get('/me/blocks').set('Authorization', `Bearer ${ana}`).expect(200);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0].name).toContain('Martina');
  });

  it('sin sesión no se puede bloquear ni listar', async () => {
    await http()
      .post(`/users/${idDe(MARTINA.email)}/block`)
      .expect(401);
    await http().get('/me/blocks').expect(401);
  });
});

describe('denunciar', () => {
  it('crea la denuncia abierta y la deja en la cola', async () => {
    const ana = await tokenFor(ANA);
    const r = await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'live_message', targetId: 'm2', reason: 'ofensivo', detail: 'Me insultó' })
      .expect(201);

    expect(r.body.status).toBe('open');
    expect(r.body.reason).toBe('ofensivo');
    expect(r.body.resolvedAt).toBeNull();
  });

  it('el detalle es opcional', async () => {
    const ana = await tokenFor(ANA);
    await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'product', targetId: 'p1', reason: 'estafa' })
      .expect(201);
  });

  it('un detalle larguísimo se rechaza', async () => {
    const ana = await tokenFor(ANA);
    await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'product', targetId: 'p1', reason: 'otro', detail: 'x'.repeat(501) })
      .expect(400);
  });

  it('denunciarse a uno mismo no se puede', async () => {
    const ana = await tokenFor(ANA);
    const r = await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'user', targetId: idDe(ANA.email), reason: 'otro' })
      .expect(409);
    expect(r.body.code).toBe('CANNOT_REPORT_SELF');
  });

  it('se puede denunciar algo que ya no existe', async () => {
    // El mensaje puede desaparecer entre que alguien lo lee y toca denunciar.
    // Negarle la denuncia justo ahí sería lo peor que se puede hacer.
    const ana = await tokenFor(ANA);
    await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'live_message', targetId: 'mensaje-borrado', reason: 'spam' })
      .expect(201);
  });

  it('sin sesión no se denuncia', async () => {
    await http()
      .post('/reports')
      .send({ target: 'product', targetId: 'p1', reason: 'spam' })
      .expect(401);
  });
});

describe('la cola de moderación', () => {
  it('solo la ve la administración', async () => {
    const ana = await tokenFor(ANA);
    await http().get('/admin/reports').expect(401);
    await http().get('/admin/reports').set('Authorization', `Bearer ${ana}`).expect(403);
  });

  it('lista lo abierto y resolver lo saca', async () => {
    const ana = await tokenFor(ANA);
    const creada = await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'live_message', targetId: 'm2', reason: 'ofensivo' })
      .expect(201);

    hacerAdmin(MARTINA.email);
    const admin = await tokenFor(MARTINA);

    const cola = await http()
      .get('/admin/reports')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(cola.body).toHaveLength(1);

    const resuelta = await http()
      .post(`/admin/reports/${creada.body.id}/resolve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'actioned' })
      .expect(201);
    expect(resuelta.body.status).toBe('actioned');
    expect(resuelta.body.resolvedBy).toBe(idDe(MARTINA.email));

    const despues = await http()
      .get('/admin/reports')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(despues.body).toHaveLength(0);
  });

  it('una denuncia ya resuelta no se vuelve a resolver', async () => {
    const ana = await tokenFor(ANA);
    const creada = await http()
      .post('/reports')
      .set('Authorization', `Bearer ${ana}`)
      .send({ target: 'product', targetId: 'p1', reason: 'spam' })
      .expect(201);

    hacerAdmin(MARTINA.email);
    const admin = await tokenFor(MARTINA);
    const url = `/admin/reports/${creada.body.id}/resolve`;
    await http().post(url).set('Authorization', `Bearer ${admin}`).send({ status: 'dismissed' });

    const r = await http()
      .post(url)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'actioned' })
      .expect(409);
    expect(r.body.code).toBe('REPORT_ALREADY_RESOLVED');
  });
});
