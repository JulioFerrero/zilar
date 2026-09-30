# Galena production web app image.
#
# Build from the repo root so the workspace layout is visible:
#
#   docker build -f apps/web/Dockerfile .
#
# Multi-stage: a builder stage compiles the Vite app, then a small Caddy
# stage serves the static files with SPA fallback, caching and security
# headers (see the Caddyfile in this directory).

FROM node:24.11.1-alpine AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /repo

# Dependency manifests first so this layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
COPY packages/xmpp-core/package.json packages/xmpp-core/
COPY packages/chat-core/package.json packages/chat-core/

RUN pnpm install --frozen-lockfile

# Now the sources the web app imports (keep this list in sync with what
# apps/web imports from the workspace: @galena/chat-core,
# @galena/protocol, @galena/xmpp-core).
COPY apps/web apps/web
COPY packages/protocol packages/protocol
COPY packages/xmpp-core packages/xmpp-core
COPY packages/chat-core packages/chat-core

RUN pnpm --filter @galena/web build

FROM caddy:2.10.2-alpine AS runtime

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/apps/web/dist /srv/galena-web

# Caddy serves on 80/443; the production compose wires the actual site
# through Caddy's reverse proxy with automatic HTTPS.
EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
