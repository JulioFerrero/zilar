---
id: T-0861
title: "Server image: bundled build instead of tsx, PGlite out of production deps, Dockerfile layer order, one build per workflow"
status: todo
milestone: M5
branch: task/T-0861-server-bundle-image
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0861: Server image: bundled build instead of tsx, PGlite out of production deps, Dockerfile layer order, one build per workflow

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings H-F3, H-F4 and H-F5 in `docs/audit/simplify-2026-10-09/H-tooling.md`.
- **tsx in production:** `apps/server/Dockerfile` runs `CMD ["node", "/opt/tsx/node_modules/tsx/dist/cli.mjs", "src/index.ts"]` (about :85). It installs tsx with a separate `npm install` (about :63-66) and enables corepack and pnpm at run time (about :50-52), though pnpm is unused there. A local measurement gave tsx about 3.5 s of start CPU and 289 MB RSS, against a 3.3 MB esbuild bundle at about 0.9 s and about 180 MB (parity UNVERIFIED).
- **Bundling traps:** workspace packages are TS source, so they must be bundled while npm dependencies stay external. `apps/server/src/version.ts:4` reads `../package.json` via `import.meta.url`. The migrations directory and other `import.meta.url`-relative reads must keep working.
- **Layer order:** `npm install tsx` and `apk add ffmpeg` sit after the app COPY, so they rebuild every time. `images.yml` builds the server image twice (smoke, then push).
- **PGlite:** `@electric-sql/pglite` and `@effect/sql-pglite` are production dependencies only because `apps/server/src/effect/sql.ts:17-18` imports PGlite at the top level (25 MB).

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
In this order, one commit each:
1. **PGlite lazy:** make PGlite imported dynamically only on the test path, then move both packages to devDependencies. Server tests must pass.
2. **Build script:** add an esbuild (or tsdown) `build` script in apps/server. Bundle the workspace TS packages, keep npm dependencies external, and emit ESM with a `createRequire` banner if needed and source maps. Fix `version.ts` and every `import.meta.url`-relative file read so they work from `dist/`. Grep them all, and list them in the Report.
3. **Run the bundle locally against the local docker stack**, the same way as the T-0838 rehearsal (see its task file `work/T-0838-server-entry.md`: env symlink, scratch database, `PORT=3199`, gateway, hub and push off). Check that it starts, logs `zilar-server listening`, answers 401 on `/api/me`, and stops cleanly on SIGTERM. Compare start time and RSS with tsx. Never print env values, and drop the scratch database.
4. **Dockerfile:** build in the builder stage and copy `dist` plus the production node_modules (`pnpm deploy --prod` or equivalent). Use `CMD ["node","--enable-source-maps","dist/index.mjs"]`, move `apk add ffmpeg` before the app COPY, and drop the tsx and corepack runtime layers.
5. **images.yml:** build the server image once and reuse it for the smoke start and the push. Keep the smoke start's checks unchanged.

You cannot run docker builds if Docker is not running; say so. The CI smoke start is then the check, and the lead watches the first run.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/Dockerfile`, `apps/server/package.json`, `apps/server/build.mjs`, `apps/server/tsdown.config.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/version.ts`, `apps/server/src/**/*.ts`, `.github/workflows/images.yml`, `pnpm-lock.yaml`, `.dockerignore`, `apps/server/.dockerignore`, `work/T-0861-server-bundle-image.md`.

### Checks (wave mode)
```bash
pnpm install
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/db src/version src/startup.test.ts src/main.test.ts
pnpm --filter @zilar/server build
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio checks the server start at the next deploy. The CI image smoke start must pass on main.

---

## Report (written by the worker when done)

## Review (written by Claude)
