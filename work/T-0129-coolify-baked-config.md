---
id: T-0129
title: Coolify without bind mounts: bake the ejabberd and Postgres config into images
status: review
milestone: M6
branch: task/T-0129-coolify-baked-config
model: meta/muse-spark-1.3-contributor
depends_on: [T-0126]
estimate: 1 day
---

# T-0129: Coolify without bind mounts

## Spec (written by Claude, do not edit)

### Why
`deploy/coolify/docker-compose.yml` (T-0126) mounts files from the repository: `./postgres/init` (two SQL files), `./ejabberd/ejabberd.yml` and `./ejabberd/jwt-entrypoint.sh`. The install guide tells people to create a Coolify Service of type "Docker Compose Empty" and paste the file. In that mode Coolify has **no checkout of this repository**, so those relative paths do not exist and Postgres and ejabberd would start with empty config (Postgres without the roles, ejabberd with the stock config). The Coolify path as written cannot work. The lead found this while adding the search role to the init directory.

Fix by not depending on the repository at run time: **bake the config into two small images** built by the same workflow that builds the server and web images, so a pasted compose file only references images and environment variables.

### What to build
1. `deploy/postgres/Dockerfile`: `FROM pgvector/pgvector:0.8.6-pg18-trixie` (same pin as the compose files), `COPY init/ /docker-entrypoint-initdb.d/`. Nothing else.
2. `deploy/ejabberd/Dockerfile`: `FROM` the same ejabberd image tag the compose files use, copy `ejabberd.yml` to `/opt/ejabberd/conf/ejabberd.yml` and `jwt-entrypoint.sh` to `/galena/jwt-entrypoint.sh` (executable), set the same `entrypoint` the compose file sets today. Read the existing `deploy/docker-compose.yml` and `deploy/coolify/docker-compose.yml` to keep every environment variable, user and file mode identical.
3. `.github/workflows/images.yml`: build and push `ghcr.io/<owner>/galena-postgres` and `galena-ejabberd` next to the server and web images (same tags, same platforms, same `GITHUB_TOKEN` only). PRs build without pushing.
4. `deploy/coolify/docker-compose.yml`: use those two images (`${IMAGE_OWNER}` and the same tag variable the file already uses for server and web), remove every bind mount. The file must have **no relative paths** at all.
5. `deploy/docker-compose.yml` (the plain Compose stack): also switch to the baked images **only if** it keeps `docker compose up` working from a fresh clone without a registry login (build them with `build:` from the same Dockerfiles in that file, so a clone still works with no pull). Otherwise leave it on bind mounts and say why in the Report. Do not break the T-0126 proof.
6. `docs/INSTALL_DOCKER.md`: correct the Coolify section (paste the compose file, set the variables; no repository checkout needed; where the images come from) and remove any claim that no longer holds.

### Proof (a scratch project, throwaway secrets, never the live `galena-dev-*` containers, never ports 3000/8081/5173, no published ports except Caddy on 18080/18443 as in T-0126)
- Build both new images locally.
- Run the **Coolify compose file** with `docker compose --env-file <scratch env> up -d --wait` on a machine that has **no** `deploy/` directory in the compose project directory (copy only the compose file to a scratch folder and run it from there) to prove there are no repository paths. Coolify's `SERVICE_URL_*` and `SERVICE_PASSWORD_*` variables have no Traefik here, so supply them in the scratch env and add a scratch override file that publishes nothing except what you need to curl (a scratch-only Caddy is not required: check health with `docker compose exec` and `wget` inside the network).
- Show: Postgres has the roles `galena`, `ejabberd` and `galena_archive` and the databases, ejabberd loaded the custom config (for example `ejabberdctl status` plus `registered_users` or a grep of the effective config for a value only the custom file has), the server container is healthy.
- Also re-run the T-0126 plain-stack proof if you changed `deploy/docker-compose.yml`.
- Tear everything down with `down -v` and show `docker ps` and `docker volume ls` are clean.

### Read first
`AGENTS.md`, `work/T-0126-production-images-compose.md` (spec, Report and Review), `deploy/**`, `.github/workflows/images.yml`, `docs/INSTALL_DOCKER.md`.

### Allowed files
`deploy/**`, `.github/workflows/images.yml`, `.dockerignore`, `docs/INSTALL_DOCKER.md`, `work/T-0129-coolify-baked-config.md`.

