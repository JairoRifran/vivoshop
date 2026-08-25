# Arquitectura

Este documento explica **por qué** el sistema está armado así. Para el modelo de datos ver
[`domain.md`](domain.md); para el alcance y la deuda de este milestone, [`m01.md`](m01.md).

---

## 1. Forma general

Un **monolito modular** más un frontend independiente. No hay microservicios, ni colas, ni event
sourcing, ni Kubernetes. Un producto que todavía no tiene su primer usuario no necesita resolver
la coordinación de veinte equipos; necesita poder cambiar de opinión rápido.

Lo que sí hay son **límites internos explícitos**, porque son baratos ahora y carísimos después.

```
apps/web        Next.js — comprador y Seller Center
apps/api        NestJS  — un solo deployable

packages/domain    reglas de negocio puras
packages/shared    contratos entre API y clientes
packages/config    configuración por mercado
packages/ui        primitivas visuales
packages/seed      dataset de demostración
```

---

## 2. Capas dentro de la API

```
modules/          HTTP: parseo, códigos de estado, nada más
application/      Casos de uso + puertos (interfaces)
@vivo/domain      Entidades, invariantes, máquinas de estado
infrastructure/   Lo único que sabe de Postgres, Redis o un proveedor externo
```

Las dependencias apuntan hacia adentro. `application` puede importar `domain`; `domain` no importa
a ninguna de las otras.

**Esto está aplicado por ESLint, no por disciplina.** En `eslint.config.mjs`:

```js
{
  files: ['packages/domain/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [{
      group: ['@nestjs/*', 'next/*', 'react', 'drizzle-orm*', 'ioredis', 'pg'],
    }]}],
    'no-restricted-globals': ['error', { name: 'fetch' }, { name: 'process' }],
  },
}
```

Si alguien intenta llamar a la base de datos desde una regla de negocio, el build falla.

### Por qué importa en la práctica

`buildCheckoutDraft` calcula precios, valida stock, aplica el umbral de envío gratis y arma la
entrega. Es una función pura. La usa el endpoint de crear pedido y la usa el endpoint de preview
que consulta el checkout web mientras el comprador cambia de opción. **El número que ve el
comprador y el que se le cobra salen del mismo código**, no de dos implementaciones que alguien
tiene que acordarse de mantener sincronizadas.

---

## 3. Puertos y adaptadores

Todo lo que algún día será un proveedor externo es una interfaz. Dos ya tienen un adaptador de
producción al lado del simulado.

| Puerto | Hoy | Después |
| --- | --- | --- |
| `PaymentProviderPort` | `MercadoPagoProvider` (real) o `FakePaymentProvider` | dLocal, Stripe |
| `StreamingProvider` | `LiveKitStreamingProvider` (real) o `MockStreamingProvider` | Agora, Daily, Mux |
| `ShippingProvider` | `FlatRateShippingProvider` | DAC, Correo Uruguayo, UES |
| `NotificationProvider` | `LogNotificationProvider` | FCM + APNs, email, WhatsApp |
| `StorageProvider` | `LocalStorageProvider` | S3 / R2 con subida firmada |
| `CacheStore` / `PresenceStore` | `Memory*` | `Redis*` (ya escritos) |
| Repositorios | `Memory*` | `Drizzle*` (ya escritos) |

Tres transacciones acotadas, no una unidad de trabajo genérica: `OrderTransaction`
(crear un pedido), `PaymentTransaction` (aplicar un aviso de cobro) y
`BidTransaction` (ofertar y aceptar). Cada una expone exactamente las
operaciones que tienen que ocurrir juntas y ninguna más — una genérica tentaría
a cada caso de uso a abrir una transacción, y la que importa acá es siempre
pequeña y con un lock adentro.

Los dos se eligen por configuración (`STREAMING_PROVIDER=mock|livekit`,
`PAYMENT_PROVIDER=fake|mercadopago`), no por build: el clon nuevo y toda la suite de pruebas corren
en los simulados, sin cuenta, sin Docker y sin credenciales.

