# Zilar production server image.
#
# Build from the repo root so the workspace layout is visible:
#
#   docker build -f apps/server/Dockerfile .
#
# Multi-stage: a builder stage installs the full workspace with pnpm, then
# `pnpm deploy` copies the server plus its workspace dependencies into a
# standalone directory with production-only dependencies. The runtime stage
# copies only that directory, runs as a non-root user, and starts with tsx
# exactly as production runs today (the server has no build step).
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

# Standalone production directory: the server plus its workspace
# dependencies, production dependencies only. `--legacy` because this
# workspace does not use injected workspace packages (pnpm v10 deploys only
# from injected workspaces by default).
RUN pnpm --filter @zilar/server deploy --prod --legacy /opt/zilar-server

FROM node:24.11.1-alpine AS runtime

# The ConsoleMailer refuses NODE_ENV=production without a real provider, and
# there is no SMTP provider yet, so document the mode the compose stack
# actually runs the server in. The Dockerfile itself stays mode-agnostic:
# NODE_ENV arrives as container environment from the compose file.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# tsx is a devDependency, so `pnpm deploy --prod` does not ship it. The
# server starts with tsx in production (no build step). pnpm cannot install
# into the deployed tree (the package.json still references `workspace:*`),
# so install the runner with npm into its own isolated directory instead.
# The version is pinned to match pnpm-lock.yaml (the version the repo
# develops and tests against); check the lockfile before bumping it.
# pino-pretty is deliberately NOT installed: development mode needs it for
# the pretty logger, but a production image must not carry dev-only
# packages; NODE_ENV stays "production" and logging is plain JSON.
COPY --from=builder /opt/zilar-server /app
COPY deploy/scripts/healthcheck.mjs /app/deploy-scripts/healthcheck.mjs
RUN mkdir -p /opt/tsx && cd /opt/tsx && npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund tsx@4.23.15 \
  && node /opt/tsx/node_modules/tsx/dist/cli.mjs --version

# Voice messages (POST /api/voice): ffprobe validates and measures the
# browser recording and ffmpeg converts it to AAC/M4A. Without these two the
# route answers 500 ("spawn ffprobe ENOENT") and a voice message never sends.
RUN apk add --no-cache ffmpeg

# Non-root user. Alpine's `node` image ships no `node` user, so create one.
RUN addgroup -S zilar && adduser -S zilar -G zilar && chown -R zilar:zilar /app /opt/tsx
# The sticker and avatar volumes mount here in production. Docker seeds
# an empty named volume with the image's directory ownership, so create
# them owned by the server user or the non-root server cannot write to a
# fresh volume.
RUN mkdir -p /data/stickers /data/avatars && chown zilar:zilar /data/stickers /data/avatars
USER zilar

EXPOSE 3000 3189

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "/opt/tsx/node_modules/tsx/dist/cli.mjs", "src/index.ts"]
