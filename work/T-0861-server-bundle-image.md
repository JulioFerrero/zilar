---
id: T-0861
title: "Server image: bundled build instead of tsx, PGlite out of production deps, Dockerfile layer order, one build per workflow"
status: merged
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

### Steps (one commit each)
1. `a141d854` PGlite lazy. `effect/sql.ts` imports PGlite only as a type; `isPgliteDatabase` now checks `!('kind' in db && db.kind === 'postgres')` (no `instanceof`); `@effect/sql-pglite` and `@electric-sql/pglite` load through `import()` inside `pgliteLayer`, `snapshotOfMigratedDatabase` and `freshMigratedPglite`. Both packages moved to devDependencies. Nothing else in non-test `src` imports them (`db/client.ts` is type-only).
2. `a0777e13` Build. `apps/server/build.mjs` (esbuild 0.28.2, devDependency) emits `dist/index.mjs` and `dist/tool-worker.mjs` with source maps, ESM, `createRequire` banner. `@zilar/*` is bundled, every other bare import is external. The build FAILS if a static external import is not in the server `dependencies` (this found `@xmpp/client` and `ws`, which only workspace packages declared, so they were added to the server dependencies). Scripts `build` and `start` added. Sizes: `index.mjs` 1.48 MB (+3.4 MB map), `tool-worker.mjs` 17.9 KB. (The audit said 3.3 MB; that figure counted the map or an older tree.)
3. `518845b1` Dockerfile. Builder runs `pnpm --filter @zilar/server build` then `pnpm deploy --prod --legacy`. Runtime: `apk add ffmpeg` first, user and volume dirs, then node_modules, package.json, drizzle, dist copied with `--chown`. No corepack, no tsx. `CMD ["node","--enable-source-maps","dist/index.mjs"]`.
4. `4970eeeb` images.yml. The server image is built once (`load: true`, now with build-args, labels and cache-to), smoke-started with the unchanged checks, and on green main that same image is tagged `latest` and `sha-<short>` and pushed with `docker push`. The PR no-push build and the green-main build-push skip `zilar-server`. A version tag still builds multi-arch in its own step (amd64 layers come from the cache).

### `import.meta.url` sites (all of `apps/server/src`, non-test)
- `version.ts:4` `../package.json`: works unchanged, `dist/index.mjs` -> `apps/server/package.json` (the Dockerfile copies package.json to `/app`).
- `stickers/service.ts:102` `serverPackageRoot`: walks up to the `@zilar/server` package.json, so `dist/` resolves to the package root. Unchanged.
- `effect/sql.ts:31` `migrationsFolder`: FIXED, `../../drizzle` from source, `../drizzle` from the bundle (decided by `import.meta.url.endsWith('.ts')`).
- `sandbox/run-tool.ts:133` worker path: FIXED, bundle uses `./tool-worker.mjs` and `new Worker(path)` directly. Before, the worker was `tool-worker.ts` loaded through `tsx/cjs`, so removing tsx would have broken sandboxed tools in production. `run-tool.ts:155` (`createRequire`, tsx hook) now runs only on the source path (tests).
- `auth/invite-cli.ts:98`: only a CLI entry, not in the bundle; unchanged.

### Rehearsal
- Docker is NOT running here (`Cannot connect to the Docker daemon`), and nothing listens on 5432 (only libpq client tools). I did not start Docker or any daemon. So: no Docker image build, no local-stack start, no `zilar-server listening`, no 401 on `/api/me`, no SIGTERM check. The CI smoke start is the check for those.
- What I could run (env symlink, `PORT=3199`, gateway/hub/push off, `NODE_ENV=test`, `DATABASE_URL` pointing at a closed port, no env values printed, symlink removed): both tsx and the bundle load all modules and reach the same `SqlError: PgConnection: Failed to connect`, exit 1. No `ERR_MODULE_NOT_FOUND`. Wall time / user CPU / max RSS to that point (machine load average about 65, so noisy): tsx 4.45 s / 2.84 s / 393 MB; bundle 2.02 s / 0.74 s / 299 MB.
- The `pnpm deploy --prod --legacy` tree (310 MB node_modules) with only node_modules, package.json, drizzle and dist runs the bundle to the same point, so all external packages resolve from a standalone production tree.
- The bundled `tool-worker.mjs` started in a `Worker` and ran QuickJS (log message and the "default-export a function" error came back).

