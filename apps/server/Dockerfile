# Zilar production server image.
#
# Build from the repo root so the workspace layout is visible:
#
#   docker build -f apps/server/Dockerfile .
#
# Multi-stage: a builder stage installs the full workspace with pnpm, bundles
# the server with esbuild (`apps/server/build.mjs`: workspace TypeScript packages
# inside the bundle, npm dependencies outside) and runs `pnpm deploy` for a
# standalone production node_modules. The runtime stage copies the bundle, the
# migrations and that node_modules, runs as a non-root user and starts with plain
# node (no tsx, no pnpm at run time).
# Migrations run at startup (apps/server/src/index.ts); nothing here changes that.

FROM node:24.11.1-alpine AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /repo

# Dependency manifests first so this layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json apps/server/
COPY packages/protocol/package.json packages/protocol/
COPY packages/xmpp-core/package.json packages/xmpp-core/
COPY packages/runner-tunnel/package.json packages/runner-tunnel/

RUN pnpm install --frozen-lockfile

# Now the sources the server imports (keep this list in sync with what
# apps/server imports from the workspace: @zilar/protocol,
# @zilar/runner-tunnel, @zilar/xmpp-core).
COPY apps/server apps/server
COPY packages/protocol packages/protocol
COPY packages/xmpp-core packages/xmpp-core
COPY packages/runner-tunnel packages/runner-tunnel

# dist/index.mjs (the server) and dist/tool-worker.mjs (the sandbox worker).
RUN pnpm --filter @zilar/server build

# Standalone production directory: the server's production dependencies.
# `--legacy` because this workspace does not use injected workspace packages
# (pnpm v10 deploys only from injected workspaces by default).
RUN pnpm --filter @zilar/server deploy --prod --legacy /opt/zilar-server

FROM node:24.11.1-alpine AS runtime

# The commit this image was built from. CI passes it as a build arg and
# /health reports it, so a deploy can prove which build is live.
ARG ZILAR_COMMIT=unknown
ENV ZILAR_COMMIT=$ZILAR_COMMIT

# Voice messages (POST /api/voice): ffprobe validates and measures the
# browser recording and ffmpeg converts it to AAC/M4A. Without these two the
# route answers 500 ("spawn ffprobe ENOENT") and a voice message never sends.
# This layer comes before the app files so a code change does not rebuild it.
RUN apk add --no-cache ffmpeg

# Non-root user. Alpine's `node` image ships no `node` user, so create one.
# The sticker and avatar volumes mount here in production. Docker seeds
# an empty named volume with the image's directory ownership, so create
# them owned by the server user or the non-root server cannot write to a
# fresh volume.
RUN addgroup -S zilar && adduser -S zilar -G zilar \
  && mkdir -p /app /data/stickers /data/avatars \
  && chown zilar:zilar /app /data/stickers /data/avatars

# NODE_ENV arrives as container environment from the compose file. pino-pretty
# is a devDependency and is not installed: production logs plain JSON.
WORKDIR /app
COPY --chown=zilar:zilar --from=builder /opt/zilar-server/node_modules /app/node_modules
COPY --chown=zilar:zilar --from=builder /opt/zilar-server/package.json /app/package.json
COPY --chown=zilar:zilar --from=builder /opt/zilar-server/drizzle /app/drizzle
COPY --chown=zilar:zilar --from=builder /repo/apps/server/dist /app/dist
COPY --chown=zilar:zilar deploy/scripts/healthcheck.mjs /app/deploy-scripts/healthcheck.mjs
USER zilar

EXPOSE 3000 3189

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
