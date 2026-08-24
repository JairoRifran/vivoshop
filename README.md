# Vivo

Plataforma de **live commerce**. Las tiendas transmiten desde el celular y quien mira compra sin
salir del video. Arranca en Uruguay y está construida para expandirse a Latinoamérica sin
reescribir el núcleo.

> **Estado: M02 — vivo real.**
> El producto se recorre completo de punta a punta. El stock es atómico, la creación de pedidos es
> transaccional e idempotente, y todo eso está verificado contra PostgreSQL real. El video, los
> pagos y las notificaciones siguen simulados detrás de interfaces con la forma final de su
> integración.

---

## Qué se puede hacer hoy

**Comprador**

```
abrir la app → ver quién está en vivo → entrar a un vivo → chatear y reaccionar
→ tocar el producto destacado → elegir variante → comprar → elegir entrega
→ pagar (simulado) → ver el pedido y su seguimiento en "Mis compras"
```

**Vendedor**

```
activar modo vendedor → crear tienda → cargar productos con variantes y stock
→ crear o programar un vivo → abrir la consola de transmisión
→ destacar productos en pantalla → ver pedidos y unidades en tiempo real
→ finalizar → preparar y despachar los pedidos
```

Una sola cuenta hace las dos cosas. Activar el modo vendedor agrega un rol; nunca crea una
segunda identidad.

---

## Requisitos

| Herramienta | Versión | Notas |
| --- | --- | --- |
| Node.js | ≥ 20.11 (probado en 24) | |
| pnpm | 11 | `npm i -g pnpm@11` o `corepack enable pnpm` |
| Docker | opcional | Solo para el driver PostgreSQL |

---

## Arranque

```bash
pnpm install
pnpm dev
```

Eso es todo. Sin base de datos, sin migraciones, sin `.env`.

- Web: <http://localhost:3000>
- API: <http://localhost:4000>

La app arranca **poblada**: 5 tiendas uruguayas ficticias, 26 productos, 6 transmisiones (2 en
vivo, 3 programadas, 1 finalizada), chat, seguidores y pedidos en distintos estados.

### Cuentas de demostración

| Cuenta | Email | Rol |
| --- | --- | --- |
| Ana Pérez | `ana@vivo.uy` | Compradora |
| Martina Silva | `martina@vivo.uy` | Compradora **y** vendedora (Plaza Moda) |

Contraseña para todas: `vivo1234`. Aparecen en la pantalla de ingreso fuera de producción.

---

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | API + web + paquetes en modo watch |
| `pnpm build` | Compila todo |
| `pnpm lint` | ESLint en todo el monorepo |
| `pnpm typecheck` | TypeScript strict, sin emitir |
| `pnpm test` | Unitarios + integración (219 tests) |
| `pnpm test:e2e` | Playwright, mobile y desktop (13 tests) |
| `pnpm test:e2e:install` | Descarga Chromium para Playwright (una vez) |
| `pnpm format` | Prettier |

### Con PostgreSQL

El driver por defecto es en memoria. Para usar Postgres de verdad:

```bash
cp .env.example .env      # y poné DATA_DRIVER=postgres
pnpm db:up                # levanta postgres + redis con Docker
pnpm db:push              # crea el esquema
pnpm db:seed              # carga el mismo dataset de demostración
pnpm dev
```

| Comando | Qué hace |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | Postgres 17 + Redis 7 vía Docker Compose |
| `pnpm db:generate` | Genera migraciones SQL desde el esquema TypeScript (offline) |
| `pnpm db:push` | Aplica el esquema directo (solo local) |
| `pnpm db:seed` | Carga el dataset de demostración |
| `pnpm db:migrate` | Aplica las migraciones versionadas |
| `DATABASE_URL=... pnpm db:smoke` | Verifica un servidor PostgreSQL real: transacciones, concurrencia e idempotencia |

---

## Estructura

```
live-commerce/
├── apps/
│   ├── api/          NestJS. Monolito modular: HTTP → casos de uso → dominio → infraestructura
│   └── web/          Next.js App Router. PWA mobile-first: comprador + Seller Center
├── packages/
│   ├── domain/       Modelo de dominio puro. Sin framework, sin I/O, sin entorno
│   ├── shared/       Contratos: schemas zod, DTOs, cliente HTTP tipado, catálogo de analytics
│   ├── config/       Registro de mercados: moneda, impuestos, envíos, direcciones, teléfonos
│   ├── ui/           Primitivas de diseño (Tailwind + React)
│   └── seed/         Dataset de demostración determinista
└── docs/
    ├── architecture.md    Capas, puertos, decisiones técnicas
    ├── domain.md          Entidades, invariantes, máquinas de estado
    ├── m01.md             Alcance, criterios de aceptación y deuda conocida
    └── m01.1.md           Stock atómico, transacciones, idempotencia, impuestos
```

