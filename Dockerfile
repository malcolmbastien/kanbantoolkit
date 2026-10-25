# Flowline, as a container.
#
# Two stages, because the build needs the whole repository and the runtime needs almost none of it:
# the first compiles the client and the site, the second carries the server, the migrations and the
# built files. Nothing in the runtime stage can see `.git`, the tests or the source maps.
#
#   docker build -t flowline .
#   docker run -p 8787:8787 -v flowline-data:/data flowline
#
# The database lives on the volume at /data, so replacing the container replaces the code and keeps
# the work. The image runs as an unprivileged user and ships no credentials.

# ---- build ---------------------------------------------------------------------------------------
FROM node:26-alpine AS build

WORKDIR /app

# Dependencies first, so a source change does not re-download the registry.
COPY package.json package-lock.json ./
RUN npm ci

# The repository, minus what .dockerignore keeps out.
COPY . .
RUN npm run build

# ---- runtime -------------------------------------------------------------------------------------
FROM node:26-alpine

# Every value an operator can set is documented in docs/configure.md. These three are the defaults
# the image would otherwise have to guess: where the build is, where the database is, and the port.
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/flowline.db \
    STATIC_DIR=/app/dist

WORKDIR /app

# Production dependencies only. `tsx` is one of them — the server in this image *is* TypeScript, so
# the thing that runs it at runtime cannot be a development dependency. That is why it sits beside
# `hono` and `ws` rather than in `devDependencies`, where a `--omit=dev` install would quietly
# produce an image that starts and cannot answer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# What the server reads: the built client and site, the API, the migrations, and the domain rules it
# imports. Nothing else from the repository is needed to answer a request.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/tsconfig.json ./tsconfig.json

# A fixed, unprivileged user with an explicit id, and a data directory it owns. The database is
# created here on first run by the migrations, so the volume needs no preparation.
RUN addgroup -g 10001 -S flowline \
 && adduser -u 10001 -S -G flowline -h /app flowline \
 && mkdir -p /data \
 && chown -R flowline:flowline /data /app

USER flowline

VOLUME ["/data"]
EXPOSE 8787

# Readiness, the same endpoint an operator would curl. A container that cannot reach its database is
# not healthy, and says so in its own log rather than accepting traffic and failing per request.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# `npm run server` is the same command a self-hoster runs outside a container: one entry, no
# container-only path, so an image and a unit cannot drift apart.
CMD ["npm", "run", "--silent", "server"]
