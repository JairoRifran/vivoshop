import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';

/**
 * Imágenes de perfil y de tienda, sobre HTTP real.
 *
 * Lo que se prueba es la regla que sostiene todo el diseño: **el perfil acepta
 * claves, no URLs**, y solo las suyas. Antes de M06 este campo tomaba cualquier
 * cadena, así que cualquiera podía poner ahí la foto de otra persona o un pixel
 * de rastreo alojado en su propio servidor. Las pruebas de abajo son las que
 * impiden que eso vuelva.
 *
 * El almacenamiento es el driver local —bytes en memoria— porque lo que se
 * verifica no es Supabase sino el recorrido: firmar, subir, y que la clave
 * resultante se acepte o se rechace según de quién sea.
 */
let app: INestApplication;
let http: () => request.Agent;

const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };
const MARTINA = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function authFor(credentials: { email: string; password: string }) {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return { Authorization: `Bearer ${response.body.token as string}` };
}

/** Un WebP mínimo. Alcanza: nadie decodifica estos bytes. */
const PIXEL = Buffer.from('UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==', 'base64');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.STORAGE_PROVIDER = 'local';
  process.env.JWT_SECRET = 'media-integration-secret-0000000000000';
  process.env.RATE_LIMIT = '100000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('pedir dónde subir', () => {
  it('exige sesión', async () => {
    await http().post('/media/uploads').send({ purpose: 'avatar', contentType: 'image/webp' }).expect(401);
  });

  it('devuelve una clave que lleva el propósito y el dueño adentro', async () => {
    const auth = await authFor(ANA);
    const response = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/webp' })
      .expect(201);

    // La forma de la clave *es* la regla de seguridad: el segmento del medio es
    // quien está en sesión, y es lo único que después se compara.
    expect(response.body.key).toMatch(/^avatar\/ana\/[A-Za-z0-9-]+\.webp$/);
    expect(response.body.uploadUrl).toContain('/media/dev/upload/');
    expect(response.body.maxBytes).toBeGreaterThan(0);
  });

  it('dos pedidos no devuelven la misma clave', async () => {
    // Si la clave fuera predecible, adivinar la de otra persona sería trivial y
    // una subida pisaría la anterior.
    const auth = await authFor(ANA);
    const one = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/png' });
    const two = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/png' });

    expect(one.body.key).not.toBe(two.body.key);
  });

  it('rechaza SVG', async () => {
    // Un SVG puede llevar un script, y servido desde nuestro dominio se
    // ejecuta con nuestros permisos. Ningún logo lo vale.
    const auth = await authFor(ANA);
    await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/svg+xml' })
      .expect(400);
  });
});

describe('guardar la imagen en el perfil', () => {
  it('acepta la clave propia y guarda una URL, no la clave', async () => {
    const auth = await authFor(ANA);
    const { body: target } = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/webp' });

    await http()
      .put(new URL(target.uploadUrl).pathname)
      .set('Content-Type', 'image/webp')
      .send(PIXEL)
      .expect(200);

    const { body: user } = await http()
      .patch('/auth/me')
      .set(auth)
      .send({ avatarKey: target.key })
      .expect(200);

    expect(user.avatarUrl).toContain(`/media/dev/file/${target.key}`);

    // Y los bytes se sirven con el tipo con el que se guardaron.
    const file = await http().get(`/media/dev/file/${target.key}`).expect(200);
    expect(file.headers['content-type']).toContain('image/webp');
  });

  it('rechaza la clave de otra persona', async () => {
    /**
     * El caso que da sentido a todo el mecanismo: Martina pide una firma, y Ana
     * intenta ponerse esa imagen como avatar. Sin `assertOwnMediaKey` esto
     * pasaría, porque la clave es perfectamente válida — solo que no es suya.
     */
    const martina = await authFor(MARTINA);
    const { body: ajena } = await http()
      .post('/media/uploads')
      .set(martina)
      .send({ purpose: 'avatar', contentType: 'image/webp' });

    const ana = await authFor(ANA);
    await http().patch('/auth/me').set(ana).send({ avatarKey: ajena.key }).expect(400);
  });

  it('rechaza una URL cualquiera de internet', async () => {
    // Lo que era posible hasta M06.
    const auth = await authFor(ANA);
    await http()
      .patch('/auth/me')
      .set(auth)
      .send({ avatarKey: 'https://rastreador.example/pixel.png' })
      .expect(400);
  });

  it('rechaza una clave del propósito equivocado', async () => {
    // Una portada de tienda no puede terminar como foto de perfil: los tamaños,
    // la proporción y el lugar donde se muestra son distintos.
    const auth = await authFor(ANA);
    const { body: cover } = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'store_cover', contentType: 'image/webp' });

    await http().patch('/auth/me').set(auth).send({ avatarKey: cover.key }).expect(400);
  });

  it('null borra la foto, y omitir el campo la deja como está', async () => {
    const auth = await authFor(ANA);
    const { body: target } = await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'avatar', contentType: 'image/webp' });

    await http().patch('/auth/me').set(auth).send({ avatarKey: target.key }).expect(200);

    // Otro cambio cualquiera no toca la foto.
    const { body: renamed } = await http()
      .patch('/auth/me')
      .set(auth)
      .send({ name: 'Ana Pérez' })
      .expect(200);
    expect(renamed.avatarUrl).toContain(target.key);

    const { body: cleared } = await http()
      .patch('/auth/me')
      .set(auth)
      .send({ avatarKey: null })
      .expect(200);
    expect(cleared.avatarUrl).toBeNull();
  });

  it('guarda la bio recortada, y la vacía se guarda como sin bio', async () => {
    const auth = await authFor(ANA);
    const { body: withBio } = await http()
      .patch('/auth/me')
      .set(auth)
      .send({ bio: '  Compro ropa y pregunto todo.  ' })
      .expect(200);
    expect(withBio.bio).toBe('Compro ropa y pregunto todo.');

    const { body: without } = await http().patch('/auth/me').set(auth).send({ bio: '' }).expect(200);
    // Vacío y "sin bio" son lo mismo: guardar una cadena vacía haría que la
    // pantalla dibujara un párrafo en blanco.
    expect(without.bio).toBeNull();
  });
});

describe('la identidad de la tienda', () => {
  it('acepta logo y portada de quien es dueño', async () => {
    const auth = await authFor(MARTINA);
    const [logo, cover] = await Promise.all([
      http().post('/media/uploads').set(auth).send({ purpose: 'store_logo', contentType: 'image/webp' }),
      http().post('/media/uploads').set(auth).send({ purpose: 'store_cover', contentType: 'image/webp' }),
    ]);

    const { body: store } = await http()
      .patch('/seller/store')
      .set(auth)
      .send({ logoKey: logo.body.key, coverKey: cover.body.key, whatsapp: '+598 99 123 456' })
      .expect(200);

    expect(store.logoUrl).toContain(logo.body.key);
    expect(store.coverUrl).toContain(cover.body.key);
    expect(store.whatsapp).toBe('+598 99 123 456');
  });

  it('rechaza un logo firmado por otra persona', async () => {
    const ana = await authFor(ANA);
    const { body: ajena } = await http()
      .post('/media/uploads')
      .set(ana)
      .send({ purpose: 'store_logo', contentType: 'image/webp' });

    const martina = await authFor(MARTINA);
    await http().patch('/seller/store').set(martina).send({ logoKey: ajena.key }).expect(400);
  });
});