---

## Arquitectura en una pantalla

```
  Web / PWA  ──┐
               ├──►  API (NestJS)  ──►  Aplicación  ──►  Dominio (@vivo/domain)
  Móvil (M04) ─┘                            │
                                            ▼
                                     Infraestructura
                          ┌──────────────┬──────────────┬─────────────┐
                          │ Persistencia │    Caché     │ Proveedores │
                          │ memoria / PG │ memoria/Redis│  pago, video,
                          │              │              │ envío, push │
                          └──────────────┴──────────────┴─────────────┘
```

Las dependencias apuntan hacia adentro. `@vivo/domain` no importa NestJS, Next, Drizzle ni
Redis — **y ESLint lo impide**, no es una convención de buena voluntad.

Cada integración externa es un puerto con una implementación simulada hoy y una real después.
Todos los bindings viven en un solo archivo,
[`infrastructure.module.ts`](apps/api/src/infrastructure/infrastructure.module.ts): se lee de una
sentada qué implementación respalda cada cosa.

Detalle completo en [`docs/architecture.md`](docs/architecture.md).

---

## Variables de entorno

Todo tiene un valor por defecto seguro para desarrollo; `.env` es opcional. Ver
[`.env.example`](.env.example) para la lista completa y comentada.

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATA_DRIVER` | `memory` | `memory` o `postgres` |
| `CACHE_DRIVER` | `memory` | `memory` o `redis` |
| `DATABASE_URL` | — | Obligatoria si `DATA_DRIVER=postgres` |
| `REDIS_URL` | — | Obligatoria si `CACHE_DRIVER=redis` |
| `JWT_SECRET` | valor de desarrollo | El proceso **se niega a arrancar** en producción con el default |
| `WEB_ORIGIN` | `http://localhost:3000` | Orígenes permitidos por CORS |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Se envía al navegador: nunca poner secretos |

La configuración se valida con zod al arrancar. Un entorno inválido falla en el arranque con la
lista de problemas, no en el primer request.

---

## Testing

| Capa | Herramienta | Qué cubre | Cantidad |
| --- | --- | --- | --- |
| Unitarios | Vitest | Dinero, invariantes, máquinas de estado, precios, stock, impuestos, idempotencia | 128 |
| Integración (API) | Vitest + Supertest | La app Nest completa: guards, validación, permisos, checkout | 31 |
| Integración (SQL) | Vitest + PGlite | Repositorios Drizzle contra **PostgreSQL real** en proceso | 26 |
| Contrato de drivers | Vitest + PGlite | Stock atómico, concurrencia, idempotencia y rollback, **idénticos en memoria y PostgreSQL** | 34 |
| E2E | Playwright | Recorrido de compra y de venta, mobile y desktop | 13 |

Los tests de PostgreSQL corren contra PGlite (Postgres compilado a WebAssembly) aplicando las
mismas migraciones versionadas del repositorio. No hay dobles de prueba fingiendo ser una base de
datos, y no hace falta Docker para ejecutarlos.

```bash
pnpm test                 # unitarios + integración
pnpm test:e2e:install     # una sola vez
pnpm test:e2e
```

Contra un servidor PostgreSQL de verdad — el único lugar donde se puede probar que dos
*conexiones* peleando por la última unidad se serializan con locks de fila:

```bash
DATABASE_URL=postgresql://usuario:clave@host:5432/base pnpm db:smoke
```

Corre dentro de un schema descartable que elimina al terminar, no toca ninguna tabla existente, y
se niega a ejecutarse contra algo que parezca producción.

---

## Rendimiento

El objetivo es un Android de gama media con 4G irregular, no una notebook con fibra.

| Presupuesto | Objetivo | Medido |
| --- | --- | --- |
| JS inicial por ruta (gzip) | ≤ 200 KB | 166–189 KB |
| Imágenes del catálogo | sin binarios | SVG generados, ~1 KB cada uno |
| Tipografía | ≤ 1 archivo | Manrope variable, self-hosted por Next |
| Dependencias de UI | 0 librerías de componentes | Tailwind + primitivas propias |

Decisiones concretas detrás de esos números: cero librerías de componentes, cero librería de
animación (todo con CSS), iconos SVG propios en vez de un paquete de iconos, imágenes generadas
en el servidor y cacheadas para siempre, y lectura de datos en Server Components para que el
bundle del cliente no cargue código de fetching.

