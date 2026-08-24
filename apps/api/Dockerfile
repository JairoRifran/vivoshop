# syntax=docker/dockerfile:1
#
# Imagen de la API de Vivo.
#
# El build se hace desde la RAÍZ del monorepo, no desde esta carpeta: la API
# depende de @vivo/domain, @vivo/shared, @vivo/config y @vivo/seed por
# workspace, y pnpm necesita el lockfile completo para instalar de forma
# reproducible.
#
#   docker build -f apps/api/Dockerfile -t vivo-api .
#
# En Railway alcanza con apuntar el servicio a este Dockerfile; el contexto ya
# es la raíz del repositorio.
#
# ## Por qué el árbol viaja entero entre etapas
#
# pnpm arma `node_modules` con symlinks a un almacén en `node_modules/.pnpm`.
# Copiar carpetas sueltas entre etapas de Docker deja esos enlaces apuntando a
# la nada, y el fallo aparece recién al arrancar. Así que la etapa final copia
# `/app` completo. La imagen queda más grande de lo estrictamente necesario;
# a cambio, funciona. Adelgazarla es una optimización para cuando haya un
# entorno donde se pueda probar el build.

# --- Etapa 1: build ----------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

# Solo los manifiestos primero: mientras no cambie una dependencia, esta capa
# se reutiliza y el build tarda segundos en vez de minutos.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json         apps/api/
COPY apps/web/package.json         apps/web/
COPY packages/config/package.json  packages/config/
COPY packages/domain/package.json  packages/domain/
COPY packages/seed/package.json    packages/seed/
COPY packages/shared/package.json  packages/shared/
COPY packages/ui/package.json      packages/ui/

RUN pnpm install --frozen-lockfile

COPY . .

# Turbo resuelve el orden: config y domain antes que shared, shared antes que
# la API. El `...` incluye las dependencias del filtro.
RUN pnpm turbo run build --filter=@vivo/api...

# --- Etapa 2: ejecución ------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Sin esto, cada pedido llega con la IP del balanceador y el rate limit trata a
# todo internet como un solo visitante.
ENV TRUST_PROXY=true

COPY --from=build --chown=node:node /app /app

USER node
WORKDIR /app/apps/api

# El host inyecta PORT; `env.ts` lo lee y lo usa como API_PORT.
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
