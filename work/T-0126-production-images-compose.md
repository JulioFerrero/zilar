---
id: T-0126
title: Production images and a production Docker Compose stack (Galena, ejabberd, Postgres, Caddy) plus a Coolify-ready compose file
status: planned
milestone: M6
branch: task/T-0126-production-images-compose
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 3 days
---

# T-0126: Production images and compose

## Spec (written by Claude, do not edit)

### Why
D30 (Julio, 2026-09-30): anyone must be able to install their own Galena easily with Docker Compose or Coolify (bare metal is T-0127). Today only a **development** compose exists (`infra/docker-compose.dev.yml`: Postgres, ejabberd, LiteLLM on 127.0.0.1) and the server and web app run from source. This task builds what a real install needs: container images for the server and the web app, one production compose file, a reverse proxy with automatic HTTPS, and a Coolify variant.

### What to build (all new files under `deploy/`, plus two Dockerfiles)

1. **`apps/server/Dockerfile`** (multi-stage, from the repo root as build context): install with pnpm (`pnpm install --frozen-lockfile`, corepack), copy only what the server needs (workspace packages it imports), run as a **non-root user**, `NODE_ENV=production`, start with `tsx` exactly as production runs today (the server has no build step; do not add one), `HEALTHCHECK` on `GET /health`, `EXPOSE` the server port and the runner hub port. Image size sensible (prod dependencies only where pnpm allows: `pnpm deploy --prod` or an equivalent). Migrations already run at startup; do not change that.
2. **`apps/web/Dockerfile`**: build the Vite app (`pnpm --filter @galena/web build`), serve the static files from a small image (Caddy or nginx-unprivileged), SPA fallback to `index.html`, long cache for hashed assets, no cache for `index.html`, security headers (CSP suited to the app (read what the app loads: same-origin API, the XMPP WebSocket, images/uploads), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`).
3. **`.dockerignore`** at the repo root (node_modules, .git, work/, docs/, dist, `.env*`, `infra/.env`, worktrees, coverage). **Secrets must never be baked into an image.**
4. **`deploy/docker-compose.yml`** (production): services `postgres` (the same pgvector image and the init scripts as dev, data volume), `ejabberd` (pinned image as in dev, config mounted from `deploy/ejabberd/`, JWT entrypoint as in dev if the server needs it, volumes for database and uploads), `server`, `web`, and `caddy` (the only service publishing ports: 80 and 443, plus the XMPP client port only if the design needs it: prefer XMPP over WebSocket through Caddy so only 80/443 are open). Caddy routes: `/` → web, `/api/*` → server, the XMPP WebSocket path → ejabberd, the uploads path (XEP-0363) → ejabberd. Automatic HTTPS from `GALENA_DOMAIN` and `ACME_EMAIL`; `GALENA_DOMAIN=localhost` gives Caddy's local CA for trying it out. **Read `apps/server/src/config.ts`, `apps/server/src/xmpp/config.ts`, `apps/web` config and `infra/ejabberd/ejabberd.yml`** to get every required variable and URL right (public URLs, XMPP domain, MUC domain, upload URL, CORS/origin settings, the runner hub). Healthchecks and `depends_on: condition: service_healthy` everywhere; `restart: unless-stopped`; named volumes; a dedicated network; no service except Caddy publishes a port.
5. **`deploy/.env.example`** listing every variable with `CHANGE_ME` placeholders and one-line comments (domain, ACME email, Postgres passwords, ejabberd admin, JWT/HMAC secrets, Better Auth secret, optional LiteLLM/PUSH/TOOLS flags **default off**). Nothing in it is a real secret.
6. **`deploy/ejabberd/`**: the production ejabberd config derived from `infra/ejabberd/ejabberd.yml` (same modules and rules), hosts/domains from macros, TLS terminated by Caddy (ejabberd listens on the internal network only), `mod_mam` on Postgres, uploads enabled. Diff it against the dev file and list every difference in the Report.
7. **`deploy/coolify/docker-compose.yml`**: the same stack shaped for Coolify (Coolify supplies the proxy and HTTPS: no `caddy` service, services expose their internal ports, `SERVICE_FQDN_*` / `SERVICE_PASSWORD_*` magic variables where Coolify supports them: read Coolify's Docker Compose docs (use `mcp__coolify__search_docs` or the public docs) to get the syntax right, and state in the Report what you could not verify). Include the domain routing for `/`, `/api` and the XMPP WebSocket via Coolify labels or the documented mechanism.
8. **`.github/workflows/images.yml`**: builds both images on pull requests (no push) and on a version tag `v*` builds and pushes to `ghcr.io/<owner>/galena-server` and `galena-web` (multi-arch amd64 + arm64 with buildx). **Do not run or trigger it**, and it needs no secrets other than the built-in `GITHUB_TOKEN`.
9. **`docs/INSTALL_DOCKER.md`**: five-minute path (copy `.env.example`, fill it, `docker compose up -d`, create the first account), the Coolify path, updating (`docker compose pull && up -d`), what ports must be open, DNS records, troubleshooting (certificate not issued, WebSocket fails, ejabberd unhealthy). Honest about what was tested.

### Rules
- **No new dependencies** in the app packages. Base images pinned by tag and, where the dev compose already pins a digest, by digest.
- **Do not touch the live development stack.** Never run anything against containers named `galena-dev-*`, never use host ports 3000, 3188, 5173, 5222, 5280, 5432, 8081. To test, use `COMPOSE_PROJECT_NAME=galena-installtest`, a scratch directory `/tmp/galena-scratch/installtest`, `GALENA_DOMAIN=localhost` and Caddy on host ports 18080/18443 (make the published ports variables `HTTP_PORT`/`HTTPS_PORT` defaulting to 80/443). Tear it down (`docker compose ... down -v`) when done.
- Do not read `infra/.env`. Generate throwaway secrets for the test with `openssl rand` into the scratch directory only.
- The pure production defaults must be safe: `TOOLS_ENABLED`, `ROUTINES_ENABLED`, `PUSH_ENABLED`, `WEB_TOOLS_ENABLED` all false unless the file says otherwise; no debug endpoints; no ports except Caddy's.

### Read first
- `AGENTS.md`; `docs/PROJECT_PLAN.md` D15, D30 and the deployment sections; `infra/docker-compose.dev.yml`, `infra/ejabberd/**`, `infra/postgres/**`, `infra/.env.example`
- `apps/server/src/{config.ts,index.ts,xmpp/config.ts}`, `apps/web/{vite.config.ts,package.json,src/lib/*config*}`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`

### Allowed files
- `apps/server/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`, `deploy/**`, `.github/workflows/images.yml`, `docs/INSTALL_DOCKER.md`, `work/T-0126-production-images-compose.md`
- If a small change to the app is unavoidable (for example a missing environment variable for the public URL), stop and describe it in the Report under "Blocked / needs a decision" instead of editing application code.

**Not allowed:** application source, the dev compose, the live containers, dependencies, pushing images, secrets.

### Tests and checks
- `docker build -f apps/server/Dockerfile .` and `docker build -f apps/web/Dockerfile .` succeed; report the image sizes.
- `docker compose -f deploy/docker-compose.yml --env-file <scratch env> config` validates; `docker compose ... up -d --wait` in the scratch project brings every service to healthy; `curl -k https://localhost:18443/health` (through Caddy) answers; the web app loads over Caddy; the XMPP WebSocket upgrades through Caddy (test with a small `curl`/`node` WebSocket handshake); register a test user through the server API and log in. Report exactly what passed.
- `docker compose ... config` for the Coolify file validates (syntax only; say so).
- `pnpm format:check` and `pnpm lint` still pass (they must not choke on new files); `pnpm typecheck` unchanged.
- No full test suite needed (no application code changes); run `pnpm --filter @galena/server test --maxWorkers=2 src/config` only if you touched nothing else... (you must not touch app code, so skip it and say so).

### Acceptance criteria
- [ ] `docker compose up -d` from a fresh clone with a filled `.env` gives a working Galena behind HTTPS (proved on `localhost` with Caddy's local CA).
- [ ] Only Caddy publishes ports; containers run as non-root where the base image allows; no secret in any image layer or committed file.
- [ ] The Coolify file follows Coolify's documented conventions and is honest about what was not verified on a live Coolify.

### Out of scope
- The setup wizard, backup script and bare-metal guide (T-0127), Kubernetes/Helm, automatic updates, monitoring stack, the hosted service, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