---

## Accesibilidad

- Navegación por teclado y `:focus-visible` en todo control interactivo.
- Nombres accesibles en todos los botones de solo icono; el asterisco de "requerido" es
  decorativo y no contamina el nombre del campo.
- Áreas táctiles de 44 px como mínimo; los controles de transmisión son de 56 px.
- HTML semántico: `nav`, `main`, `section`, `dialog` nativo para los bottom sheets.
- `prefers-reduced-motion` desactiva animaciones, incluidos los corazones del vivo.
- Inputs de 16 px para que iOS no haga zoom al enfocar.
- Safe areas respetadas arriba y abajo.

---

## Seguridad

- Contraseñas con **scrypt** (`node:crypto`): sin dependencias nativas, KDF con costo de memoria.
- Tokens JWT HS256 con `jose`, en cookie **httpOnly** — el JavaScript del cliente nunca ve el token.
- Todo endpoint es privado por defecto; abrirlo es explícito (`@Public()` / `@OptionalAuth()`).
- Validación con los **mismos** schemas zod en el servidor y en los formularios.
- Rate limiting por IP, aplicado antes de la autenticación.
- Helmet, CORS con lista blanca de orígenes, y errores que nunca filtran stack traces.
- Email inexistente y contraseña incorrecta devuelven exactamente la misma respuesta.

---

## Garantías de consistencia

- **Stock atómico.** El descuento es un `UPDATE … WHERE stock >= :cantidad` condicional, una
  sentencia por línea, dentro de la transacción del pedido. No hay ventana entre leer y escribir.
- **Todo o nada.** Reserva de stock, alta del pedido, sus líneas y la atribución al vivo ocurren en
  una sola transacción. Cualquier excepción hace `ROLLBACK`.
- **Idempotencia.** `POST /checkout/:storeId/orders` exige `Idempotency-Key`. La misma clave
  devuelve el mismo pedido y no vuelve a descontar stock; la misma clave con otro payload es un
  `409 IDEMPOTENCY_CONFLICT`.
- **Paridad de drivers.** Las mismas 17 aserciones corren contra el driver en memoria y contra
  PostgreSQL.

Detalle en [`docs/m01.1.md`](docs/m01.1.md).

## El vivo

Transmisión real por WebRTC con LiveKit, y un canal de realtime propio para todo lo que no es
video.

- **Video.** `STREAMING_PROVIDER=livekit` publica desde el teléfono del vendedor y se ve en el
  navegador del comprador. `mock` es el valor por defecto: un clon nuevo arranca sin cuenta, sin
  Docker y sin cámara. El secreto del proveedor nunca sale del servidor; los tokens se firman por
  participante, con el permiso mínimo, y vencen.
- **Realtime.** Un WebSocket propio (`/realtime`) lleva chat, corazones, espectadores, producto
  destacado, estado del vivo y ventas. Es independiente del video a propósito: sigue funcionando
  con el proveedor simulado y sobrevive a un cambio de vendor.
- **Estados.** `scheduled → starting → live → ending → ended`, más `interrupted` y `cancelled`. Una
  caída de señal **no** termina la transmisión: abre un período de gracia de 90 segundos.

Cómo probarlo, incluido el procedimiento con dos teléfonos:
[`docs/live-testing.md`](docs/live-testing.md). Detalle técnico:
[`docs/m02.md`](docs/m02.md).

## Despliegue

Tres piezas en tres lugares, porque el gateway de WebSocket necesita un proceso
vivo y Vercel no lo da:

| Pieza | Dónde |
| --- | --- |
| Web (Next.js) | Vercel |
| API (NestJS + Socket.IO) | Railway |
| PostgreSQL | Supabase |
| Video | LiveKit Cloud (opcional — sin él corre en `mock`) |

Paso a paso, variables y estado de verificación en
[`docs/deploy.md`](docs/deploy.md).

## Qué sigue simulado

| Área | Hoy | Interfaz preparada |
| --- | --- | --- |
| Video | **Real** con LiveKit; `mock` para desarrollo y pruebas | `StreamingProvider` |
| Pagos | Provider simulado con estados reales | `PaymentProvider` |
| Envíos | Tarifa plana desde la configuración del mercado | `ShippingProvider` |
| Notificaciones | Log en el servidor | `NotificationProvider` |
| Imágenes | SVG generados | `StorageProvider` |

Nada de esto es un `TODO` vacío: cada uno es una implementación completa de su interfaz, por lo
que integrar el proveedor real es cambiar un binding, no reescribir un caso de uso.

---

## Licencia

Privado. Todos los derechos reservados.
