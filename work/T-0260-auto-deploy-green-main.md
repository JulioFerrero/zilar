---
id: T-0260
title: "Deploy: every green CI run on main publishes the images as latest and restarts the live Coolify service; /health reports the commit"
status: todo
milestone: M5
branch: task/T-0260-auto-deploy-green-main
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0260: auto-deploy on green main

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-06: chat.zilar.app should update itself after every push to `main` whose CI passes, instead of waiting for a hand-made tag. Live still runs v0.1.13 from 10-03.

### Verified facts (do not re-derive)
- **Images workflow:** `.github/workflows/images.yml` ("Production images"):
  - it runs on `pull_request` and on `push` of tags `v*` (lines 3-7);
  - it builds four images (zilar-server, zilar-web, zilar-postgres, zilar-ejabberd) for amd64 and arm64;
  - it pushes to GHCR only on a `v*` tag, with tags `:<tag>` and `:latest` (lines 46-78).
- **CI workflow:** `.github/workflows/ci.yml` is named `CI` and runs on `push` to `main` (lines 1-5).
- **The live stack** (`deploy/coolify/docker-compose.yml`, lines 36 and 58; the server and web images use the same pattern) pulls `ghcr.io/${IMAGE_OWNER:-julioferrero}/<image>:${IMAGE_TAG:-latest}`. Publishing `latest` and restarting the service with a pull therefore deploys.
- **Restart and pull:** `docs/RELEASING.md` §3 restarts the Coolify service with `pull_latest`. The Coolify API endpoint is "Restart service" (https://coolify.io/docs/api/endpoints/services/restart-service-by-uuid). It takes the service uuid and a `latest` flag to pull images, with a Bearer API token.
- **Health:** `/health` (`apps/server/src/app.ts` lines 550-560) returns `{ ok, name, version, protocolVersion, db }`. `version` comes from `apps/server/package.json` (today `0.1.0`), so it cannot prove which build is live. `docs/RELEASING.md` §4 explains that the old container answers while the new one starts.
- **Migrations** run at server start (`docs/RELEASING.md` §1.3). Backups are a nightly Coolify schedule (`deploy/coolify/scheduled-backup.md`).

### What to build
1. **The build commit in `/health`:**
   - `apps/server/Dockerfile` takes `ARG ZILAR_COMMIT=unknown` and sets `ENV ZILAR_COMMIT=$ZILAR_COMMIT` in the runtime stage;
   - `/health` adds `commit: process.env.ZILAR_COMMIT ?? 'unknown'` (read through the existing config pattern if there is one);
   - add a test in the existing app test for the field.
2. **`images.yml`:**
   - add a `workflow_run` trigger on workflow `CI`, type `completed`, branch `main`;
   - the build job runs for it only when `github.event.workflow_run.conclusion == 'success'`;
   - it checks out `github.event.workflow_run.head_sha` and pushes `:latest` plus `:sha-<12 chars>`, passing `ZILAR_COMMIT=<head_sha>` as a build arg to the server image;
   - tag builds keep working as today (they also pass `ZILAR_COMMIT`);
   - pull requests still build without pushing.
3. **A `deploy` job** in `images.yml`, after `build`, only for the `workflow_run` path:
   - it skips with a clear log line when any of the secrets `COOLIFY_URL`, `COOLIFY_TOKEN` or `COOLIFY_SERVICE_UUID` is missing;
   - otherwise it calls the Coolify restart endpoint with `latest=true` using `curl --fail`, and never prints the token;
   - it then polls `https://chat.zilar.app/health` (the URL comes from the secret or variable `ZILAR_PUBLIC_URL`) every 15 s for up to 10 min, until `commit` equals the head sha and `ok` is true, and fails the job otherwise;
   - use `concurrency: { group: deploy-live, cancel-in-progress: false }` so two merges never deploy at once, and a newer run waits.
4. **Backups:** check the Coolify API docs for a "backup now" call for a database inside a service. If one exists, call it before the restart when the commit range since the last deployed commit (read from `/health`) touches `apps/server/drizzle`, and wait for it to finish. If it does not exist, write that in the Report, and in `docs/RELEASING.md` say that auto-deploys rely on the nightly backup.
5. **Docs:** add a new `docs/RELEASING.md` section "Auto-deploy on green main" covering:
   - how it works;
   - the secrets Julio must add (names only);
   - how to pause it (delete or disable a secret, or a repo variable `AUTO_DEPLOY=off` that the job checks);
   - how to roll back (set `IMAGE_TAG` to a `sha-…` tag in Coolify and restart).

### Read first
`AGENTS.md`, `.github/workflows/images.yml`, `.github/workflows/ci.yml`, `docs/RELEASING.md`, `apps/server/Dockerfile`, `apps/server/src/app.ts` (lines 540-565).

### Allowed files
`.github/workflows/images.yml`, `apps/server/Dockerfile`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `docs/RELEASING.md`, `work/T-0260-auto-deploy-green-main.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test.ts
pnpm gate
```
Also validate the workflow YAML (for example with `actionlint` if it is installed, or with a YAML parse), and report what you ran.

### Acceptance
- With the three secrets set, a green CI run on `main` leads to new `latest` images and a restarted live service whose `/health.commit` equals the merged sha. Without the secrets, the deploy job skips cleanly.
- No secret value appears in logs or files.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Setting the secrets (Julio does this), the mobile app, and changing the Coolify service itself.

---

## Report (written by the worker when done)

## Review (written by Claude)
