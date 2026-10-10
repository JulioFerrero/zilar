---
id: T-0909
title: "PGlite out of the production install: lazy or type-only imports, so @electric-sql/pglite and @effect/sql-pglite become devDependencies of the server"
status: todo
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
`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/db/client.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/test-support.ts`, `apps/server/src/test-global-setup.ts`, `apps/server/src/effect/*.test.ts`, `work/T-0909-pglite-dev-only.md`.

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

## Review (written by Claude)
