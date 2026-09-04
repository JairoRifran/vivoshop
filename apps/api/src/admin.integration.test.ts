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
 * El panel del dueño, sobre HTTP real.
 *
 * La mitad de estas pruebas son de acceso, y son las que más importan. Detrás
 * de `/admin` está la facturación de todas las tiendas y el correo de todos los
 * compradores: que un comprador cualquiera reciba 403 no es un detalle de
 * cortesía, es la única cosa que separa ese conjunto de datos de cualquiera que
 * se registre.
 *
 * La otra mitad prueba el CSV, donde el error caro es silencioso: un campo con
 * una coma sin comillas corre todas las columnas siguientes y nadie lo ve hasta
 * que los totales de la planilla no cierran.
 */
let app: INestApplication;
let http: () => request.Agent;
let clock: FixedClock;
let db: MemoryDatabase;
let throttler: ThrottlerStorage;

const AHORA = new Date('2026-09-01T12:00:00Z');
const ANA = { email: 'ana@vivo.uy', password: 'vivo1234' };
const MARTINA = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

/** Le da el rol `admin` a alguien, como haría `pnpm db:grant-admin`. */
function hacerAdmin(email: string): void {
  for (const [clave, usuario] of db.users) {
    if (usuario.email !== email) continue;
    db.users.set(clave, { ...usuario, roles: [...usuario.roles, 'admin'] });
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'admin-integration-secret-000000000';
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

describe('quién entra al panel', () => {
  it('sin sesión, ninguna de las tres rutas responde', async () => {
    await http().get('/admin/overview').expect(401);
    await http().get('/admin/reportes/pedidos.csv').expect(401);
    await http().get('/admin/reportes/cobros.csv').expect(401);
  });

  it('una compradora con sesión válida igual no entra', async () => {
    const token = await tokenFor(ANA);
    const response = await http()
      .get('/admin/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('ser vendedora tampoco alcanza', async () => {
    // Martina tiene tienda. El panel del dueño no es el de vendedor: desde acá
    // se ven las ventas de todas las tiendas, incluidas las de la competencia.
    const token = await tokenFor(MARTINA);
    await http().get('/admin/overview').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('el 403 no dice "activá el modo vendedor", que mandaría a buscar algo que no existe', async () => {
    const token = await tokenFor(ANA);
    const response = await http()
      .get('/admin/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.message).not.toContain('vendedor');
  });

  it('con el rol admin, entra', async () => {
    hacerAdmin(ANA.email);
    const token = await tokenFor(ANA);
    await http().get('/admin/overview').set('Authorization', `Bearer ${token}`).expect(200);
  });
});

describe('el resumen', () => {
  it('trae las cuatro secciones y la ventana que se usó', async () => {
    hacerAdmin(ANA.email);
    const token = await tokenFor(ANA);
    const { body } = await http()
      .get('/admin/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(body.revenue).toBeDefined();
    expect(body.vivo).toBeDefined();
    expect(body.crecimiento).toBeDefined();
    expect(body.atencion).toBeDefined();
    // La pantalla no tiene que adivinar qué período está mirando.
    expect(body.dias).toBe(30);
    expect(body.timeZone).toBe('America/Montevideo');
    expect(body.crecimiento.usuariosTotal).toBeGreaterThan(0);
  });

  it('la ventana se puede pedir, y se recorta a algo razonable', async () => {
    hacerAdmin(ANA.email);
    const token = await tokenFor(ANA);

    const corta = await http()
      .get('/admin/overview?dias=7')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(corta.body.dias).toBe(7);

    // Un número absurdo no puede convertirse en una consulta absurda.
    const enorme = await http()
      .get('/admin/overview?dias=99999')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(enorme.body.dias).toBe(365);

    const basura = await http()
      .get('/admin/overview?dias=no-es-un-numero')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(basura.body.dias).toBe(30);
  });
});

describe('los reportes', () => {
  it('bajan como archivo CSV, no como JSON', async () => {
    hacerAdmin(ANA.email);
    const token = await tokenFor(ANA);
    const response = await http()
      .get('/admin/reportes/pedidos.csv?dias=365')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text.split('\r\n')[0]).toBe(
      'pedido,fecha,estado,tienda,comprador,email,moneda,subtotal,envio,descuento,total,desde_vivo',
    );
  });

  it('escapa las comas, que es lo que rompe una planilla en silencio', async () => {
    hacerAdmin(ANA.email);
    // Un nombre con coma es completamente normal en un rubro.
    for (const [clave, tienda] of db.stores) {
      db.stores.set(clave, { ...tienda, name: 'Ropa, calzado y más' });
      break;
    }

    const token = await tokenFor(ANA);
    const response = await http()
      .get('/admin/reportes/pedidos.csv?dias=365')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.text).toContain('"Ropa, calzado y más"');
    // Toda fila de datos tiene que seguir teniendo la misma cantidad de campos
    // que la cabecera. Si el escapado falla, acá se ve.
    const lineas = response.text.trim().split('\r\n');
    const columnas = (lineas[0] as string).split(',').length;
    for (const linea of lineas.slice(1)) {
      expect(contarCampos(linea)).toBe(columnas);
    }
  });

  it('el de cobros trae la comisión, que es lo que hay que declarar', async () => {
    hacerAdmin(ANA.email);
    const token = await tokenFor(ANA);
    const response = await http()
      .get('/admin/reportes/cobros.csv')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cabecera = response.text.split('\r\n')[0] as string;
    expect(cabecera).toContain('comision');
    expect(cabecera).toContain('bruto');
    expect(cabecera).toContain('neto');
  });
});

/** Cuenta campos de una línea de CSV respetando las comillas. */
function contarCampos(linea: string): number {
  let campos = 1;
  let dentro = false;
  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i];
    if (caracter === '"') dentro = !dentro;
    else if (caracter === ',' && !dentro) campos += 1;
  }
  return campos;
}
