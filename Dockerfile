# Kanban Toolkit, as a container.
#
# Two stages, because the build needs the whole repository and the runtime needs almost none of it:
# the first compiles the client and bundles the server, the second carries the server bundle, the
# migrations and the built files. Nothing in the runtime stage can see `.git`, the tests, the
# TypeScript source or the source maps.
#
#   docker build -t kanbantoolkit .
#   docker run -p 8787:8787 -v kanbantoolkit-data:/data kanbantoolkit
#
# The database lives on the volume at /data, so replacing the container replaces the code and keeps
# the work. The image runs as an unprivileged user and ships no credentials.

# ---- build ---------------------------------------------------------------------------------------
FROM node:26-alpine AS build

WORKDIR /app

# Dependencies first, so a source change does not re-download the registry.
COPY package.json package-lock.json ./
RUN npm ci

# The repository, minus what .dockerignore keeps out. `build:app` compiles the client and nothing
# else: an instance is the application, and the project's website is a different build for a
# different origin (task 173).
COPY . .
RUN npm run build:app && npm run build:server

# ---- runtime -------------------------------------------------------------------------------------
#
# Base image survey (task 196, 2026-10-31): there is no minimal Node 26 image with a meaningful win.
# `gcr.io/distroless/nodejs` has 22 and 24, not 26 (24 is 204 MB but the wrong major). Chainguard's
# node:latest is 26.12.1 and 251 MB, about the same as this alpine base, and its image includes a
# shell. `node:26-slim` is 350 MB. Alpine keeps the runtime at Node 26 and a shell for debugging.
FROM node:26-alpine

# Every value an operator can set is documented in docs/configure.md. These three are the defaults
# the image would otherwise have to guess: where the build is, where the database is, and the port.
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/kanbantoolkit.db \
    STATIC_DIR=/app/dist

WORKDIR /app

# Production dependencies only. The server is bundled JavaScript now, so `tsx` and the build tools
# are development dependencies; what remains here is the three packages the bundle calls at runtime
# (`hono`, `@hono/node-server`, `ws`).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# What the server reads: the bundle, the built client, the migrations, and `package.json` for the
# version `/api/health` reports. The TypeScript source is not here at all.
COPY --from=build /app/dist/server.js ./dist/server.js
COPY --from=build /app/dist/app ./dist/app
COPY --from=build /app/dist/assets ./dist/assets
COPY --from=build /app/dist/favicon.svg ./dist/favicon.svg
COPY --from=build /app/migrations ./migrations

# A fixed, unprivileged user with an explicit id, and a data directory it owns. The database is
# created here on first run by the migrations, so the volume needs no preparation.
RUN addgroup -g 10001 -S kanbantoolkit \
 && adduser -u 10001 -S -G kanbantoolkit -h /app kanbantoolkit \
 && mkdir -p /data \
 && chown -R kanbantoolkit:kanbantoolkit /data /app

USER kanbantoolkit

VOLUME ["/data"]
EXPOSE 8787

# Readiness, the same endpoint an operator would curl. A container that cannot reach its database is
# not healthy, and says so in its own log rather than accepting traffic and failing per request.
# The probe is Node itself, so the image needs neither wget nor a shell to answer "is it healthy?".
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The same entry a self-hoster runs (`npm run server` points here): one bundle, no shell, no npm.
CMD ["node", "dist/server.js"]
