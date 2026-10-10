---
id: T-0909
title: "PGlite out of the production install: lazy or type-only imports, so @electric-sql/pglite and @effect/sql-pglite become devDependencies of the server"
status: merged
milestone: M5
branch: task/T-0909-pglite-dev-only
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0909: PGlite out of the production install

## Spec (written by Claude, do not edit)

### Why
`apps/server/package.json:36-37` lists `@effect/sql-pglite` and `@electric-sql/pglite` as runtime dependencies. The production image installs them with `pnpm --filter @zilar/server deploy --prod` (`apps/server/Dockerfile:47`).

PGlite is the test database. The audit (`docs/audit/simplify-2026-10-09/H-tooling.md`, F5) estimated about 25 MB in the image, and T-0861's Review left this as a follow-up.

The lead found these non-test files that mention PGlite: `apps/server/src/db/client.ts` (`:1` is a type-only import, `:12` declares `type ServerDatabase = PostgresServerDatabase | PGlite`), `apps/server/src/effect/sql.ts`, `apps/server/src/test-support.ts` and `apps/server/src/test-global-setup.ts`.

### What to build
1. **Find every runtime import of the two packages** in server code that ships, meaning code reachable from the production entry. Type-only imports are fine. A runtime import that only test code reaches should move behind a dynamic `import()` in the branch that handles a PGlite handle, or into the test-only module.
2. **Move both packages to `devDependencies`** in `apps/server/package.json`, then run `pnpm install`.
3. **Prove the production bundle needs neither.** Build the server bundle as the Dockerfile does: read `apps/server/Dockerfile` and run the same build and `pnpm deploy --prod` steps into a scratch folder. Check that the deployed `node_modules` contains no `@electric-sql/pglite`, and that the bundled server starts against the local Postgres in Docker, logging "listening" (the T-0861 smoke recipe in its Report). Report the deployed folder size before and after (`du -sh`).
4. **Tests:** the server tests still pass, because they use PGlite through the dev dependency.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), `apps/server/Dockerfile`, the Report of `work/T-0861-server-bundle-image.md`, `apps/server/src/db/client.ts` and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (lead, round 1: the peer override), `apps/server/src/db/client.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/test-support.ts`, `apps/server/src/test-global-setup.ts`, `apps/server/src/effect/*.test.ts`, `work/T-0909-pglite-dev-only.md`.

### Checks (wave mode)
```bash
pnpm install --frozen-lockfile
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/effect src/db src/pins
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Also run the deploy-and-start proof from step 3.

### Acceptance
- The Checks pass.
- The deployed production folder has no PGlite, and the bundled server starts.
- The Report gives the sizes before and after.

---

## Report (written by the worker when done)

### Finding: steps 1 and 2 were already done by T-0861
- On this branch `@effect/sql-pglite` and `@electric-sql/pglite` are already in `devDependencies` (`apps/server/package.json:36-37`, under `devDependencies` at `:35`). No code or package.json change was needed, so there is no code commit.
- Runtime imports found: `src/db/client.ts:1` type-only; `src/effect/sql.ts:17` type-only; `sql.ts:53` (`@effect/sql-pglite`), `:138` and `:148` (`@electric-sql/pglite`) are dynamic `import()` inside `pgliteLayer`, `snapshotOfMigratedDatabase` and `freshMigratedPglite`. `src/test-support.ts:2` and `src/test-global-setup.ts:4` are static imports but test-only (not reachable from `src/index.ts`). Nothing to change.

### Deploy proof (scratch folder `<scratchpad>/T-0909/deploy`)
- `pnpm --filter @zilar/server build` then `pnpm --filter @zilar/server deploy --prod --legacy`: deployed `node_modules` 310 MB, whole folder 321 MB (it also holds src and tests). Before = after, since nothing changed.
- NOT MET before round 1 (fixed in round 1 below): the deployed tree still contains `node_modules/.pnpm/@electric-sql+pglite@0.5.8` (25 MB). It is not linked at `node_modules/@electric-sql` (no top-level entry) and the bundle never loads it. It stays because the lockfile resolves `drizzle-orm@0.45.3` (pulled in through `better-auth`) with `@electric-sql/pglite` as a resolved optional peer (`pnpm-lock.yaml:11046-11048`, and three `better-auth` snapshots), so `deploy --prod` copies it. Same cause T-0861 noted. Fixing it needs a peer rule in `pnpm-workspace.yaml` (for example a `packageExtensions` or `overrides` entry for drizzle-orm / better-auth) or moving pglite out of the server importer, and `pnpm-workspace.yaml` is not an Allowed file. Needs a decision from the lead.

### Round 1: fix
- `pnpm why drizzle-orm --filter @zilar/server`: only `@better-auth/drizzle-adapter` and `better-auth` (both optional peers, auto-installed by `autoInstallPeers`). The server uses its own `src/auth/sql-adapter.ts`, no drizzle.
- Fix: `overrides` in `pnpm-workspace.yaml`: `drizzle-orm: '-'` and `drizzle-kit: '-'` (the `-` removes the dependency). T-0272 `packageExtensions` untouched.
- Lockfile diff: 2 files changed, 18 insertions, 669 deletions (drizzle-orm, drizzle-kit, @drizzle-team/brocli, @esbuild-kit and the old esbuild 0.18/0.25 binaries leave the lockfile). `pnpm install --frozen-lockfile` clean.
- New deploy folder: `node_modules` 221 MB (was 310 MB), whole folder 230 MB (was 321 MB). No pglite and no drizzle-orm/kit in it; only the small `@better-auth/drizzle-adapter` package remains.
- Start proof repeated on the new deploy: `listening`, `/api/me` 401, SIGTERM `shutting down`, no `ERR_MODULE_NOT_FOUND`; scratch DB dropped.
- Tests `src/effect src/db src/pins src/auth`: 21 files passed, 1 skipped; 163 tests passed, 2 skipped. Server, web and mobile typechecks clean.

### Start proof (before the fix)
- Ran `node --enable-source-maps dist/index.mjs` from the deployed folder (plus the built `dist` and `drizzle`) against a scratch database `zilar_t0909` in the local Postgres container (throwaway `BETTER_AUTH_SECRET`, `PORT=3199`, gateway off; no env values printed; scratch DB dropped afterwards; no symlink was needed in the worktree).
- Result: `listening` logged, `GET /api/me` answers 401, SIGTERM logs `shutting down`. No `ERR_MODULE_NOT_FOUND`.

### Checks
- `pnpm install --frozen-lockfile`: ok. `pnpm --filter @zilar/server typecheck`: clean.
- `vitest run src/effect src/db src/pins`: 12 files, 73 tests passed (68 s).
- prettier/oxlint: no source files changed (only this task file).

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 1.**
- **Starting point:** PGlite was already dev-only (T-0861). It still reached the prod deploy as an auto-installed optional peer of `drizzle-orm`, which only better-auth's unused drizzle adapter pulled in.
- **Round 1:** `overrides` in `pnpm-workspace.yaml` drop `drizzle-orm` and `drizzle-kit`, and the lockfile loses 669 lines.
- **Size:** the deployed server folder goes from 321 to 230 MB, with no PGlite or drizzle left in it.
- **Proof:** the bundled server starts against Postgres, the auth tests pass, and the three typechecks are clean.
- **Check:** the combined check passes.
- **Live check for Julio:** the production image after deploy (sign-in works).
