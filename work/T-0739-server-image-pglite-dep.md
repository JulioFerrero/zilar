---
id: T-0739
title: "HOTFIX: the server image crashes at start (ERR_MODULE_NOT_FOUND @electric-sql/pglite, a devDependency imported by effect/sql.ts); move it to dependencies and add an image start smoke step in images.yml that fails before any push"
status: merged
milestone: M5
branch: task/T-0739-server-image-pglite-dep
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0739: the server image must start

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 at 07:35 UTC, the lead deployed `latest` (commit `34b73d1c`) to the live Coolify service. The server container crash-looped and the site was down for about 12 minutes; the lead rolled it back to `sha-eeaddee30d85`. Running the same image locally shows the crash:
`Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@electric-sql/pglite' imported from /app/src/effect/sql.ts`.
Every server image built since T-0496 (2026-10-08) has this bug. CI never runs the built image, so nothing caught it.

### Verified facts (do not re-derive)
- `apps/server/src/effect/sql.ts:17` imports `PGlite` from `@electric-sql/pglite` at the top level, and `:18` and `:20` import `@effect/sql-pglite` and `drizzle-orm/pglite`, which also load it.
- In `apps/server/package.json`, `@electric-sql/pglite` (`^0.5.8`) is under `devDependencies` (line 35), while `@effect/sql-pglite` is under `dependencies` (line 17).
- `apps/server/Dockerfile:42` builds the runtime directory with `pnpm --filter @zilar/server deploy --prod --legacy /opt/zilar-server`, so devDependencies are left out.
- **`.github/workflows/images.yml`:**
  - the build job (lines 49-159) builds each matrix image (`zilar-server` at line 66) for `linux/amd64,linux/arm64`;
  - it pushes in the steps "Build and push (version tag)" (line 126) and "Build and push (green main)" (line 143);
  - no step runs the image.

### What to build
1. **`apps/server/package.json`:** move `@electric-sql/pglite` from `devDependencies` to `dependencies`, keeping the same version range. Run `pnpm install` to update `pnpm-lock.yaml`. Change nothing else in the lockfile.
2. **`.github/workflows/images.yml`:** add one step that runs for the `zilar-server` matrix entry only, before both push steps and also in the no-push PR build. It:
   - builds the image for `linux/amd64` with `load: true` and a local tag such as `zilar-server:smoke`;
   - runs the image for at most 60 s with `NODE_ENV=production` and `DATABASE_URL=postgres://smoke:smoke@127.0.0.1:1/smoke` (an unreachable database), plus whatever else the server needs to get past config parsing. Read `apps/server/src/config.ts` and set the minimum;
   - fails the job if the output matches `ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module`.

   A clean exit, or an exit with a connection error, passes. Put a short comment above the step explaining why it exists (this incident). Keep the existing steps unchanged.
3. **Prove it locally,** from the worktree root, and paste the last lines of each run into the Report:
   - `docker build -f apps/server/Dockerfile -t zilar-server:smoke .`, then run it as in step 2. The output must show that the module error is gone (for example a database connection error instead);
   - check out the old `package.json` and lockfile with `git stash`, rebuild, and confirm the smoke grep does catch the old image. Then restore your change.

### Read first
`AGENTS.md`, `apps/server/package.json`, `apps/server/Dockerfile`, `apps/server/src/config.ts` (the required env), `.github/workflows/images.yml` (lines 49-159).

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `.github/workflows/images.yml`, `work/T-0739-server-image-pglite-dep.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The locally built server image starts past module loading, and the smoke grep catches the old image.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed
- `apps/server/package.json`: `@electric-sql/pglite` `^0.5.8` moved from devDependencies to dependencies (placed after `@effect/sql-pglite`).
- `pnpm-lock.yaml`: only the move (the importer entry moved from devDependencies to dependencies; same version 0.5.8). `git diff` shows 4 lines changed in the lockfile, nothing else.
- `.github/workflows/images.yml`: one new step, "Smoke-start the server image (before any push)", with a comment above it citing this incident. It runs only for `matrix.name == 'zilar-server'` and sits before the no-push build and both push steps. It builds `linux/amd64` as `zilar-server:smoke`, runs it for at most 60 s with `NODE_ENV=production`, `DATABASE_URL=postgres://smoke:smoke@127.0.0.1:1/smoke`, and placeholder `BETTER_AUTH_SECRET`, `EJABBERD_ADMIN_JID`, `EJABBERD_ADMIN_PASSWORD` and `ZILAR_XMPP_JWT_SECRET` (the config-required values in `apps/server/src/config.ts` and `apps/server/src/xmpp/config.ts`). It fails the job if the output matches `ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module`. No other step was changed.
- This file (Report and status) is the only other change.