Cada adaptador real es el **único** archivo del repositorio que conoce el vocabulario de su
proveedor. `LiveKitStreamingProvider` es el único que sabe qué es un `VideoGrant`;
`MercadoPagoProvider` es el único que sabe qué es una preferencia o un `marketplace_fee`. Lo que
está por encima habla de `LiveCapabilities` y de `PaymentStatus`. Cambiar de proveedor es un
archivo nuevo al lado, no una refactorización.

Los adaptadores simulados **implementan la interfaz completa**, no devuelven `true`.
`FakePaymentProvider` crea cobros, aprueba, rechaza, retiene, libera y devuelve, y su aviso recorre
el mismo webhook —misma normalización, misma clave de idempotencia, misma transacción— que el de
Mercado Pago. Por eso el checkout, la máquina de estados y la UI recorren exactamente los mismos
caminos con los dos.

Todos los bindings viven en **un solo archivo**,
[`apps/api/src/infrastructure/infrastructure.module.ts`](../apps/api/src/infrastructure/infrastructure.module.ts).

---

## 4. Decisiones técnicas

### 4.1 Drizzle en lugar de Prisma

El enunciado permitía justificar una alternativa. Las razones, en orden de peso:

1. **Sin paso de codegen.** El repositorio compila y typechequea desde un clone limpio, sin base
   de datos y sin `prisma generate`. Con la persistencia detrás de puertos y el driver por defecto
   en memoria, exigir un artefacto generado para que `tsc` pase sería un contrasentido.
2. **Esquema en TypeScript.** Vive en la capa de infraestructura y lo revisa el mismo `tsconfig`
   que el resto, en vez de un DSL aparte.
3. **Sin binarios de engine.** Menos superficie de instalación y despliegues más livianos.
4. **SQL de verdad al alcance.** Las métricas del vendedor y los reportes que vienen se escriben
   mejor con SQL que peleando con un query builder que lo esconde.

Costo aceptado: menos magia. Hay que escribir los repositorios a mano — que es exactamente lo que
hicimos, y están cubiertos por 26 tests de integración.

### 4.2 Driver de datos conmutable

`DATA_DRIVER=memory` es el valor por defecto. Esto no es una comodidad para la demo:

- `pnpm install && pnpm dev` levanta el producto entero sin Docker, sin migraciones y sin `.env`.
- Cada repositorio tiene **dos** implementaciones, lo que mantiene los puertos honestos: si un
  caso de uso filtrara SQL, el driver en memoria dejaría de compilar.
- Los tests de integración de la API corren en milisegundos, sin contenedores.

El driver PostgreSQL no es una promesa: tiene esquema, migraciones versionadas, seeder y 26 tests
que lo ejercitan contra PostgreSQL real.

### 4.3 Tests de SQL con PGlite, y un smoke test contra un servidor real

