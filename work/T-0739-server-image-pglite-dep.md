---
id: T-0739
title: "HOTFIX: the server image crashes at start (ERR_MODULE_NOT_FOUND @electric-sql/pglite, a devDependency imported by effect/sql.ts); move it to dependencies and add an image start smoke step in images.yml that fails before any push"
status: todo
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

## Review (written by Claude)
