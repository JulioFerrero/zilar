---
id: T-1102
title: "Deploy: deploy/coolify/docker-compose.app.yml, the Coolify stack built from git (build: contexts instead of GHCR images) for a Coolify Docker Compose Application"
status: merged
milestone: M5
branch: task/T-1102-coolify-app-compose
model: auto
effort: default
depends_on: [T-1101]
estimate: 0.15 day
---

# T-1102: The Coolify stack built from git

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11:
- deploy Zilar the way movabase deploys: a Coolify **Application** linked to the GitHub App, which builds from git on every push;
- it is a clean install, so the old service and its data go.

**The movabase model:** movabase's apps are Coolify Applications (`build_pack` nixpacks, `source_type` GithubApp, `is_auto_deploy_enabled` true, with `watch_paths`).

**What the chat stack uses today:** `deploy/coolify/docker-compose.yml`, a Coolify **Service**. All four components pull prebuilt images (`image: ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-…:${IMAGE_TAG:-latest}`), and the restart API did not recreate the containers on 2026-10-11 (see `docs/deploy/coolify-app-plan.md`).

**What the Coolify docs say about the Docker Compose build pack for an Application:**
- it supports `build:`;
- the magic variables `SERVICE_PASSWORD_<ID>` and `SERVICE_URL_<SERVICE>_<PORT>` work as they do in a Service;
- the compose file is found at Base Directory plus Docker Compose Location;
- avoid `ports:`.

**What the Dockerfiles need,** as `.github/workflows/images.yml` builds them:
- `apps/server/Dockerfile` with context `.` (the repo root), and `ARG ZILAR_COMMIT=unknown` (`:53`), which `/health` reports;
- `apps/web/Dockerfile` with context `.`;
- `deploy/ejabberd/Dockerfile` with context `deploy`;
- `deploy/postgres/Dockerfile` with context `deploy`.

### What to build
1. **A new `deploy/coolify/docker-compose.app.yml`,** a copy of `deploy/coolify/docker-compose.yml` with only these changes:
   - **each of the four services** replaces its `image:` line with a `build:` block (`context` and `dockerfile`). Paths are relative to the compose file's folder, `deploy/coolify/`, so the repo root is `../..` and `deploy` is `..`;
   - **the server's `build:`** has `args: { ZILAR_COMMIT: ${SOURCE_COMMIT:-unknown} }`. Coolify provides `SOURCE_COMMIT` when "Include source commit in build" is on, and the lead turns that on;
   - **the header comment** says this file is for a Coolify **Application** (Docker Compose build pack, GitHub App source, Docker Compose Location `/deploy/coolify/docker-compose.app.yml`). It points at `docs/deploy/coolify-app-plan.md` and keeps the existing notes on the `SERVICE_*` conventions;
   - **everything else stays byte-identical:** environment, volumes, healthchecks, `depends_on`, `expose` and `SERVICE_URL_WEB_80`.
2. **Leave `deploy/coolify/docker-compose.yml` untouched.**
3. **Proof in the Report:**
   - the output of `docker compose -f deploy/coolify/docker-compose.app.yml config --no-interpolate > /dev/null && echo OK` (no daemon is needed);
   - `diff <(grep -v -E '^\s*(image:|build:|context:|dockerfile:|args:|ZILAR_COMMIT:|#)' deploy/coolify/docker-compose.yml) <(grep -v -E '^\s*(image:|build:|context:|dockerfile:|args:|ZILAR_COMMIT:|#)' deploy/coolify/docker-compose.app.yml)`, which must be empty.
4. **No tests.**

### Read first
`AGENTS.md`, `deploy/coolify/docker-compose.yml`, the four Dockerfiles named above, and `.github/workflows/images.yml:70-150`.

### Allowed files
`deploy/coolify/docker-compose.app.yml`, `work/T-1102-coolify-app-compose.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has both proofs from step 3.

---

## Report (written by the worker when done)

### What I did
Created `deploy/coolify/docker-compose.app.yml` as a copy of `deploy/coolify/docker-compose.yml` and changed only the header comment plus the four services' `image:` lines:

- `postgres`: `build: { context: .., dockerfile: postgres/Dockerfile }`
- `ejabberd`: `build: { context: .., dockerfile: ejabberd/Dockerfile }`
- `server`: `build: { context: ../.., dockerfile: apps/server/Dockerfile, args: { ZILAR_COMMIT: ${SOURCE_COMMIT:-unknown} } }`
- `web`: `build: { context: ../.., dockerfile: apps/web/Dockerfile }`

Paths are relative to the compose file's folder (`deploy/coolify/`), matching the contexts in `.github/workflows/images.yml` (repo root `.` for server/web, `deploy` for postgres/ejabberd). The header now describes a Coolify Application (Docker Compose build pack, GitHub App source, Docker Compose Location `/deploy/coolify/docker-compose.app.yml`), points at `docs/deploy/coolify-app-plan.md`, and keeps the existing `SERVICE_*` conventions. Environment, volumes, healthchecks, `depends_on`, `expose` and `SERVICE_URL_WEB_80` are unchanged; `deploy/coolify/docker-compose.yml` is untouched.

### Files changed
- `deploy/coolify/docker-compose.app.yml` (new)
- `work/T-1102-coolify-app-compose.md` (status + this Report)

### Commands and results
- `pnpm install` — done, no errors (only the pre-existing `@types/react-dom` peer warning in `apps/mobile`).
- Proof 1: `docker compose -f deploy/coolify/docker-compose.app.yml config --no-interpolate > /dev/null && echo OK` → `OK`
- Proof 2: `diff <(grep -v -E '^\s*(image:|build:|context:|dockerfile:|args:|ZILAR_COMMIT:|#)' deploy/coolify/docker-compose.yml) <(grep -v -E '^\s*(image:|build:|context:|dockerfile:|args:|ZILAR_COMMIT:|#)' deploy/coolify/docker-compose.app.yml)` → empty (`DIFF EMPTY`), i.e. every non-image/build/comment line is identical.
- `pnpm gate` (from repo root) summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.7s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No test files were run: this task touches a YAML file only and the spec says "No tests".

### Problems / deviations
None.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** a new `deploy/coolify/docker-compose.app.yml`, the Coolify stack with `build:` contexts:
  - postgres and ejabberd build from `..`, with `postgres/Dockerfile` and `ejabberd/Dockerfile`;
  - the server and web build from `../..`, with the server passing `ZILAR_COMMIT: ${SOURCE_COMMIT:-unknown}`.
  - The old `docker-compose.yml` is untouched.
- **The lead re-ran both proofs:** `docker compose config --no-interpolate` passes, and the diff of everything apart from the image and build lines is empty.
- **Check:** the gate passed.
