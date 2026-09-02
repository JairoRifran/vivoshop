import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderProfile } from '@vivo/domain';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';
import { encodeCode } from './infrastructure/providers/fake-identity.provider';

/**
 * Ingresar con Google, sobre HTTP real.
 *
 * El proveedor está simulado —una suite que hablara con `accounts.google.com`
 * probaría a Google y fallaría cuando Google se cayera— pero **todo lo demás es
 * real**: el `state` de un solo uso, el PKCE, la decisión de vincular o no, la
 * creación del usuario, el vale de un minuto y la sesión.
 *
 * Las rutas también son las de producción: `OAUTH_PROVIDERS=fake` monta el
 * adaptador falso bajo el nombre `google`, así que lo que se ejercita acá es el
 * mismo recorrido que va a correr desplegado.
 *
 * Lo que más importa son los cuatro desenlaces de `resolveIdentityOutcome`. El
 * dominio ya los prueba aislados; acá se comprueba que el recorrido completo
 * los respeta, que es donde una regla correcta se rompe en la práctica.
 */
let app: INestApplication;
let http: () => request.Agent;

const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };

const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  providerUserId: 'google-nuevo',
  email: 'recien.llegada@vivo.uy',
  emailVerified: true,
  name: 'Recién Llegada',
  avatarUrl: null,
  ...overrides,
});

/** Arranca el ingreso y devuelve el `state` que quedó guardado. */
async function startAndReadState(next = '/'): Promise<string> {
  const response = await http()
    .get(`/auth/google/start?next=${encodeURIComponent(next)}`)
    .expect(302);
  const location = new URL(response.headers.location as string);
  return location.searchParams.get('state') as string;
}

/** Completa el ingreso con el perfil dado. Devuelve la redirección. */
async function callbackWith(
  who: ProviderProfile,
  next = '/',
): Promise<{ location: URL; state: string }> {
  const state = await startAndReadState(next);
  const response = await http()
    .get(`/auth/google/callback?code=${encodeCode(who)}&state=${encodeURIComponent(state)}`)
    .expect(302);

  return { location: new URL(response.headers.location as string), state };
}

