---
id: T-0129
title: Coolify without bind mounts: bake the ejabberd and Postgres config into images
status: planned
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