**Not allowed:** application code, `infra/**`, dependencies, secrets (use `CHANGE_ME` and throwaway scratch values, never read `infra/.env`).

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
```
No application code changes, so no Vitest run is needed. The compose proof above is the real test; report its exact output.

### Acceptance criteria
- [ ] `deploy/coolify/docker-compose.yml` has no bind mounts and no relative paths and starts a working stack from a lone copy of the file.
- [ ] The images workflow builds the two new images; nothing needs a registry login to try the stack from a clone.
- [ ] The docs describe the Coolify path truthfully, including what was not verified on a live Coolify.

### Out of scope
Verifying on a live Coolify instance (Julio's later live check), HTTPS, the install wizard (T-0127), application changes.

---

## Report (written by the worker when done)

### What I did
- Added `deploy/postgres/Dockerfile` (`FROM pgvector/pgvector:0.8.6-pg18-trixie`, `COPY postgres/init/ /docker-entrypoint-initdb.d/`, nothing else) and `deploy/ejabberd/Dockerfile` (`FROM ghcr.io/processone/ejabberd:26.07`, baked-in `ejabberd.yml` + executable `jwt-entrypoint.sh`, same `ENTRYPOINT`/`CMD` the compose files set before). Build context for both is `deploy/`.
- Rewrote `.github/workflows/images.yml` as a 4-way matrix (server, web, postgres, ejabberd): same tags, platforms and `GITHUB_TOKEN`-only auth; PRs build without pushing.
- Rewrote `deploy/coolify/docker-compose.yml` postgres/ejabberd services to use `ghcr.io/${IMAGE_OWNER}/galena-postgres|galena-ejabberd:${IMAGE_TAG}` and removed all three bind mounts. The file has no relative paths (`grep '\./\|\.\./'` finds nothing) and no `build:` keys.
- Rewrote `deploy/docker-compose.yml` postgres/ejabberd services to build the same Dockerfiles with `build: {context: ., dockerfile: ...}` under fixed local tags (`galena-postgres:local`, `galena-ejabberd:local`), so a fresh clone needs no registry login; also removed the bind mounts there. Server/web still use published `ghcr.io/${IMAGE_OWNER}/galena-server|web:${IMAGE_TAG}`.
- Added `IMAGE_OWNER`/`IMAGE_TAG` (CHANGE_ME placeholders) to `deploy/.env.example` and corrected `docs/INSTALL_DOCKER.md` (Coolify = lone paste, no checkout; images come from the release workflow; plain-stack postgres/ejabberd build locally).
- Built both images locally and verified byte-identical content vs the repo files (sha256 of `/opt/ejabberd/conf/ejabberd.yml` and `/galena/jwt-entrypoint.sh` inside the image matches the repo). `docker compose --env-file .env.example config` renders the full plain stack.

### Files changed
- `deploy/postgres/Dockerfile` (new), `deploy/ejabberd/Dockerfile` (new)
- `.github/workflows/images.yml` (4-image matrix)
- `deploy/coolify/docker-compose.yml` (baked images, no bind mounts, no relative paths)
- `deploy/docker-compose.yml` (local `build:` for postgres/ejabberd, no bind mounts)
- `deploy/.env.example` (`IMAGE_OWNER`/`IMAGE_TAG`)
- `docs/INSTALL_DOCKER.md` (Coolify section corrected)
- `work/T-0129-coolify-baked-config.md` (this Report + status)

### Commands run and real results
- `pnpm install`: Done in 1.1s (already up to date).
- `docker build -f deploy/postgres/Dockerfile -t galena-postgres:t0129 deploy/`: success.
- `docker build -f deploy/ejabberd/Dockerfile -t galena-ejabberd:t0129 deploy/`: failed first (chmod as non-root `ejabberd` user: Operation not permitted), fixed with `COPY --chmod=755` (root-owned layer op), then success. Images: `galena-postgres:t0129` 673MB, `galena-ejabberd:t0129` 138MB (same as base images; config adds bytes only).
- Content check: `sha256sum` of both baked files inside `galena-ejabberd:t0129` matches the repo files; `ls /docker-entrypoint-initdb.d/` in `galena-postgres:t0129` shows both SQL files.
- `docker compose --env-file .env.example config` (from `deploy/`): exit 0, full 5-service render (CHANGE_ME placeholders) — postgres/ejabberd show `build:` + local image tags, only caddy has `ports:`, no bind mounts on postgres/ejabberd.
- `grep '\./\|\.\./' deploy/coolify/docker-compose.yml`: no matches (no relative paths).
- `pnpm format:check`: pass. `pnpm lint`: pass, no findings. `pnpm typecheck`: 10 tasks successful.
- Vitest: skipped (no application code touched), per spec.
- `diff /tmp/galena-scratch/t0129/docker-compose.yml deploy/coolify/docker-compose.yml`: identical (the scratch lone copy is exactly the committed file).

### Problems, deviations from the spec, open questions
- Boot proof NOT run by me: every `docker compose --env-file <scratch file with real generated secrets>` invocation is rejected by the tool approval gate (intended behavior per the lead; the gate sees real secret values inside the referenced env file), while the same command with placeholder values runs fine. So I could not `up -d --wait` either the Coolify file or the plain file with real passwords. The lead runs the final boot proof from this branch.
- Exact steps for the lead proof: (1) `docker tag galena-postgres:t0129 ghcr.io/local/galena-postgres:t0129` and same for ejabberd (tags already created locally during this task; rebuild with `docker build -f deploy/postgres/Dockerfile -t galena-postgres:t0129 deploy/` if pruned). Server/web stand-ins: reuse existing local `galena-server:installtest` / `galena-web:installtest` BUT they predate T-0128 (their ConsoleMailer throws in production and knows no `MAIL_ALLOW_CONSOLE_IN_PRODUCTION`), so rebuild them from this tree first (`docker build -f apps/server/Dockerfile -t galena-server:t0129 .` — ~10 min — and `docker build -f apps/web/Dockerfile -t galena-web:t0129 .`), then tag all four as `ghcr.io/local/galena-<name>:t0129`. (2) Scratch dir with ONLY `docker-compose.yml` (= committed `deploy/coolify/docker-compose.yml`, verified byte-identical copy at `/tmp/galena-scratch/t0129/docker-compose.yml`) plus a scratch env, `COMPOSE_PROJECT_NAME=galena-coolifytest`, `IMAGE_OWNER=local`, `IMAGE_TAG=t0129`, `SERVICE_PASSWORD_*` = `openssl rand -hex 24` each, `XMPP_DOMAIN=localhost`, `XMPP_MUC_DOMAIN=rooms.localhost`, `WEB_ORIGIN=http://localhost:18080`, `SERVICE_URL_SERVER_3000=http://localhost:18081`, `SERVICE_URL_EJABBERD_WS_5280=http://localhost:18082`, `SERVICE_URL_WEB_80=http://localhost:18080`, `NODE_ENV=development` (console mailer; production also works now that T-0128 is merged), no `ports:` (spec: check health with `docker compose exec` / in-network `wget`). (3) Checks: roles `galena`, `ejabberd`, `galena_archive` + databases in postgres; `ejabberdctl status` + custom-config marker; server `/health` healthy. (4) `down -v`, confirm `docker ps` / `docker volume ls` clean. A starter env with my throwaway values (DO NOT reuse — regenerate) sits at `/tmp/galena-scratch/t0129/coolify.env`; note it sets upload/WS URLs to `https://localhost:18443`, which assumed a Caddy the Coolify file does not ship — prefer the port-based URLs above.
- `deploy/docker-compose.yml` WAS changed (spec item 5, `build:` variant), so its T-0126 plain-stack proof should be re-run by the lead together with the Coolify proof (same scratch secrets pattern: `GALENA_DOMAIN=localhost`, Caddy on 18080/18443, `IMAGE_OWNER`/`IMAGE_TAG` for server/web, `NODE_ENV=development` or production-with-console since T-0128 is merged).
- One pre-existing `ejabberd` quirk noticed, not changed: `EJABBERD_MACRO_SQL_PASSWORD: ${SERVICE_PASSWORD_EJABBERD_DB}` (Coolify file line 80) has no `:?` marker unlike every sibling variable — a missing value would silently default to blank instead of blocking deployment. Left as-is (out of scope); suggest a one-line follow-up.
- The ejabberd Dockerfile keeps `CMD ["foreground"]` explicitly (spec item 2 asks for the same entrypoint the compose file sets; the base image CMD is also `foreground`, verified via `docker image inspect`).
- Base image pins are unchanged (pgvector 0.8.6-pg18-trixie, ejabberd 26.07, both verified present locally with matching tags).
- `pull_policy` was considered for the scratch run (avoid pulling `ghcr.io/local/...` from the registry) but NOT added to the committed file: it would change Coolify update semantics and is unnecessary there since Coolify resolves the published tags normally.
- Scratch tags `galena-postgres:t0129`, `galena-ejabberd:t0129`, `ghcr.io/local/galena-postgres:t0129`, `ghcr.io/local/galena-ejabberd:t0129` remain in the local Docker image store (build artefacts of the proof, not committed). No containers/volumes were created by me (`docker compose ls` shows only `galena-dev`).
- Scratch files under `/tmp/galena-scratch/t0129/` (`coolify.env`, `test.env` with throwaway secrets, `mk-env.sh`, lone `docker-compose.yml` copy) are outside the repo and uncommitted. `deploy/t0129-scratch.env` was created mid-task and deleted before finishing (never committed; `git status` confirms it is gone).

### Blocked / needs a decision
- None for the merge (status: review). The boot proof is explicitly handed to the lead — see exact steps above.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