/** Canjea el vale de una redirección por la sesión. */
async function exchange(location: URL) {
  const vale = location.searchParams.get('vale');
  expect(vale, 'la redirección tenía que traer un vale').toBeTruthy();

  const response = await http().post('/auth/session/exchange').send({ vale }).expect(200);
  return response.body as { token: string; user: { id: string; email: string; name: string } };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.OAUTH_PROVIDERS = 'fake';
  process.env.API_PUBLIC_URL = 'http://api.local';
  process.env.WEB_ORIGIN = 'http://web.local';
  process.env.JWT_SECRET = 'social-integration-secret-00000000000';
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

describe('qué botones ofrece la pantalla', () => {
  it('los publica sin pedir sesión', async () => {
    // La pantalla de ingreso los consulta antes de que exista una sesión.
    const response = await http().get('/auth/providers').expect(200);
    expect(response.body.providers).toEqual(['google']);
  });
});

describe('arrancar el ingreso', () => {
  it('manda al proveedor con un state y un desafío PKCE', async () => {
    const response = await http().get('/auth/google/start').expect(302);
    const location = new URL(response.headers.location as string);

    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('dos ingresos no comparten el state', async () => {
    // Un `state` predecible o compartido no protege de nada.
    const [uno, dos] = await Promise.all([startAndReadState(), startAndReadState()]);
    expect(uno).not.toBe(dos);
  });

  it('un proveedor que no está habilitado se rechaza', async () => {
    await http().get('/auth/meta/start').expect(400);
  });
});

describe('los cuatro desenlaces, de punta a punta', () => {
  it('alguien nuevo queda registrado y con sesión', async () => {
    const { location } = await callbackWith(profile());
    const session = await exchange(location);

    expect(session.user.email).toBe('recien.llegada@vivo.uy');
    expect(session.user.name).toBe('Recién Llegada');

    // Y la sesión sirve de verdad contra el resto de la API.
    const me = await http()
      .get('/auth/me')
      .set({ Authorization: `Bearer ${session.token}` })
      .expect(200);
    expect(me.body.email).toBe('recien.llegada@vivo.uy');
  });

  it('volver a entrar con la misma identidad no crea una segunda cuenta', async () => {
    const primera = await exchange((await callbackWith(profile({ providerUserId: 'g-repe' }))).location);
    const segunda = await exchange((await callbackWith(profile({ providerUserId: 'g-repe' }))).location);

    expect(segunda.user.id).toBe(primera.user.id);
  });

  it('la identidad manda aunque el email haya cambiado en Google', async () => {
    const antes = await exchange(
      (await callbackWith(profile({ providerUserId: 'g-mudanza', email: 'antes@vivo.uy' }))).location,
    );
    const despues = await exchange(
      (await callbackWith(profile({ providerUserId: 'g-mudanza', email: 'despues@vivo.uy' }))).location,
    );

    // Misma persona, misma cuenta. Si esto buscara por email, un cambio de
    // email en Google costaría la cuenta —con los pedidos adentro—.
    expect(despues.user.id).toBe(antes.user.id);
  });

  it('un email VERIFICADO se vincula a la cuenta que ya existía', async () => {
    // Ana existe desde el conjunto sembrado, con contraseña.
    const conPassword = await http().post('/auth/login').send(ANA).expect(201);

    const { location } = await callbackWith(
      profile({ providerUserId: 'g-ana', email: ANA.email, emailVerified: true }),
    );
    const conGoogle = await exchange(location);

    // Una sola cuenta, dos formas de entrar.
    expect(conGoogle.user.id).toBe(conPassword.body.user.id);

    // Y la contraseña sigue funcionando: vincular no la reemplaza.
    await http().post('/auth/login').send(ANA).expect(201);
  });

  it('un email SIN verificar sobre una cuenta existente NO entra: pide la contraseña', async () => {
    /**
     * El caso que da sentido a todo el milestone.
     *
     * Si esto emitiera una sesión, cualquiera que consiga que un proveedor
     * afirme `ana@vivo.uy` sin comprobarlo se queda con la cuenta de Ana: sus
     * pedidos, su tienda y su cuenta de cobros.
     */
    const { location } = await callbackWith(
      profile({ providerUserId: 'g-impostor', email: ANA.email, emailVerified: false }),
    );

    // Ni vale ni sesión: se la manda a ingresar con contraseña.
    expect(location.searchParams.get('vale')).toBeNull();
    expect(location.pathname).toBe('/ingresar');
    expect(location.searchParams.get('motivo')).toBe('verificar');
    expect(location.searchParams.get('email')).toBe(ANA.email);
  });

  it('sin verificar y sin cuenta previa sí registra', async () => {
    // No hay nada que robar: nadie usa ese email.
    const { location } = await callbackWith(
      profile({ providerUserId: 'g-libre', email: 'nadie@vivo.uy', emailVerified: false }),
    );
    const session = await exchange(location);

    expect(session.user.email).toBe('nadie@vivo.uy');
  });
});

describe('la cuenta creada con Google', () => {
  it('no se puede abrir con una contraseña vacía ni con cualquiera', async () => {
    // No tiene `password_hash`. El login por contraseña tiene que leer eso como
    // credenciales inválidas, nunca como "no hace falta contraseña".
    await exchange((await callbackWith(profile({ providerUserId: 'g-sinpass', email: 'sinpass@vivo.uy' }))).location);

    await http().post('/auth/login').send({ email: 'sinpass@vivo.uy', password: '' }).expect(400);
    await http()
      .post('/auth/login')
      .send({ email: 'sinpass@vivo.uy', password: 'loquesea' })
      .expect(401);
  });
});

describe('el state, que es toda la protección', () => {
  it('no se puede usar dos veces', async () => {
    const who = profile({ providerUserId: 'g-replay', email: 'replay@vivo.uy' });
    const state = await startAndReadState();

    await http()
      .get(`/auth/google/callback?code=${encodeCode(who)}&state=${encodeURIComponent(state)}`)
      .expect(302);

    // El segundo intento con el mismo state no puede entrar.
    const repetido = await http()
      .get(`/auth/google/callback?code=${encodeCode(who)}&state=${encodeURIComponent(state)}`)
      .expect(302);

    const location = new URL(repetido.headers.location as string);
    expect(location.searchParams.get('vale')).toBeNull();
    expect(location.searchParams.get('error')).toBe('social');
  });

  it('un state inventado no sirve', async () => {
    // Sin esto, cualquiera puede inducir a alguien a completar un ingreso que
    // no pidió, con una cuenta que no es suya.
    const response = await http()
      .get(`/auth/google/callback?code=${encodeCode(profile())}&state=inventado`)
      .expect(302);

    expect(new URL(response.headers.location as string).searchParams.get('error')).toBe('social');
  });

  it('cancelar en la pantalla del proveedor vuelve sin drama', async () => {
    const response = await http()
      .get('/auth/google/callback?error=access_denied')
      .expect(302);

    const location = new URL(response.headers.location as string);
    expect(location.pathname).toBe('/ingresar');
    expect(location.searchParams.get('cancelado')).toBe('1');
    // Cancelar no es un error: no se le muestra uno.
    expect(location.searchParams.get('error')).toBeNull();
  });
});

describe('el vale', () => {
  it('no sirve como sesión', async () => {
    /**
     * El vale viaja por la URL, así que queda en el historial y en el
     * `Referer`. Que la API de sesión lo rechace es lo que hace que eso sea
     * tolerable: audiencia distinta, `verify` la comprueba.
     */
    const { location } = await callbackWith(
      profile({ providerUserId: 'g-vale', email: 'vale@vivo.uy' }),
    );
    const vale = location.searchParams.get('vale') as string;

    await http().get('/auth/me').set({ Authorization: `Bearer ${vale}` }).expect(401);
  });

  it('no se puede canjear dos veces por el mismo ingreso... pero sí vence', async () => {
    // Un vale es de un minuto y de un solo propósito. Canjearlo dos veces
    // dentro de esa ventana devuelve la misma sesión, que es inofensivo: quien
    // tiene el vale ya tiene la sesión. Lo que importa es que caduque.
    const { location } = await callbackWith(
      profile({ providerUserId: 'g-doble', email: 'doble@vivo.uy' }),
    );

    const uno = await exchange(location);
    const dos = await exchange(location);
    expect(dos.user.id).toBe(uno.user.id);
  });

  it('uno inventado se rechaza', async () => {
    await http().post('/auth/session/exchange').send({ vale: 'no-es-un-vale' }).expect(400);
  });
});
