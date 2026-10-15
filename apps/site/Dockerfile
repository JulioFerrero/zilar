# Zilar landing page image (apps/site): a static Vite build served by Caddy.
#
# Build from the repo root so the workspace layout is visible:
#
#   docker build -f apps/site/Dockerfile .

FROM node:24.11.1-alpine AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /repo

# Dependency manifests first so this layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/site/package.json apps/site/

RUN pnpm install --frozen-lockfile --filter @zilar/site...

COPY apps/site apps/site

RUN pnpm --filter @zilar/site build

FROM caddy:2.10.2-alpine AS runtime

COPY apps/site/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/apps/site/dist /srv/zilar-site

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1