### Checks
- `pnpm --filter @zilar/server typecheck`: clean. `build`: passes. oxlint on the changed files: clean. Prettier applied.
- Tests `src/db src/version src/startup.test.ts src/main.test.ts`, 3 runs after the last commit: 3 files, 31 tests passed each time. Also passed: `src/sandbox/run-tool*.test.ts` and `src/stickers` (145 tests in 8 files). The machine was at load average about 65, so I used `--testTimeout=90000 --hookTimeout=90000`; with the spec's 30 s the PGlite tests (migrate, sql, startup) timed out purely from load (migrate.test.ts took 321 s for 9 tests; it passes). No code change fixed that.

### Behaviour differences
- Production starts from the bundle, with source maps via `--enable-source-maps`; stack traces point to the original TS.
- Server now lists `@xmpp/client` and `ws` as direct dependencies.
- Sandbox tools run the bundled worker without tsx.
- On green main the pushed image is the smoke-tested one (before: rebuilt).

### Unsure
- PGlite is still in the production `node_modules` (25 MB): `better-auth` and `drizzle-orm` get it as a resolved optional peer in the lockfile. Removing it needs a pnpm peer or overrides setting outside this task's files.
- Not run: the Docker build (COPY paths, `pnpm deploy` inside the image) and the `docker push` of a loaded image in CI. The lead should watch the first CI run. A `build-push-action` `load: true` image keeps its labels, which I pass explicitly.
- I made the step-1 edits to `sql.ts` with a scratch Node script outside the repo (checked with `git diff`) rather than the Edit tool.

### Round 2 (Docker available)
- **Local rehearsal** (scratch database `zilar_t0861` owned by the app role, recreated before each run, dropped at the end; `PORT=3199`, gateway, hub and push off, `NODE_ENV=test`; env symlink removed; no values printed). All four runs: `zilar-server listening`, `/api/me` 401, `shutting down` with the right `signal`, exit 0.

| Run | Listening after | User CPU | Max RSS (whole run) | RSS while running |
| --- | --- | --- | --- | --- |
| bundle SIGTERM | 2.5 s | 1.15 s | 310 MB | 302 MB |
| bundle SIGINT | 1.9 s | 1.10 s | 311 MB | 303 MB |
| tsx SIGTERM | 2.1 s | 1.76 s | 364 MB | 355 MB |
| tsx SIGINT | 2.2 s | 1.74 s | 363 MB | 354 MB |

  (tsx started as `node --import tsx src/index.ts`; times include the first-start migrations and a lower machine load than round 1.)
- **Image** built with the Dockerfile unchanged (`docker build -f apps/server/Dockerfile .`, native arm64): 717 MB (`docker image inspect` Size). Not compared with the old image.
- **CI smoke start reproduced** (throwaway `postgres:17` on a docker network, same env as `images.yml`): `zilar-server listening` after 3 s, `/health` answers `ok:true, db:ok`, 189 MiB in `docker stats`, `docker stop` exits 0. Containers, network and image removed.
- Nothing failed, so no code change in round 2. Not run: the CI push step (`docker push` of the loaded image), which only CI can show.

## Review (written by Claude)

**Lead, 2026-10-10: approved after round 2.**
- **What changed:** an esbuild bundle replaces tsx in the image, and the tool worker is bundled too; without it, sandboxed tools would have broken.
- **Round 2, run locally against Docker:**
  - start and SIGTERM/SIGINT stops pass for both the bundle and tsx;
  - the bundle uses about 0.65 s less CPU and about 50 MB less RAM;
  - the image builds locally (717 MB, arm64);
  - the CI smoke start, reproduced locally, logs "listening" after 3 s with `/health` db ok.
- **Not tested:** the CI `docker push`; the first CI run on main checks it.
- **Follow-ups:** image size, and PGlite still pulled in as better-auth's optional peer.
- **Not this task:** the `sql.test.ts` failures in the combined check came from T-0849's migration.
- **Live check for Julio:** the server starts and stops from the new image.