### Deviations from the spec
- The build is a plain `docker build --platform linux/amd64 ... -t zilar-server:smoke .` inside the single `run:` step, not a `docker/build-push-action` step with `load: true`. The spec said "one step", and a plain build loads the image into the runner's daemon by default.
- The run uses `timeout 60` (GNU coreutils, present on `ubuntu-latest`). macOS has no `timeout`, so my local run used `perl -e 'alarm 60; exec @ARGV' docker run ...` instead. I could not run the GitHub workflow itself here.
- The step fails only on the grep, as the spec says. A non-module config error would therefore pass the step. A 124 exit (still running after 60 s) also passes.
- Cost: the smoke build is uncached, so the `zilar-server` leg builds the image one extra time per run.

### Local proof (commands run from the worktree root)
1. `docker build -f apps/server/Dockerfile -t zilar-server:smoke .` (fixed package.json and lockfile): built OK (`naming to docker.io/library/zilar-server:smoke done`).
2. Smoke run of the fixed image (`docker run --rm --name zilar-server-smoke -e NODE_ENV=production -e DATABASE_URL=postgres://smoke:smoke@127.0.0.1:1/smoke ...` plus the placeholder secrets, under a 60 s alarm). Last lines:
   ```
     query: 'CREATE SCHEMA IF NOT EXISTS "drizzle"',
     params: [],
     cause: Error: connect ECONNREFUSED 127.0.0.1:1
     ...
     code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 1
   }
   Node.js v24.11.1
   ```
   Exit 1 from the connection error. Grep count for `ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module`: 0. The server got past module loading and config parsing and stopped only at the unreachable database, which the spec counts as a pass.
3. Old image: `git stash push -- apps/server/package.json pnpm-lock.yaml`, then `docker build -f apps/server/Dockerfile -t zilar-server:smoke-old .` (old files, built OK), then the same smoke run on `zilar-server:smoke-old`. Last lines:
   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@electric-sql/pglite' imported from /app/src/effect/sql.ts
     code: 'ERR_MODULE_NOT_FOUND'
   ```
   Exit 1. Grep count: 3. The smoke grep catches the old image.
4. `git stash pop` restored both files (`git stash list` is empty). The smoke containers were removed (`--rm`, and `docker rm -f zilar-server-smoke` after each run). Local images `zilar-server:smoke` and `zilar-server:smoke-old` remain on this machine; nothing was pushed or logged in.

### Checks
- `pnpm install`: done (lockfile updated, the usual peer-dependency warning for apps/mobile is pre-existing).
- `pnpm exec prettier --write apps/server/package.json .github/workflows/images.yml`: both unchanged after the final edit.
- The workflow YAML parses (checked with the `yaml` package in node_modules): 1 smoke step, `if: matrix.name == 'zilar-server'`, placed before the no-push build.
- `pnpm gate` (run from the worktree root, after the edits above):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (13.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.0s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Open questions
- None blocking. Please confirm that a plain `docker build` in the `run:` step is acceptable for the "load: true" wording, and that a non-module startup error passing the step is acceptable for a hotfix.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.3 min). The lead reviewed the diff directly.
- **The fix:** `@electric-sql/pglite` moved to `dependencies`; the lockfile changes only that entry.
- **The CI step:** "Smoke-start the server image" runs for `zilar-server` before both push steps and in PR builds. It uses an unreachable DB and fails on module errors.
- **Local proof:** the fixed image fails only with `ECONNREFUSED`, while the old image shows `ERR_MODULE_NOT_FOUND` and the grep catches it.
- **Before redeploying:** the lead verifies the CI-built image against a scratch Postgres.
