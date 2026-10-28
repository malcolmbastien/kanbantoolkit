# Kanban Toolkit, as a container.
#
# Two stages, because the build needs the whole repository and the runtime needs almost none of it:
# the first compiles the client and the site, the second carries the server, the migrations and the
# built files. Nothing in the runtime stage can see `.git`, the tests or the source maps.
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
RUN npm run build:app

# ---- runtime -------------------------------------------------------------------------------------
FROM node:26-alpine

# Every value an operator can set is documented in docs/configure.md. These three are the defaults
# the image would otherwise have to guess: where the build is, where the database is, and the port.
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/kanbantoolkit.db \
    STATIC_DIR=/app/dist

WORKDIR /app

# Production dependencies only. `tsx` is one of them — the server in this image *is* TypeScript, so
# the thing that runs it at runtime cannot be a development dependency. That is why it sits beside
# `hono` and `ws` rather than in `devDependencies`, where a `--omit=dev` install would quietly
# produce an image that starts and cannot answer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# What the server reads: the built client, the API, the migrations, and the domain rules it imports.
# Not the project's site pages, which are in the same build and belong to a different deployment.
COPY --from=build /app/dist/app ./dist/app
COPY --from=build /app/dist/assets ./dist/assets
COPY --from=build /app/dist/favicon.svg ./dist/favicon.svg
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/tsconfig.json ./tsconfig.json

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
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# `npm run server` is the same command a self-hoster runs outside a container: one entry, no
# container-only path, so an image and a unit cannot drift apart.
CMD ["npm", "run", "--silent", "server"]
