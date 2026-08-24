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
3. **Project Settings → Database → Connection string → URI.**

   Hay dos cadenas y la diferencia importa:

   | Cadena | Puerto | Cuándo |
   | --- | --- | --- |
   | **Direct connection** | 5432 | **Esta.** La API es un proceso largo con un pool propio. |
   | Transaction pooler | 6543 | Para serverless. Innecesario acá, y limita transacciones. |

4. La variable queda así:

   ```
   DATABASE_URL=postgresql://postgres:LA_PASSWORD@db.<ref>.supabase.co:5432/postgres
   DATA_DRIVER=postgres
   ```

### TLS

`node-postgres` **no** activa TLS solo porque la URL diga `sslmode=require`, así
que la decisión se toma en el código (`DATABASE_SSL`). Con `auto` — el valor por
defecto — cualquier host que no sea localhost usa TLS verificado.

Si al conectar aparece `self signed certificate in certificate chain`, es que
Supabase está presentando su propia CA. Dos salidas, en orden de preferencia:

1. **Bajar el certificado** (Project Settings → Database → SSL Configuration) y
   pegar el PEM en `DATABASE_CA_CERT`. Cifra **y** verifica quién está del otro
   lado.
2. `DATABASE_SSL=no-verify`. Cifra pero no verifica: queda abierta la puerta a
   un intermediario activo. Sirve para salir del paso, no para quedarse.

### Migrar y sembrar

Desde tu máquina, apuntando a Supabase:

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' pnpm db:migrate
```

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' pnpm db:seed
```

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
   DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
   DATABASE_SSL=auto
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
| Conexión real a Supabase | **NO VERIFICADO** — no hay proyecto todavía |
| Deploy real en Railway | **NO VERIFICADO** |
| Deploy real en Vercel | **NO VERIFICADO** |

Lo de arriba es honesto a propósito: la configuración está escrita y razonada,
pero solo tres de esas filas se ejecutaron. Las otras se confirman en el primer
despliegue.
