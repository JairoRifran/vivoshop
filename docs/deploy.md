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

---

## Estado de verificación

| Qué | Estado |
| --- | --- |
| Arranque en modo producción con `PORT` inyectado | **VERIFICADO** — `PORT=4400`, `/health` respondió |
| La API se niega a arrancar con el `JWT_SECRET` de desarrollo | **VERIFICADO** |
| `WEB_ORIGIN` aplicado como allowlist de CORS | **VERIFICADO** |
| Build del Dockerfile | **NO VERIFICADO** — no hay Docker en la máquina donde se escribió |
| Conexión real a Supabase | **VERIFICADO** — migraciones, seed y `db:smoke` 10/10 contra PostgreSQL 17.6 |
| TLS verificado con la CA de Supabase | **VERIFICADO** — sin la CA la conexión se rechaza, que es lo correcto |
| Deploy real en Railway | **NO VERIFICADO** |
| Deploy real en Vercel | **VERIFICADO** — vivoshop-web.vercel.app, 13 rutas barridas |

Lo de arriba es honesto a propósito: la configuración está escrita y razonada,
pero solo tres de esas filas se ejecutaron. Las otras se confirman en el primer
despliegue.