Los repositorios Drizzle se prueban contra [PGlite](https://pglite.dev) — PostgreSQL compilado a
WebAssembly, corriendo en proceso — aplicando **las migraciones versionadas del repositorio**. Se
ejecuta el mismo SQL que en producción, con constraints, transacciones y semántica JSONB reales,
sin Docker y sin base de datos compartida entre desarrolladores.

PGlite tiene un límite honesto: corre **un solo backend**, así que demuestra que el SQL es correcto
pero no que dos *conexiones* peleando por la última unidad se serializan con locks de fila. Para eso
está `pnpm db:smoke`, que corre contra cualquier `DATABASE_URL` con un pool real y verifica
transacciones, concurrencia e idempotencia dentro de un schema descartable.

### 4.4 Modelado: columnas vs JSONB

Una regla, aplicada de forma consistente:

> Lo que se consulta, se une o se muta por separado tiene tabla y columnas.
> Lo que solo se lee junto a su padre y es un snapshot inmutable es JSONB.

Por eso `product_variants` es una tabla — el stock se descuenta por variante, en paralelo, durante
un vivo — mientras que las imágenes de un producto o la línea de tiempo de un pedido son JSONB:
nadie selecciona una imagen sin su producto.

### 4.5 El pedido se crea en una transacción

Reservar stock, insertar el pedido, insertar sus líneas y registrar la
atribución al vivo ocurren dentro de un solo `BEGIN … COMMIT`. El puerto es
[`OrderTransaction`](../apps/api/src/application/ports/order-transaction.ts):
seis operaciones concretas, no un Unit of Work genérico. Un UoW genérico habría
tenido que exponer todos los repositorios y habría tentado a cada caso de uso a
abrir una transacción.

El descuento de stock es una sentencia condicional por línea:

```sql
UPDATE product_variants SET stock = stock - $q
 WHERE id = $v AND active AND stock >= $q
RETURNING stock
```

El predicado es la garantía: dos compradores llegan a la vez, el lock de fila
los serializa y el segundo actualiza cero filas. No hay ventana entre leer y
escribir porque no hay lectura. Las líneas se ordenan por `variantId` antes de
tocarse, que es lo que evita deadlocks entre transacciones que compran las
mismas variantes en orden distinto.

La llamada al proveedor de pagos queda **fuera** de la transacción: sostener
locks durante una llamada de red a un tercero es cómo se producen tormentas de
locks en producción.

Detalle completo en [`m01.1.md`](m01.1.md).

### 4.6 Idempotencia en el dominio, no junto al proveedor

La regla es nuestra antes que de nadie: un doble tap o una conexión mala pueden
enviar el mismo pedido dos veces. Que Mercado Pago vaya a reintentar webhooks es
un segundo consumidor de la misma regla, no su motivo, así que vive en
`@vivo/domain`.

La reserva de la clave comparte transacción con el pedido, y el `INSERT …
ON CONFLICT DO NOTHING` sobre una clave primaria compuesta es lo que resuelve la
concurrencia: PostgreSQL bloquea al segundo hasta que el primero confirma o
aborta. Como consecuencia deliberada, un intento fallido **libera** la clave.

### 4.7 El dinero es un entero

Nunca hay un `float` en un precio. Todo importe es un entero en la unidad mínima de la moneda
(centésimos para UYU, unidades enteras para CLP y PYG). Los decimales existen únicamente al
renderizar, y esa función vive en `@vivo/config`, que es la única que sabe de locales.

El impuesto se resuelve desde una **categoría con nombre**, nunca desde el país:
`MarketConfig.tax` es `{ defaultCategory, rules }` y un producto puede apuntar a
una categoría distinta. El IVA uruguayo va incluido en el precio, así que se
extrae del bruto en vez de sumarse encima:

```
tax = gross × rate / (1 + rate)
```

Un mercado aditivo invierte la fórmula cambiando `treatment` en su regla. El
cálculo es **por línea** y se congela en el pedido como snapshot, para que un
cambio de tasa no reescriba la historia de lo que alguien pagó.

### 4.8 Un solo cliente HTTP

`createApiClient` vive en `@vivo/shared` y no sabe nada de React ni de Next. La web lo usa desde
Server Components; la futura app de Expo lo usará igual. El contrato no puede divergir entre
plataformas porque es literalmente el mismo objeto.

### 4.9 Nada de estado de sesión en el cliente

El token vive en una cookie `httpOnly`. Los Server Components lo leen para llamar a la API; las
Server Actions lo escriben. El JavaScript del navegador nunca lo ve, así que un script de terceros
comprometido no puede robar una sesión.

### 4.10 Presencia y reacciones

Los espectadores y los corazones no se guardan por evento. El contador persistido es el histórico;
lo que ocurre ahora vive en `PresenceStore` — un `Set` por sesión en memoria, un `Set` de Redis
cuando hay más de un proceso. Las dos implementaciones tienen la misma forma a propósito: cambiar
de driver no cambia la semántica.

Los corazones se agrupan en el cliente: una ráfaga de toques es **un** request cuando se calma.

### 4.11 Service worker escrito a mano

`next-pwa` está sin mantenimiento y Serwist agrega una dependencia y un paso de build para tres
comportamientos concretos. El service worker propio hace exactamente eso: instalabilidad, caché de
imágenes generadas y página offline.

Lo que deliberadamente **no** hace es cachear respuestas de la API. Mostrar un producto agotado
como disponible es peor que mostrar un error.

### 4.12 Sin librería de componentes

Es la decisión que más protege el aspecto del producto. Una librería genérica habría hecho que el
visor de vivo y el Seller Center se parecieran a un panel de administración. Las primitivas de
`@vivo/ui` son pocas y específicas: botones con altura de pulgar, bottom sheet sobre `<dialog>`
nativo, campos con tipografía de 16 px para que iOS no haga zoom.

Tampoco hay librería de animación: los corazones flotantes, el deslizamiento del sheet y el
movimiento del escenario son CSS, y todos se apagan con `prefers-reduced-motion`.

---

## 5. La web

### 5.1 Datos en el servidor

Cada pantalla lee sus datos en un Server Component con un `Promise.all`. El bundle del cliente no
lleva código de fetching y no hay cascadas de requests.

Los componentes de cliente existen donde hacen falta y solo ahí: visor de vivo, consola de
transmisión, formularios, botón de seguir, buscador.

### 5.2 Sin `Suspense` ni `loading.tsx`

Documentado en detalle en [`m01.md`](m01.md#suspense). En resumen: en Next 16.3.2 los límites de
Suspense quedan marcados como *postponed* (`$~`) bajo el servidor de desarrollo y su contenido
nunca se resuelve. Una página que solo funciona en producción no sirve, así que las páginas
esperan sus datos directamente.

### 5.3 Dos mundos, un producto

El comprador vive en una columna clara y angosta con navegación inferior de cinco destinos. El
Seller Center es oscuro, más denso, con su propia navegación y un botón de transmitir elevado. En
escritorio el Seller Center se ensancha de verdad (`lg:max-w-6xl`) porque gestionar un catálogo es
trabajo de dos manos.

Las dos pantallas inmersivas — visor de vivo y consola de transmisión — escapan por completo de
esos layouts: pantalla completa, sin navegación, `100dvh` y safe areas.

---

## 6. Internacionalización

Uruguay no está hardcodeado. `@vivo/config` define un `MarketConfig` por país:

```ts
interface MarketConfig {
  country; locale; currency; timeZone; status;
  phone:    { callingCode; nationalDigits; example };
  address:  { regionLabel; localityLabel; postalCodeRequired; regions };
  tax:      { model: 'included' | 'added'; label; rateBps };
  delivery: DeliveryMethodConfig[];
  payment:  PaymentMethodConfig[];
}
```

Uruguay está completo (19 departamentos, IVA 22 % incluido, tres modos de entrega, Mercado Pago y
efectivo). Argentina está declarado como `planned` a propósito: existe para demostrar que agregar
un mercado es configuración y no un refactor. El endpoint `GET /markets` expone todo esto para que
los clientes rendericen direcciones, impuestos y medios de pago sin saber de países.

---

## 7. Observabilidad

`ANALYTICS_EVENTS` en `@vivo/shared` es el catálogo, con el payload tipado por evento: un typo en
el nombre de una propiedad no compila.

En M01 los eventos se guardan en el driver activo y alimentan métricas reales del vendedor
(espectadores de los últimos 7 días, conversión). Apuntar esto a PostHog o BigQuery es cambiar un
método.

Los errores de dominio llevan un `code` estable. El transporte lo mapea a un status HTTP y el
cliente lo mapea a una frase en español. Nada inesperado se filtra al comprador: el stack se
registra, el cliente recibe un código y una oración que se le puede mostrar a una persona.

---

## 8. Qué haría falta antes de escalar

Ordenado por cuándo empieza a doler:

1. **Refresh tokens.** Hoy el access token dura 7 días y no hay revocación.
2. **WebSocket para el chat.** El polling cada 4 s no aguanta miles de espectadores.
3. **Paginación real.** Los listados tienen `limit` pero no cursor.
4. **Expiración de claves de idempotencia.** La tabla crece sin límite.
5. **Cancelación de pedidos atómica.** Devolver stock sigue siendo lectura-y-escritura por línea.

Resueltos en M01.1: descuento de stock atómico e idempotencia en la creación de pedidos.
