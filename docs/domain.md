# Modelo de dominio

Vive en [`packages/domain`](../packages/domain): TypeScript puro, sin framework, sin I/O, sin
lectura de entorno. ESLint lo hace cumplir.

---

## Mapa

```
User ──owns──► Store ──has──► Product ──has──► ProductVariant
 │               │               ▲
 │               │               │
 │               └──hosts──► LiveSession ──features──► (un Product)
 │                              │
 │                              ├──► LiveMessage
 │                              │
 └──follows──► Store            │
 │                              │
 └──places──► Order ──belongs to one Store──┘ (atribución del vivo)
                │
                └──has──► OrderItem (snapshot inmutable)
```

Un pedido pertenece **a una sola tienda**. El carrito multi-tienda es un no-objetivo explícito de
M01, y la firma de `buildCheckoutDraft` lo deja escrito en el tipo en vez de en un comentario.

---

## Value objects

### Money

```ts
interface Money { amountMinor: number; currency: CurrencyCode }
```

Entero, siempre, en la unidad mínima de la moneda. `money()` rechaza no-enteros y valores fuera
del rango seguro. Se puede sumar, restar, multiplicar por cantidad y sacar porcentajes en puntos
básicos; mezclar monedas tira `CURRENCY_MISMATCH`.

`taxPortionOfGross(gross, rateBps)` extrae el impuesto ya contenido en un precio bruto, que es
como se cotiza en Uruguay.

### Identificadores con marca

`UserId`, `StoreId`, `ProductId`, `VariantId`, `LiveSessionId`, `OrderId`, `MessageId`. Son strings
en runtime, pero el compilador no deja pasar un `StoreId` donde va un `ProductId` — el error de
copiar y pegar más común en un sistema con esta cantidad de relaciones.

### Slug

Las URLs públicas de tienda son `/tienda/<slug>`, así que el slug es parte del contrato. `toSlug()`
normaliza acentos y puntuación; `StoreService` resuelve colisiones agregando un sufijo.

---

## Entidades

### User

```
id, name, email, phone, avatarUrl, country, roles[], status, createdAt, updatedAt
```

**Los roles son aditivos, nunca excluyentes.** Todos se registran como `buyer`; activar el modo
vendedor agrega `seller` a la misma cuenta. No hay registro de vendedor por separado y no existe
forma de terminar con dos identidades para una persona. `withRole()` es idempotente.

Estados: `active`, `suspended`, `deleted`.

### Store

```
id, ownerId, name, slug, description, category, logoUrl, coverUrl,
country, currency, city, reputation, followerCount, status, settings
```

`reputation.ratingBps` va de 0 a 500 en entero (480 = 4,8 estrellas) para que los promedios sean
exactos. `settings` es un objeto explícito — métodos de entrega habilitados, umbral de envío
gratis, instrucciones de retiro — para que agregar una opción no obligue a una migración.

Estados: `active`, `paused`, `suspended`. `assertStoreCanSell()` protege el checkout.

En M01 una cuenta posee **una** tienda. Eso mantiene el chequeo de propiedad en una sola
comparación.

### Product y ProductVariant

```
Product:  id, storeId, title, description, basePriceMinor, compareAtPriceMinor,
          currency, images[], options[], variants[], status

Variant:  id, optionValues{}, sku, priceMinor (override), stock, active
```

Las opciones son dimensiones de elección — `Talle`, `Color`, `Sabor`, `Formato` — no hay nada
específico de moda. Un producto declara sus dimensiones y cada variante fija un valor por
dimensión.

**Todo producto tiene al menos una variante**, incluidos los simples sin opciones. Los pedidos, el
stock y el producto destacado del vivo siempre apuntan a una variante, lo que elimina de todo el
resto del sistema la pregunta "¿esto es un producto o una variante?".

Estados: `draft`, `active`, `paused`, `archived`. Solo `active` con stock es comprable.

### LiveSession

```
id, storeId, title, status, thumbnailUrl, scheduledAt, startedAt, endedAt,
viewerCount, peakViewerCount, likeCount, products[], featuredProductId, playbackUrl
```

`products[]` guarda posición y unidades vendidas por producto. `featuredProductId` es lo que está
en pantalla: el control que más usa quien transmite.

```
scheduled ──► live ──► ended
     │
     └──► cancelled
```

Un vivo en curso solo puede terminar. No se cancela algo que la gente está mirando.

### Order

```
id, code, buyerId, storeId, liveSessionId?, items[], currency,
subtotalMinor, shippingMinor, discountMinor, taxMinor, totalMinor,
status, payment, delivery, buyerNote, timeline[]
```

`code` es una referencia legible (`VV-8XJ53`) derivada del id sin caracteres ambiguos, para poder
dictarla por teléfono.

`liveSessionId` es la atribución: qué transmisión produjo la venta.

```
pending_payment ──► paid ──► preparing ──► shipped ──► delivered
       │             │            │
       └─────────────┴────────────┴──► cancelled
```

Un pedido despachado ya no se cancela. La máquina de estados es **datos**, no una cadena de `if`:
la API, la UI del vendedor y los tests leen la misma tabla, y `nextOrderStatuses()` es lo que
dibuja los botones — la interfaz no puede ofrecer una transición que el servidor rechazaría.

#### OrderItem: snapshots inmutables

Cada línea copia título, variante, imagen y precio unitario al momento de comprar. Un pedido de
hace cinco años tiene que verse idéntico aunque el producto se haya renombrado, repreciado o
borrado.

