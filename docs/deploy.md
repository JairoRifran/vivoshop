# Despliegue

Tres piezas, tres lugares. No es una elección de gusto: es la única topología
que soporta lo que M02 construyó.

| Pieza | Dónde | Por qué ahí |
| --- | --- | --- |
| Web (Next.js) | **Vercel** | Es su plataforma nativa. SSR, imágenes, edge. |
| API (NestJS + Socket.IO) | **Railway** | Necesita un proceso **vivo**. Vercel no puede. |
| PostgreSQL | **Supabase** | `DATABASE_URL` y nada más: el proyecto ya habla Postgres. |
| Video | **LiveKit Cloud** | Opcional. Sin él la app corre en `mock`. |

> ## Por qué la API no va en Vercel
>
> Las funciones serverless no mantienen conexiones abiertas. El gateway de
> `/realtime` es un WebSocket: chat, corazones, contador de espectadores,
> producto destacado y estado del vivo viajan por ahí. En serverless también se
> romperían el barrido de sesiones abandonadas (`LiveJanitor`, un intervalo) y
> los presupuestos de chat, que viven en memoria del proceso.
>
> La API REST sí funcionaría en Vercel. El vivo, no.

---

## 1. Supabase — la base de datos

1. Crear un proyecto en [supabase.com](https://supabase.com). Elegir la región
   más cercana a los usuarios (para Uruguay: **South America (São Paulo)**).
2. Guardar la contraseña de la base: Supabase la muestra una sola vez.
3. **Project Settings → Database → Connection string.** Hay tres, y elegir mal
   se paga con un error de red que parece cualquier otra cosa:

   | Cadena | Host y puerto | Veredicto |
   | --- | --- | --- |
   | Direct connection | `db.<ref>.supabase.co:5432` | **Solo IPv6.** Desde 2024 Supabase no da IPv4 acá sin un add-on pago. Si tu red o tu host no tienen IPv6, falla con `ENETUNREACH` o un timeout sin explicación. |
   | **Session pooler** | `aws-0-<region>.pooler.supabase.com:5432` | **Esta.** IPv4, modo sesión: se comporta como una conexión directa, con transacciones y sentencias preparadas completas. Es lo que necesita un proceso largo con pool propio. |
   | Transaction pooler | `...pooler.supabase.com:6543` | Para serverless. Modo transacción: sin sentencias preparadas y con límites que este proyecto no necesita aceptar. |

   El usuario del pooler lleva el ref del proyecto adentro
   (`postgres.<ref>`), no es solo `postgres`.

4. La variable queda así:

   ```
   DATABASE_URL=postgresql://postgres.<ref>:LA_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATA_DRIVER=postgres
   ```

   Si la contraseña tiene caracteres raros (`@`, `:`, `/`, `#`), hay que
   escaparlos en porcentaje o la URL se parsea mal.

### TLS — resuelto, y vale entender por qué

Supabase firma su certificado con su propia CA, así que Node rechaza la
conexión con `self signed certificate in certificate chain`. La CA pública ya
está versionada en el repositorio:

```
DATABASE_CA_CERT=./certs/supabase-prod-ca.crt
```

`DATABASE_CA_CERT` acepta una ruta, el PEM completo, o un PEM con los saltos de
línea escapados — que es como los pega un panel de variables de entorno.

Hay una trampa que costó un rato: **`node-postgres` parsea el `sslmode` de la
URL y con eso pisa la configuración TLS que se le pasa al lado**. Como Supabase
entrega la cadena con `?sslmode=require` incluido, `DATABASE_SSL` y
`DATABASE_CA_CERT` no hacían nada en absoluto, y el error se repetía sin
importar qué se configurara. `client.ts` ahora limpia esos parámetros de la URL
y decide el TLS en un solo lugar — el mismo que usan el migrador, el seed y el
smoke test.

La alternativa, `DATABASE_SSL=no-verify`, cifra pero no comprueba con quién
habla: deja la puerta abierta a un intermediario activo. Con la CA en el
repositorio no hay motivo para usarla.

### Migrar y sembrar

Desde tu máquina. Poner la cadena en un `.env` en la raíz del repositorio —
está en `.gitignore`, y así la contraseña no queda en el historial de la
terminal:

```
DATA_DRIVER=postgres
DATABASE_URL=postgresql://postgres.<ref>:LA_PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Después, en orden:

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm db:smoke
```

`db:smoke` es el que vale: crea un esquema descartable, corre las migraciones
ahí y verifica de verdad el stock atómico, la idempotencia y el rollback contra
ese servidor. Si pasa, la base está lista.

> **Cuidado: un `.env` con la base desplegada afecta a `pnpm test`.**
>
> `infrastructure.module.ts` elige el driver en tiempo de importación, antes de
> que cualquier `beforeAll` pueda cambiarlo. Con un `.env` apuntando a Supabase,
> una corrida local de las pruebas escribió veintinueve transmisiones de prueba
> en la base desplegada — y pasó en verde, así que no se notó hasta mirar los
> datos.
>
> Ya está cerrado por dos lados: `apps/api/vitest.setup.ts` fija el driver en
> memoria antes de importar nada, y `loadEnv` se niega a correr pruebas contra
> una base que no sea local. Vale conocerlo igual, porque el mismo patrón
> —decidir algo en tiempo de importación— puede repetirse en otro lado.

### Sacar los datos de demo

Para una URL pública, el seed es un problema: trae cuentas con contraseña
`vivo1234`, una de ellas vendedora, que cualquiera que lea el repositorio puede
usar.

```bash
pnpm db:clear
```

Vacía las mismas tablas que el seed llena, en el mismo orden, y deja el esquema
y las migraciones intactos. Después de eso la aplicación arranca sin tiendas
—que es como arranca de verdad: la primera tienda es la primera persona que se
registra— y las pantallas vacías que ya existen se encargan del resto.

> **Los datos de demo traen usuarios con contraseña `vivo1234`.** En una URL
> pública eso es una cuenta de vendedor abierta para cualquiera que lea el
> README. Está bien para mostrar el producto; no lo está para nada más. Cuando
> la demo deje de ser una demo, hay que borrar esos usuarios o cambiarles la
> contraseña.

---

## 2. Railway — la API

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub
   repo** → `JairoRifran/vivoshop`.
2. Railway lee `railway.json` de la raíz y usa `apps/api/Dockerfile`. No hay que
   configurar build ni start command.
3. **Settings → Networking → Generate Domain.** Queda algo como
   `vivoshop-api-production.up.railway.app`.
4. **Variables:**

   ```
   NODE_ENV=production
   DATA_DRIVER=postgres
   CACHE_DRIVER=memory
   DATABASE_URL=postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_CA_CERT=./certs/supabase-prod-ca.crt
   JWT_SECRET=<32+ caracteres aleatorios, generados, no inventados>
   WEB_ORIGIN=https://<tu-app>.vercel.app
   RATE_LIMIT=120
   STREAMING_PROVIDER=mock
   ```

   `PORT` lo inyecta Railway y la API lo lee sola. `TRUST_PROXY` ya viene en
   `true` desde el Dockerfile.

   Para generar el secreto:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

5. Health check: `/health`. Ya está declarado en `railway.json`.

### El puerto, que es donde se pierde una tarde

Railway inyecta `PORT` con **su** valor —8080 por defecto— y la aplicación lo
lee como `API_PORT`. Pero el dominio público enruta al puerto que uno elige al
generarlo, y **si los dos no coinciden, cada pedido devuelve 502 "Application
failed to respond"**.

Lo desagradable es que no parece un problema de puertos: el despliegue figura
`ACTIVE`, el build salió bien, y los logs muestran la aplicación arrancando sin
un solo error. Los logs son justamente donde está la respuesta:

```
[Persistence] Driver postgres: conexión verificada.
[Bootstrap]   Vivo API en http://localhost:8080     <- escucha acá
                                             ^^^^
```

Dos formas de alinearlos; da igual cuál, pero hay que elegir una:

- Fijar `PORT=4000` como variable del servicio (queda consistente con el
  `EXPOSE` y el healthcheck del Dockerfile), o
- Editar el dominio y apuntarlo al puerto que Railway ya inyectó.

### Región

Fijada en `railway.json`, no en el panel:

```json
"multiRegionConfig": { "us-east4-eqdc4a": { "numReplicas": 1 } }
```

El primer despliegue cayó en `EU West` —la región por defecto de la cuenta—
con Supabase en `sa-east-1`. Cada consulta cruzaba el Atlántico, y se notaba:

| Endpoint | EU West | US East |
| --- | --- | --- |
| `/markets` (sin base) | ~640 ms | *(ver abajo)* |
| `/stores` (una consulta) | ~1045 ms | *(ver abajo)* |

Railway **no tiene región en Sudamérica**, así que Virginia es lo más cerca que
se puede estar de São Paulo y de Uruguay a la vez. Si algún día aparece
`sa-east`, es cambiar esa clave.

**Una sola réplica, a propósito.** No es una limitación del plan: con dos, los
presupuestos de chat —que viven en memoria del proceso— pasarían a permitir 5 ×
instancias, y Socket.IO sin adaptador de Redis entregaría cada `emit` solo a la
mitad de la sala. Ver [`m02.md`](m02.md) §21.

### Una sola instancia, a propósito

`numReplicas: 1` en `railway.json` no es pereza. Con dos instancias:

- Los presupuestos de chat viven en memoria de cada proceso, así que el límite
  real pasaría a ser 5 × instancias.
- Socket.IO no tiene adaptador de Redis, así que un `emit` solo llegaría a los
  sockets conectados a esa instancia: media sala se perdería los mensajes.

Ambas cosas están anotadas como deuda en [`m02.md`](m02.md) §21. Antes de
escalar horizontalmente hay que agregar Redis (Upstash sirve) y
`@socket.io/redis-adapter`.

---

## 3. Vercel — la web

1. [vercel.com](https://vercel.com) → **Add New → Project** → importar
   `JairoRifran/vivoshop`.
2. **Root Directory: `apps/web`.** Es el único ajuste manual. Vercel lee
   `apps/web/vercel.json`, que instala desde la raíz del monorepo y compila con
   Turbo para que los paquetes del workspace existan antes que Next.
3. **Environment Variables:**

   ```
   NEXT_PUBLIC_API_URL=https://<tu-api>.up.railway.app
   INTERNAL_API_URL=https://<tu-api>.up.railway.app
   NEXT_PUBLIC_APP_NAME=Vivo
   NEXT_PUBLIC_DEFAULT_COUNTRY=UY
   ```

   `NEXT_PUBLIC_API_URL` la usa el navegador (fetch y WebSocket).
   `INTERNAL_API_URL` la usan los Server Components. Apuntan al mismo lugar;
   están separadas porque en otras topologías no lo estarían.

   > Nada con prefijo `NEXT_PUBLIC_` es secreto: se compila dentro del
   > JavaScript que baja el navegador. Ninguna credencial va ahí.

4. Deploy. Después, **volver a Railway** y poner el dominio real de Vercel en
   `WEB_ORIGIN` — hasta que eso pase, el navegador va a rechazar cada llamada
   por CORS.

### El orden importa

Es circular: Vercel necesita la URL de Railway y Railway necesita la de Vercel.
Se resuelve en dos pasadas:

1. Desplegar Railway → anotar el dominio.
2. Desplegar Vercel con ese dominio → anotar el de Vercel.
3. Actualizar `WEB_ORIGIN` en Railway → redeploy.

---

## 4. LiveKit Cloud — el video (opcional)

Sin esto la app funciona: `STREAMING_PROVIDER=mock` muestra el escenario
simulado y **todo el realtime sigue andando**. El video real es un paso aparte.

1. [cloud.livekit.io](https://cloud.livekit.io) → crear proyecto. El plan
   gratuito alcanza para probar.
2. En **Railway**, agregar:

   ```
   STREAMING_PROVIDER=livekit
   LIVEKIT_URL=wss://<proyecto>.livekit.cloud
   LIVEKIT_API_KEY=API...
   LIVEKIT_API_SECRET=...
   ```

3. **`LIVEKIT_API_SECRET` va solo en Railway.** Nunca en Vercel, nunca con
   prefijo `NEXT_PUBLIC_`. Los tokens se firman en la API, por participante,
   con el permiso mínimo y con vencimiento.

Si falta alguna de las tres variables, la API **no arranca**. Es preferible a
descubrirlo cuando alguien toca "Transmitir" delante de gente.

### HTTPS y la cámara

`getUserMedia` solo existe en contexto seguro. Vercel y Railway sirven HTTPS por
defecto, así que en producción la cámara funciona sin hacer nada — a diferencia
de probar en la LAN, donde hace falta un túnel (ver
[`live-testing.md`](live-testing.md)).

---

## 4.5. Migraciones: por qué el deploy las corre solo

`railway.json` declara:

```json
"preDeployCommand": "node dist/infrastructure/persistence/drizzle/migrate.js"
```

Railway lo ejecuta **una vez por deploy, antes de que la versión nueva reciba
tráfico**. Si falla, aborta el rollout y la versión vieja sigue sirviendo.

Esto no es una comodidad: es la corrección de una caída real. El deploy de M03
subió código que consulta `stores.verification_status`, la migración nunca se
había aplicado a Supabase, y la API devolvió **500 en `/stores`, `/products` y
`/live`** —o sea, en todo el producto— mientras `/health` seguía en 200 y el
panel de Railway mostraba el servicio como sano. El healthcheck no toca la base,
así que no había forma de enterarse desde ahí.

Tres detalles del comando, cada uno por un motivo:

- **Va en `preDeployCommand` y no en el `CMD`.** El `CMD` corre una vez por
  réplica; dos réplicas migrando a la vez es una carrera que nadie quiere
  depurar de madrugada. `preDeployCommand` corre una sola vez.
- **Invoca el JS compilado, no `pnpm db:migrate`.** La etapa de ejecución del
  Dockerfile no habilita corepack, así que ahí no hay ni `pnpm` ni `tsx`. El
  `dist` sí tiene `migrate.js` porque `tsconfig.build.json` solo excluye tests.
- **Las migraciones siguen siendo archivos revisables.** Se generan con
  `pnpm db:generate` y se commitean; nunca se usa `drizzle-kit push`, que
  muta la base desde el esquema y solo sirve en una máquina local.

El seed **no** es automático y no debe serlo: sobrescribir en silencio una base
con datos reales en cada arranque sería hostil. Se corre a mano con
`pnpm db:seed` cuando corresponde.

### Si una migración quedó sin aplicar

Se nota como un 500 en endpoints que leen la tabla afectada, con `/health` en
200. Para aplicarlas desde tu máquina, con `DATABASE_URL` y `DATABASE_CA_CERT`
apuntando a Supabase:

```bash
pnpm --filter @vivo/api db:migrate
```

### Migraciones de M04

`0006_m04_bid_mode` agrega `bid_sessions`, `bids` y `order_items.bid_id`. Es
aditiva —sin `DROP`, sin `TRUNCATE`— y la aplica el `preDeployCommand` sola. No
hace falta hacer nada a mano.

Incluye un **índice único parcial**:

```sql
CREATE UNIQUE INDEX bid_sessions_one_open_per_product_idx
  ON bid_sessions (live_session_id, product_id) WHERE status = 'open';
```

Es la base la que impide dos pujas abiertas del mismo producto en un vivo, no
un chequeo previo que dos peticiones simultáneas podrían pasar las dos. Parcial
para que cerrar y reabrir siga siendo posible.

### Qué versión está viva

`/health` publica el commit desplegado:

```json
{ "status": "ok", "version": "cd206a6", "dataDriver": "postgres", ... }
```

Sale de `RAILWAY_GIT_COMMIT_SHA`, que Railway inyecta solo; no hay que
configurar nada. Fuera de un deploy dice `development`, y en producción sin
commit inyectado dice `unknown` — que no es lo mismo y por eso se distinguen.

Existe por una pregunta que no se pudo contestar cuando hizo falta: durante la
caída de M03, `/health` decía `ok` y no había forma de saber desde afuera qué
commit estaba corriendo. Ahora es una consulta de un segundo:

```bash
curl -s https://<tu-api>.up.railway.app/health
```

El valor se valida como SHA antes de recortarlo. `/health` es público, así que
lo que sale de ahí es algo que el proceso reconoció, no el contenido de una
variable de entorno.

---

## 5. Mercado Pago — los cobros (opcional)

Sin esto la app funciona: `PAYMENT_PROVIDER=fake` deja el circuito completo
—pedido, cobro, webhook, stock, "venta confirmada"— andando contra un proveedor
simulado que **no mueve dinero**. Pasar a Mercado Pago es un paso aparte y una
decisión explícita.

1. [mercadopago.com.uy/developers/panel](https://www.mercadopago.com.uy/developers/panel)
   → crear aplicación. Permisos: **read**, **write** y **offline access** — el
   último es el que habilita el refresh token, y sin él las cuentas de los
   vendedores se caen cuando vence el acceso.
2. En **Configuración avanzada**, la URL de redirección OAuth:

   ```
   https://<tu-api>.up.railway.app/payments/mercadopago/oauth/callback
   ```

3. En **Webhooks**, la URL de notificaciones y el secreto de firma:

   ```
   https://<tu-api>.up.railway.app/payments/webhook/mercadopago
   ```

4. En **Railway**, agregar:

   ```
   PAYMENT_PROVIDER=mercadopago
   MERCADOPAGO_CLIENT_ID=...
   MERCADOPAGO_CLIENT_SECRET=...
   MERCADOPAGO_ACCESS_TOKEN=TEST-...      # sandbox primero, siempre
   MERCADOPAGO_WEBHOOK_SECRET=...
   API_PUBLIC_URL=https://<tu-api>.up.railway.app
   ```

Cuatro cosas que conviene no aprender por las malas:

- **`MERCADOPAGO_CLIENT_SECRET` y `MERCADOPAGO_ACCESS_TOKEN` van solo en
  Railway.** Nunca en Vercel, nunca con prefijo `NEXT_PUBLIC_`. El navegador no
  necesita ninguno: el checkout se arma en la API.
- **`API_PUBLIC_URL` tiene que ser alcanzable desde internet.** De ahí salen la
  `notification_url` y el callback de OAuth. Con `localhost` el webhook nunca
  llega y los pedidos se quedan en `pending_payment` para siempre.
- **Sin `MERCADOPAGO_WEBHOOK_SECRET` los avisos no se verifican.** En
  producción el arranque lo grita en el log. Un webhook sin firma es un botón
  público para marcar pedidos como pagos.
- **Empezar con credenciales TEST.** El arranque avisa si el token no empieza
  con `TEST-` fuera de producción. Cobrarle de verdad a alguien que estaba
  probando no se deshace con un redeploy.

Si falta alguna de las tres primeras, la API **no arranca**. Es preferible a
descubrirlo cuando alguien toca "Pagar".

### Cada vendedor conecta su cuenta

VivoShop **no** recibe el dinero de las ventas. El modelo es marketplace: cada
tienda conecta su propia cuenta desde `/vender/cobros`, el dinero entra ahí y
la comisión de VivoShop se retiene en el mismo movimiento. Configurar las
variables de arriba habilita el flujo; no conecta ninguna tienda.

---

## Resumen de variables

| Variable | Vercel | Railway | Secreta |
| --- | :---: | :---: | :---: |
| `NEXT_PUBLIC_API_URL` | ✅ | | no |
| `INTERNAL_API_URL` | ✅ | | no |
| `NEXT_PUBLIC_APP_NAME` | ✅ | | no |
| `NEXT_PUBLIC_DEFAULT_COUNTRY` | ✅ | | no |
| `NODE_ENV=production` | | ✅ | no |
| `DATA_DRIVER=postgres` | | ✅ | no |
| `DATABASE_URL` | | ✅ | **sí** |
| `DATABASE_SSL` / `DATABASE_CA_CERT` | | ✅ | no |
| `JWT_SECRET` | | ✅ | **sí** |
| `WEB_ORIGIN` | | ✅ | no |
| `STREAMING_PROVIDER` | | ✅ | no |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` | | ✅ | no |
| `LIVEKIT_API_SECRET` | | ✅ | **sí** |
| `PAYMENT_PROVIDER` | | ✅ | no |
| `MERCADOPAGO_CLIENT_ID` | | ✅ | no |
| `MERCADOPAGO_CLIENT_SECRET` | | ✅ | **sí** |
| `MERCADOPAGO_ACCESS_TOKEN` | | ✅ | **sí** |
| `MERCADOPAGO_WEBHOOK_SECRET` | | ✅ | **sí** |
| `API_PUBLIC_URL` | | ✅ | no |
| `WEB_PUBLIC_URL` | | ✅ | no |
| `STORAGE_PROVIDER=supabase` | | ✅ | no |
| `SUPABASE_URL` / `SUPABASE_STORAGE_BUCKET` | | ✅ | no |
| `SUPABASE_SERVICE_KEY` | | ✅ | **sí** |
| `OAUTH_PROVIDERS=google` | | ✅ | no |
| `GOOGLE_CLIENT_ID` | | ✅ | no |
| `GOOGLE_CLIENT_SECRET` | | ✅ | **sí** |
| `EMAIL_PROVIDER=resend` / `EMAIL_FROM` | | ✅ | no |
| `RESEND_API_KEY` | | ✅ | **sí** |
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | | ✅ | no |
| `VAPID_PRIVATE_KEY` | | ✅ | **sí** |

---

## Estado de verificación

| Qué | Estado |
| --- | --- |
| Arranque en modo producción con `PORT` inyectado | **VERIFICADO** — `PORT=4400`, `/health` respondió |
| La API se niega a arrancar con el `JWT_SECRET` de desarrollo | **VERIFICADO** |
| `WEB_ORIGIN` aplicado como allowlist de CORS | **VERIFICADO** |
| Build del Dockerfile | **VERIFICADO** — construido y desplegado por Railway |
| Conexión real a Supabase | **VERIFICADO** — migraciones, seed y `db:smoke` 10/10 contra PostgreSQL 17.6 |
| TLS verificado con la CA de Supabase | **VERIFICADO** — sin la CA la conexión se rechaza, que es lo correcto |
| Deploy real en Railway | **VERIFICADO** — `/health` en 200, CORS correcto, registro real contra Supabase |
| Deploy real en Vercel | **VERIFICADO** — vivoshop-web.vercel.app, 13 rutas barridas |
| Migraciones aplicadas en el deploy | **VERIFICADO** — el `preDeployCommand` aplicó `0006_m04_bid_mode` solo. La prueba es que `/bids` consulta `bid_sessions` y devuelve 200: sin la migración daría 500. En Supabase quedan 7 migraciones registradas. |
| Modo Puja en producción | **PARCIAL** — esquema, versión desplegada (`/health` devuelve el commit) y rutas verificados. Una puja real de punta a punta **NO** se ejecutó: exige poner la tienda al aire, y eso es tuyo. |
| Cobros con Mercado Pago en producción | **ACTIVO Y REAL** — `/payments/capabilities` devuelve `provider: mercadopago`, `level: refund_only`, y los logos del arranque dicen `Modo productivo: los cobros son reales`. En M04.1 se ejecutó un cobro real de $1.490 y su devolución parcial de $490. Esta fila decía `fake` y estaba desactualizada: corregida el 2 de septiembre de 2026. Ver `docs/m03.md` §17 y `docs/m04-1.md`. |
| Migraciones `0009`, `0010` y `0011` | **VERIFICADO** — `Migraciones aplicadas.` en los logs del despliegue `f48eafc`, antes del arranque. `0010` además se ejercitó: `/auth/google/start` escribe en `login_states` y devolvió 302. |
| Ingreso con Google en producción | **VERIFICADO** — el viaje completo con una cuenta real de Google funcionó el 2/9/2026. Cubre el canje del código, que es el único paso que usa el `GOOGLE_CLIENT_SECRET`. El secreto viejo quedó inhabilitado después de confirmarlo. |
| Recuperación de contraseña en producción | **PARCIAL** — `/auth/password/status` devuelve `canRecover: true` y las dos pantallas responden 200. No se pidió un enlace real. |
| Almacenamiento en Supabase | **VERIFICADO** — una foto de perfil real quedó en `avatar/usr_…/….webp`, `image/webp`, 19.360 bytes, y se lee por su URL pública con 200. |
| `vivoshop.live` sirviendo la aplicación | **VERIFICADO** — 200 en `/`, `/ingresar`, `/crear-cuenta`, `/ingresar/olvide` y `/ingresar/restablecer`, contra datos reales de la base. |
| El guardia de `env.ts` en producción | **VERIFICADO por accidente** — el despliegue del mismo commit **sin** las variables nuevas murió en el `preDeployCommand`, que es exactamente lo prometido. |

Lo de arriba es honesto a propósito. Queda una sola fila **PARCIAL**, la de
contraseñas, y lo es por la razón de siempre: pedir un enlace real manda un
correo a una casilla real, y esa es una acción del dueño de la casilla.

---

## El dominio propio: vivoshop.live

Comprado en Namecheap. Sirve dos cosas distintas y conviene no confundirlas:
**la web** y **el correo**.

### La web, en Vercel

| Registro | Host | Valor |
| --- | --- | --- |
| A | `@` | `216.198.79.1` |
| CNAME | `www` | `5f9ee9361a02acb8.vercel-dns-017.com.` |

En el proyecto `vivoshop-web`: `vivoshop.live` apunta a Production, y
`www.vivoshop.live` **redirige** (307) al dominio sin `www`.

Se eligió el apex como canónico y no `www`. Vercel recomienda lo contrario por
razones técnicas de CDN, pero para un producto de consumo la dirección corta es
la que la gente escribe y comparte, y el redirect cubre a quien escriba `www`.

### El correo, en Resend

| Registro | Host | Valor |
| --- | --- | --- |
| TXT | `resend._domainkey` | la clave pública DKIM |
| CNAME | `rsend` | `rsend-sae1.forge.rmta.net.` |
| CNAME | `send` | `send.forge.rmta.net.` |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

Dominio raíz y no un subdominio de envío: el remitente queda
`hola@vivoshop.live`, y en un correo de recuperación de contraseña —el momento
en que alguien mira de quién viene— la dirección limpia vale más que el
aislamiento de reputación que daría `mail.vivoshop.live`.

DMARC arranca en `p=none`, que monitorea sin rechazar. Endurecerlo antes de
saber que todo lo que sale del dominio está firmado es como uno se tira sus
propios correos a spam.

### La API, apuntada al dominio nuevo

**Hecho.** En Railway:

- `WEB_ORIGIN=https://vivoshop.live,https://vivoshop-web.vercel.app`. El orden
  no es cosmético: el código toma `corsOrigins[0]` como base para armar las URLs
  de vuelta, así que el apex va **primero** y el dominio de Vercel queda como
  respaldo.
- `WEB_PUBLIC_URL=https://vivoshop.live`, que es de dónde sale el enlace del
  correo de recuperación. Nunca del encabezado `Host`: si saliera de ahí,
  cualquiera podría pedir un restablecimiento y hacer que el enlace apunte a su
  propio dominio.

Y si algún día la API se muda a `api.vivoshop.live`, hay que actualizar además
la URI de redirección en la consola de Google y `API_PUBLIC_URL`. Hoy la API
sigue en `vivoshop-production.up.railway.app`.
