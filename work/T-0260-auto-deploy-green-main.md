---
id: T-0260
title: "Deploy: every green CI run on main publishes the images as latest and restarts the live Coolify service; /health reports the commit"
status: merged
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

status: review. Files changed (all in Allowed files): `.github/workflows/images.yml`, `apps/server/Dockerfile`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `docs/RELEASING.md`, `work/T-0260-auto-deploy-green-main.md`.

### What I did

1. **Build commit in `/health`**
   - `apps/server/Dockerfile` runtime stage now declares `ARG ZILAR_COMMIT=unknown` and `ENV ZILAR_COMMIT=$ZILAR_COMMIT`.
   - `apps/server/src/app.ts` `/health` now returns `commit: process.env.ZILAR_COMMIT ?? 'unknown'` (read per request; `config.ts` is not in Allowed files, so no config change).
   - `apps/server/src/app.test.ts` adds a test that stubs `ZILAR_COMMIT` and asserts `/health.commit`.
2. **`images.yml`** (full rewrite, same matrix and image names):
   - Added `workflow_run` trigger on workflow `CI`, type `completed`, branch `main`.
   - Job-level `if` makes `build` run for `workflow_run` only when `conclusion == 'success'`.
   - Checkout uses `workflow_run.head_sha` for the `workflow_run` path, else the normal ref.
   - A "Resolve build commit" step computes the full sha and the first 12 characters (GitHub expressions have no `substr`).
   - `workflow_run` builds push `:latest` and `:sha-<12>`; tag builds keep `:<tag>` + `:latest`; PRs still build without pushing. All three paths pass `ZILAR_COMMIT`.
3. **`deploy` job**, `needs: build`, only on a successful `workflow_run`:
   - Skips with a clear log line when `COOLIFY_URL`, `COOLIFY_TOKEN` or `COOLIFY_SERVICE_UUID` is missing, or when repo variable `AUTO_DEPLOY=off`.
   - Calls `POST {COOLIFY_URL}/api/v1/services/{uuid}/restart?latest=true` with `curl --fail`; the token only ever reaches the environment, never stdout. (The docs confirm `latest` is a **query** parameter for this endpoint, not a body field.)
   - Polls `${ZILAR_PUBLIC_URL:-https://chat.zilar.app}/health` every 15 s, 40 attempts (10 min), until `commit == head_sha` and `ok == true`, then fails otherwise. `ZILAR_PUBLIC_URL` can come from the secret or the repo variable.
   - `concurrency: { group: deploy-live, cancel-in-progress: false }`.
4. **Backups:** checked the Coolify API. A "backup now" endpoint exists only for standalone databases (`PATCH /databases/{uuid}/backups/{scheduled_backup_uuid}` with `backup_now: true`) and for volume/storage backups (`POST .../storages/{storage_uuid}/backups/run`). A database **inside a service** — Zilar's Postgres — has no backup endpoint: `ServiceDatabasesController` (Coolify `routes/api.php`) exposes only index/show/imports/update/logs/start/restart/stop. So per the spec I did not add a backup call; `docs/RELEASING.md` §9 now states auto-deploys rely on the nightly Coolify schedule and that a migration does not take an extra backup.
5. **Docs:** added `docs/RELEASING.md` §9 "Auto-deploy on green main": how it works, secret names (`COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_SERVICE_UUID`, optional `ZILAR_PUBLIC_URL`), how to pause (`AUTO_DEPLOY=off` or a missing secret), and rollback via an immutable `sha-…` tag + `IMAGE_TAG`.

### Commands and real results

- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test.ts`: 1 file passed, **9 tests passed**, 3.61s.
- Workflow YAML validation: `actionlint` is not installed, so I parsed the file with the repo's `yaml` package (`yaml@2.9.1`): "YAML parse OK; top-level keys: name, on, permissions, jobs; triggers: pull_request, push, workflow_run; jobs: build, deploy". `prettier --check` (part of the gate) also parsed it.
- `pnpm gate` (from repo root, final run after the report and `status: review` were written):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (0.6s)
  PASS  tests @zilar/server  (359.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (An earlier run before the report was written was also `GATE PASS` with the same 6 files.)

### Deviations / notes

- No backup call was added, because no such API exists for a service database (see 4). This matches the spec's "if it does not exist" branch.
- `ZILAR_COMMIT` is read straight from `process.env` in `app.ts` because `apps/server/src/config.ts` is outside the Allowed files; the spec allowed this.
- The rollback `sha-…` tag is the first 12 characters of the commit, per the spec.
- I could not run the workflow end to end (no GitHub runner, no Coolify secrets); `build`/`deploy` behaviour is verified by parse and review only.

### Round 2 — PREREVIEW findings

- **Finding 1 (should-fix) — fixed.** Added `github.event.workflow_run.event == 'push'` to the `build` job `if` and to the `deploy` job `if` in `.github/workflows/images.yml`. `workflow_run.branches: [main]` matches the head branch, so a fork PR whose branch is named `main` could otherwise build and deploy attacker code with repo secrets. CI's `push` trigger is `branches: [main]`-only and forks cannot push here, so the `event == 'push'` predicate closes the vector without touching the trigger block, exactly as the finding prescribes.
- **Finding 2 (nit) — not changed.** It concerns the deploy job's `concurrency` block, and the PREREVIEW itself records it as an accepted trade-off of the spec's `latest`-based design. It is not in a line I changed, so per the instructions I left it alone.
- **Test.** Finding 1 names no test, and the Allowed files contain no workflow test harness (there is no test file for `.github/workflows/`), so no test could be added for this YAML behaviour. I validated it by parsing the file with the repo's `yaml` package (`actionlint` is not installed): parse OK, and both `build.if` and `deploy.if` carry `github.event.workflow_run.event == 'push'`. The round-1 `/health.commit` test is unchanged.
- **Commands.** `node -e` YAML parse: OK. `pnpm gate` (from repo root, after the fix commit):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (12.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.7s)
  PASS  tests @zilar/server  (355.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Lead fix round — the latest-image race

- **Only the current tip of `main` publishes.** Added a first job `tip` that runs only for a successful `push` `workflow_run`. It runs `git ls-remote "https://github.com/${{ github.repository }}" refs/heads/main`, compares that sha with `github.event.workflow_run.head_sha`, and writes `latest=true|false`; a stale run logs `Skipping: <sha> is no longer the tip of main` and ends green. `build` now `needs: [tip]`, and both `build` and `deploy` run only when `needs.tip.outputs.latest == 'true'`, keeping the existing success/push conditions behind `always()` so tag and PR builds still run when `tip` is skipped.
- **Publishing is serialized.** Added a workflow-level `concurrency` group: `${{ github.event_name == 'workflow_run' && 'publish-main' || format('images-{0}', github.run_id) }}`, `cancel-in-progress: false`. Only one green-main run publishes at a time and a newer one waits; tag and PR builds keep a per-run group. The `deploy` job keeps its own `deploy-live` group.
- **Docs.** Added two sentences to `docs/RELEASING.md` §9 describing the `tip` check and the `publish-main` serialization.
- **Validation.** `node -e` YAML parse (`actionlint` is still not installed): parse OK; `jobs: tip, build, deploy`; both `build.if` and `deploy.if` carry `needs.tip.outputs.latest == 'true'`; the top-level concurrency group resolves to `publish-main` for `workflow_run` and `images-<run_id>` otherwise.
- **Commands.** `pnpm gate`:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (12.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.6s)
  PASS  tests @zilar/server  (356.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Round 3 — PREREVIEW finding 1 (must-fix)

- **Finding 1 (must-fix) — fixed.** Added `needs.build.result == 'success'` to the `deploy` job `if` in `.github/workflows/images.yml` (line 167). `always()` is still needed so a skipped `tip` on the tag/PR path does not block, but it also ignores an upstream failure; the new guard means a failed `build` (for example one flaky arm64 matrix leg, which pushes no new `latest`/`sha-…`) no longer calls the Coolify restart and then polls `/health` for a commit that was never published.
- **Finding 2 (nit) — not changed.** It is in `apps/server/src/app.test.ts`, a file and line this fix does not touch; the instructions say not to touch nits outside lines I already change. Left as is.
- **Test.** Finding 1 names no test and there is no workflow test harness in the Allowed files, so none could be added for the YAML guard. Validated by parsing the file with the repo's `yaml` package (`actionlint` is not installed): parse OK; `jobs: tip,build,deploy`; `deploy.if` now carries `needs.build.result == 'success'`.
- **Commands.** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test.ts`: 1 file passed, 9 tests passed, 4.06s. `pnpm gate` (from repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.9s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.8s)
  PASS  tests @zilar/server  (242.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

**Verdict:** Approved after 2 auto rounds and one lead fix round.
- Auto rounds: fork PRs on a branch named main are refused, and deploy requires a successful build.
- Lead fix round: overlapping runs could push an older `latest`, so only the tip of main publishes, and publishing is serialized.
- Accepted nits:
  - a run can go stale mid-build, but the next run converges;
  - a failed matrix leg can leave a mixed `latest`, but deploy skips it;
  - a failed `ls-remote` skips quietly.
- `/health` now reports `commit`.
- Live stays manual until Julio adds `COOLIFY_URL`, `COOLIFY_TOKEN` and `COOLIFY_SERVICE_UUID` (zilar service `zogjtvwnoh9rqo96h7e7ajz1`); until then each green push to main only publishes images.