#### Stock

Se descuenta **al crear el pedido**, no al pagarlo. Vender de más durante un vivo es una falla
peor que un pedido impago abandonado, y cancelar devuelve las unidades al stock.

El descuento es **atómico**: un `UPDATE … WHERE stock >= :cantidad` condicional por línea, dentro
de la transacción del pedido. `buildCheckoutDraft` puede comprobar el stock que le pasaron para dar
un error rápido y amable, pero **no es la autoridad**: entre esa lectura y la escritura otro
comprador puede haberse llevado la última unidad. Por eso acepta `skipStockCheck` y la creación de
pedidos lo usa.

`orderReservationLines` ordena las líneas por `variantId` antes de tocarlas. Dos transacciones que
compran las mismas variantes en orden inverso se bloquearían mutuamente; el orden estable es todo
el mecanismo que lo evita, y los dos drivers lo aplican.

#### Impuestos

Cada línea guarda la regla bajo la que se cobró (`taxCategory`, `taxRateBps`, `taxAmountMinor`) y
el pedido guarda un `TaxSnapshot`. Es un snapshot, nunca se recalcula al leer: un cambio de tasa el
año que viene no puede reescribir lo que alguien pagó. Un pedido que mezcla categorías reporta
`mixed` con la tasa efectiva.

### Idempotencia

No es una entidad de negocio, pero sí una regla del dominio. Para una identidad y una operación,
una clave produce **exactamente un efecto**. Reproducirla devuelve el resultado original;
reproducirla con un payload materialmente distinto es `IDEMPOTENCY_CONFLICT`, nunca una
sobreescritura silenciosa.

`fingerprintRequest` genera una huella canónica: el orden de las propiedades no cuenta, y un campo
opcional omitido equivale a `undefined`. Un cliente que reserializa su cuerpo en el reintento sigue
enviando el mismo pedido.

Vive en el dominio y no junto al proveedor de pagos porque el problema es nuestro antes que de
nadie: el doble tap existe con o sin Mercado Pago.

### Follow

Par único `(userId, storeId)` con `notifyOnLive`. Seguir dos veces es una operación sin efecto, no
un error de constraint.

### LiveMessage

```
id, liveSessionId, authorId?, authorName, authorAvatarUrl, kind, body, createdAt
```

`kind`: `chat`, `system`, `purchase`. El cuerpo se normaliza y se recorta a 240 caracteres.

---

## Servicios de dominio

Funciones puras, sin I/O.

| Función | Qué garantiza |
| --- | --- |
| `buildCheckoutDraft` | La única puerta a un pedido: valida tienda, producto, variante, stock, dirección, y calcula todo |
| `calculateOrderTotals` | El único lugar donde se calcula plata |
| `resolveShippingFee` | Umbral de envío gratis por tienda |
| `buildOrderItem` | Congela el snapshot de la línea, incluida su regla fiscal |
| `resolveTaxRule` | Categoría del producto, si no la del mercado. Nunca «la tasa del país» |
| `taxForAmount` | Incluido, aditivo o exento, sin adivinar |
| `summarizeTax` | Colapsa las reglas por línea en el snapshot del pedido |
| `orderReservationLines` | Orden estable de bloqueo, para que no haya deadlocks |
| `stockShortfallError` | Distingue `OUT_OF_STOCK` de `VARIANT_UNAVAILABLE` |
| `assertIdempotencyKey` / `fingerprintRequest` | Formato de clave y huella canónica del payload |
| `reserveStock` / `releaseStock` | Devuelven una variante nueva; nunca mutan |
| `assertOrderTransition` | Ninguna transición ilegal llega a la base |
| `assertLiveTransition` | Ídem para transmisiones |
| `buildOrderCode` | Determinista y legible |
| `installmentPreview` | Cuotas indicativas hasta que haya un emisor real |

`buildCheckoutDraft` acepta `enforceAddress: false` para que el checkout web pueda mostrar el
precio antes de que el comprador escriba su dirección — bloquear el precio hasta entonces hace que
el formulario se sienta roto.

---

## Errores

`DomainError` lleva un `code` estable de una unión cerrada: `OUT_OF_STOCK`, `VARIANT_UNAVAILABLE`,
`PRODUCT_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `INVALID_IDEMPOTENCY_KEY`, `ORDER_CREATION_FAILED`,
`CURRENCY_MISMATCH`, `INVALID_ORDER_TRANSITION`, `ADDRESS_REQUIRED`, `STORE_NOT_ACTIVE`, y el
resto.

El transporte mapea el código a un status HTTP; el cliente lo mapea a una frase en español. El
`message` del error es para desarrolladores y logs, nunca para mostrarle a un comprador.

---

## Qué está probado

128 tests unitarios cubren: aritmética de dinero y rechazo de mezcla de monedas, extracción de IVA
incluido, resolución de reglas fiscales por categoría con mercados incluidos/aditivos/exentos,
pedidos de tasa mixta, formato de claves de idempotencia y estabilidad de la huella, ambas máquinas
de estado con sus transiciones ilegales, precios de checkout con envío, retiro y descuentos, reserva
y liberación de stock, sobreventa, tiendas pausadas, productos no publicados, y la consistencia del
dataset de demostración.

Encima de eso, 34 tests de contrato ejercitan la creación de pedidos —stock atómico, concurrencia,
idempotencia y rollback— **de forma idéntica contra los dos drivers de persistencia**. Ver
[`m01.1.md`](m01.1.md).
