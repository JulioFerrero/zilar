# H. Tooling, CI, build and infra audit

## 1. Summary

- CI wall time is the `Test` job alone: 682 s of the 11.4 min run (`Typecheck` 30 s, `Format and lint` 47 s, `Build` 32 s; run 37972033759). Inside it `@zilar/server#test` takes 644 s (162 files, each on its own PGlite) while the other packages finish in 5 to 190 s. The job runs on a 4-vCPU runner (repo is public) with no sharding. Splitting server tests into 3 vitest shards would cut CI to about 4.5 to 5 min (estimate: 644 s / 3 + ~40 s setup). See F1.
- A tiny set of files carries the cost. In the latest main run, 64 test files over 10 s each sum to 1719 s of 2255 s of file time (76%). The top five are `agents/gateway.test.ts` 197 s, `groups/groups.test.ts` 110 s, `ais/routes.test.ts` 91 s, `actions/gateway.test.ts` 79 s and `sandbox/run-tool.test.ts` 68 s. Fixing those is a better lever than shards alone (F2).
- The server image runs `tsx` in production. I measured the import-to-first-error path locally: tsx uses 2.75 s user plus 0.8 s sys CPU and 289 MB RSS. An esbuild bundle (3.3 MB, 0.7 s build, pglite/quickjs/pino etc. kept external) loaded the same modules in 0.66 s user plus 0.21 s sys and 172 to 186 MB RSS. That is roughly 4x less CPU and about 100 MB less memory at every start. It also lets us drop the separate `npm install tsx` layer (F3). Wall times were noisy (workers loading the machine) and the bundle stopped at `version.ts` reading `../package.json` instead of the config check, so parity is approximate (UNVERIFIED).
- Image Dockerfile layer order defeats the cache: `COPY --from=builder`, then `npm install tsx`, then `apk add ffmpeg` all sit after the layer that changes every commit (`apps/server/Dockerfile`), so they rerun on every code push. Main-publish server job took 4.7 min of the 3.5 min images run (smoke build 72 s plus push build 57 s). One build used for smoke and push would save about 50 s (F4).
- `@electric-sql/pglite` (25 MB), `@effect/sql-pglite` and `quickjs-emscripten` are runtime `dependencies` of the server, so `pnpm deploy --prod` ships PGlite (a test-only DB) in the image. The T-0739 incident came from this being a devDependency; the fix kept it a dependency because `src/effect/sql.ts:17` imports it at top level. Lazy import would let it move to devDependencies (F5, about 25 MB).
- `packages/devtools` is 21.9k lines (lead 8.7k src plus 9.6k tests). The OpenCode-bound lead subsystem (autopilot, policy, decide, client, session, fresh-session, switch-model, fallback, model-schedule, doctor, sweeper, processes, collect-snapshot, snapshot, watch, watch-format, prompts, start-prereview) is 5.5k src plus 6.3k tests = 11.8k lines. The autopilot is not running now (no process; `~/.zilar-lead/autopilot.out` last written 06:26 today) because the 10-09 flow moved to Claude subagent waves (`lead batch`). Removal is an OWNER DECISION (F7).
- TypeScript is already 7.0.2 (native); `tsc --noEmit` takes 4.0 s for the server and 2.5 s for web locally, and CI typecheck is 1.7 s when cached. The T-0657 tsgo spike is moot; nothing to gain there. Prettier is the slowest static step (22 s in CI, `format:check`); lint is 0.8 s locally.
- Small hygiene items: `deploy/tests/*.sh` (6 shell tests) never run in CI; a stray tracked file `zilar-night-log-2026-09-28.entries` sits in the repo root; `lead.log` is 30 MB; `.turbo` is 563 MB.

## 2. Measurements

| What | Command | Result |
| --- | --- | --- |
| CI run on main | `gh run view 37972033759 --json jobs` | Test 682 s, Static 47 s, Typecheck 30 s, Build 32 s; wall 11.4 min |
| Turbo in Test job | log | `Tasks: 12 successful`, `Cached: 5 cached`, `Time: 10m46s`. Per package duration: server 644 s, web 187 s, mobile 183 s, others under 35 s |
| CI history | `gh run list --workflow CI --branch main --limit 30` | 23 cancelled, 6 failure, 1 success (before T-0774 concurrency fix); the failure I inspected (37970286268) was a web test, the T-0842 race |
| Slow test files | parsed `ci.log` | 728 file lines, 2255 s total, 64 files over 10 s = 1719 s |
| Images workflow | run 37973368359 | `zilar-server` job 4.7 min: smoke build 72 s, smoke start 11 s, push build 57 s, post-step buildx 10 s; web 45 s; postgres/ejabberd about 30 s; deploy 4 s |
| tsc | `apps/server`: `tsc --noEmit` | 4.0 s wall, 872 MB RSS |
| tsc | `apps/web` | 2.5 s |
| Start (tsx) | `node node_modules/tsx/dist/cli.mjs src/index.ts`, env empty | 2.75 s user, 0.79 s sys, 289 MB RSS, ends at "Invalid server configuration" |
| Start (bundle) | esbuild `src/index.ts --bundle --packages external-list`, 3.3 MB | 0.66 s user, 0.21 s sys, 172 to 186 MB RSS (stopped at `version.ts:4` package.json read) |
| Lint | `oxlint .` | 0.79 s |
| Prettier | `prettier --check .` | 109 s locally under load, 22 s in CI |
| Docker | `docker images` | daemon not running, so image sizes are UNVERIFIED; GHCR listing needs read:packages scope |

## 3. Findings (ranked by value/effort)

### F1. Shard the server tests in CI
- Evidence: `.github/workflows/ci.yml:75-92` single `test` job runs `pnpm test` (turbo, all packages). Server `vitest run --testTimeout=30000 --hookTimeout=30000` (`apps/server/package.json:10`), 162 test files, "tests 90%" of its 644 s, no vitest config file (default `forks` pool, default workers).
- Impact: wall 11.4 to about 5 min. Each shard repeats install (about 10 s) and checkout; use a matrix of `server 1/3`, `server 2/3`, `server 3/3` and `rest` (all other packages through turbo with `--filter=!@zilar/server`, about 190 s). Runner minutes grow from about 12 to about 15, free for a public repo.
- Risk: low; vitest `--shard=i/n` splits by file hash. Detect with a failing-shard check that every file runs once (compare total counts: 162 files).
- Effort: S (half a day). Also add `fail-fast: false`.

### F2. Cut the five slowest server tests
- Evidence: top files above (197 s, 110 s, 91 s, 79 s, 68 s; `src/db/migrate.test.ts` 21 s, 9 tests). Cost is per-test fresh PGlite plus app creation (`apps/server/src/test-support.ts`, `src/effect/sql.ts:115-131` snapshot clone per use). The snapshot design is good, but a file with 30 to 45 tests each paying a clone and `createApp` adds up.
- Recommendation: audit task per file (per-file `beforeAll` app plus per-test `TRUNCATE`/transaction rollback instead of fresh PGlite where tests do not need isolation); check `agents/gateway.test.ts` first (10% of all file time). Target half the server time (about 300 s saved of CPU, about 100 s of wall after F1).
- Risk: medium (test isolation). Safety net: the tests themselves; run each changed file 5 times to detect order dependence.
- Effort: M per file; start with the top 3.

### F3. Bundle the server instead of running tsx in production
- Evidence: `apps/server/Dockerfile:85` `CMD ["node", "/opt/tsx/node_modules/tsx/dist/cli.mjs", "src/index.ts"]`; `Dockerfile:63-66` installs tsx with a separate `npm install`, plus `corepack enable && corepack prepare pnpm` at runtime (`:50-52`, pnpm is not used at runtime). The server has no build step (header comment). Workspace packages are consumed as TypeScript source (`packages/protocol/src/index.ts`), which is why a plain `--packages=external` bundle failed in my test with `ERR_MODULE_NOT_FOUND`; they must be bundled while npm deps stay external (or bundle everything but pglite wasm, quickjs wasm, pino transports).
- Impact: start CPU 3.5 s to under 1 s, RSS about 100 MB lower (measured above); removes tsx and npm layers (about 40 MB of node_modules is unknown, UNVERIFIED), faster crash-loop recovery and faster deploy health checks. Runtime stack traces become bundle-relative unless `--sourcemap` plus `--enable-source-maps`.
- Risk: medium. `version.ts:4` reads `../package.json` via `import.meta.url` (breaks when bundled), any `import.meta.url`-relative file reads (drizzle migrations directory `apps/server/drizzle`, 47 files, and `data/`), CJS/ESM interop banner for `require`. T-0739/T-0743 already added a pre-push smoke start of the image in CI (`images.yml:141+`), which will catch module errors.
- Recommendation: add `build` script (`esbuild` or `tsdown`, one config of about 20 lines) in `apps/server`, run it in the builder stage, copy `dist/index.mjs` plus the externals' `node_modules` via `pnpm deploy`, and `CMD ["node","--enable-source-maps","dist/index.mjs"]`. Keep tsx for dev. Effort: M (1 to 2 days with the smoke test as safety net).

### F4. Dockerfile layer order and double build
- Evidence: `apps/server/Dockerfile:56-70`: `COPY --from=builder /opt/zilar-server /app` precedes `npm install tsx` and `apk add --no-cache ffmpeg`, so both rerun for every source change (cache key changes at the first changed layer). `images.yml:128-139` builds the amd64 image with `load: true` for smoke (72 s) and again for push (`:~184-196`, 57 s) as separate steps; neither shares output.
- Impact: moving `apk add ffmpeg` (and tsx install, or F3) before the app COPY saves the ffmpeg layer (about 20 to 30 s, UNVERIFIED); a single `build-push-action` with `load: true` then `push` of the smoke-tested tag (or `docker push`) saves about 50 s. Also builder stage `pnpm install --frozen-lockfile` installs dev dependencies for the 4 packages every dependency change; fine.
- Risk: low. Effort: S.

### F5. Move PGlite out of production dependencies
- Evidence: `apps/server/package.json:15-17,27` lists `@effect/sql-pglite`, `@electric-sql/pglite` (25 MB on disk in `node_modules/.pnpm`), and `quickjs-emscripten` (3 MB, legitimately used by the tool sandbox). `src/effect/sql.ts:17-18` imports PGlite at top level (used by `isPgliteDatabase` at `:41-42`), which is why T-0739 had to keep it a dependency.
- Recommendation: make the PGlite import dynamic (only on the test-layer path) and move both packages to `devDependencies`; the smoke start in CI proves the image still boots. Impact about 25 to 30 MB image, faster module graph load. Effort: S to M.

### F6. Run what exists: deploy shell tests and a dedup of web builds
- Evidence: `deploy/tests/*.test.sh` (6 scripts) is not referenced in `.github/workflows` or any package.json (grep returned nothing). They cover backups, storage safety, push deploy; if they are meant as a guard they are silently unprotected. CI `build` job also does `vite build` for web and site, and the images workflow does the same web build again (`apps/web/Dockerfile:41`).
- Recommendation: add a small `deploy-tests` job (about 20 s) or delete obsolete scripts; leave the web build duplication (images build in Docker must stay hermetic). Effort: S.

### F7. Devtools lead subsystem: owner decision
- Evidence: `packages/devtools/src/lead/*` per-file sizes (src, test): autopilot 664/821, policy 1111/1052, decide 320/640, client 421/196, session 169/145, fresh-session 65/154, switch-model 212/589, fallback 9/19, model-schedule 34/44, doctor 258/415, sweeper 237/225, processes 286/296, collect-snapshot 391/117, snapshot 123/89, watch 818/907, watch-format 270/320, prompts 56/191, start-prereview 49/62. Total 5.5k src plus 6.3k tests = 11.8k lines (54% of the package). `cli.ts:378-402` still exposes `launch`, `switch-model`, `autopilot`, `doctor`, `prereview`, `reply`, `snapshot`, `dashboard`, `watch`.
- Evidence that Claude-subagent waves replaced it: recent commits T-0757 "lead watch shows Claude-subagent tasks", T-0799 "lead batch: one combined check per wave", T-0840; autopilot not running and idle since 06:26; `memory: Batch waves since 10-09`. CLAUDE.md still instructs the autopilot flow, so the docs and the code disagree.
- What is still clearly used: `gate/` (784 src, 580 test) and `lead merge`, `lead batch` (871 plus merge 230), `status`, `spec-check`, `task-file`, `board`, `effect-map` (700 src, used by `effect-map.yml` CI), `smoke`, `xmpp-e2e`.
- Impact if the OpenCode path is retired: about 11.8k lines (about 54% of devtools, 5% of the repo's tooling-test cost) and the `ink`/`react` dependencies if `watch` goes (watch.ts is the only Ink user, UNVERIFIED by grep of all imports). Also `packages/agent-drivers/src/opencode-v2.ts` is a product feature (separate), keep.
- Risk: owner must say that workers will never return to OpenCode (Muse fallback logic, model-schedule). Recommend: keep two weeks with the autopilot disabled, then delete in one task each (autopilot+policy+decide+sweeper+processes; then switch-model+fallback+model-schedule+models; then client+session+fresh-session+doctor), CLAUDE.md updated in the same task. Effort: M, mechanical.

### F8. Formatter speed and scope
- Evidence: `format:check` is 22 s in CI (`ci.yml` static job, 47 s total with install) and about 109 s locally under load; `.prettierignore` already skips `work/`, `docs/`, `*.md`. Lint (oxlint, correctness only, `.oxlintrc.json`) takes 0.8 s.
- Recommendation: try `oxfmt` (same Rust toolchain as oxlint) or biome format on a branch and compare diff size; if diff is small the saving is about 15 to 20 s in CI and less in the worker gate. Keep prettier if the diff is large. UNVERIFIED that oxfmt matches the current output. Effort: S.

### F9. Turbo and cache setup
- Evidence: `turbo.json` has only `build` (with `outputs: dist/**`), `typecheck: {}`, `test: {}` with no `inputs` and no `outputs`; `globalDependencies` include the lockfile and tsconfig.base. CI caches `.turbo/cache` keyed by sha with a restore-key prefix, so a test task is a cache hit only if no input file in the package or its dependencies changed. Result: Test job `5 cached of 12`, i.e. server/web/mobile/runner/xmpp-core always rerun after any commit touching `protocol`.
- Recommendation: leave as is, it is correct and conservative. A cheap improvement is adding `"inputs": ["$TURBO_DEFAULT$", "!**/*.md"]` to `test` so docs inside packages do not bust it. Minor (S).

### F10. Housekeeping
- `zilar-night-log-2026-09-28.entries` is tracked in the repo root (`git ls-files` shows it); delete.
- `scripts/shots.ts` (133 lines) is imported only by `scripts/screenshots.ts` and `apps/web/src/shots.test.ts`; fine. `tools/brand-3d` has 28 MB textures plus 23 MB `out` and 29 MB `node_modules` on disk but only 10 tracked files (the rest is ignored). OK.
- `~/.zilar-lead/lead.log` is 30 MB and `.turbo` is 563 MB locally; add rotation to the lead logger (S) or ignore.
- `docs/` has historical roadmaps (`ROADMAP_M5.md`, `ROADMAP_MOBILE_PARITY.md`, `PUSH_SPIKE.md`, `LIVE_CHECKS_2026-09-29.md`) that likely belong in an archive folder; not in my area, flagged only.

## 4. Things that look bad but should stay

- `images.yml` smoke start of the server image before pushing (T-0739/T-0743 incident). It costs about 80 s but already caught a broken image reaching `:latest`. Keep it; only dedupe the build (F4).
- `images.yml` `tip` job and the `work/**, docs/**, **/*.md` path filter on CI: they stop stale or docs-only commits from publishing; they came from real incidents (T-0750, T-0754, T-0774).
- Per-test fresh PGlite via a snapshot (`src/effect/sql.ts:115-131`): slow in bulk but gives true isolation and no Docker in CI; do not replace with a Postgres service container.
- `pnpm deploy --prod --legacy` in the server Dockerfile: the workspace does not use injected deps, and the comment explains why; fine.
- TypeScript 7.0.2 native `tsc`: no further tsgo work needed; typecheck is already seconds.
- Four parallel CI jobs for static/typecheck/test/build: static, typecheck and build finish within 50 s, so merging them would save install time only; do not bother, the critical path is `test`.
- The arm64/QEMU leg only on version tags: correct after the 3h18m hang.

## 5. Open questions for the owner

1. Are OpenCode-driven workers retired for good? If yes, approve removing about 11.8k lines of lead autopilot code (F7) and rewriting CLAUDE.md's "First actions" section, which still tells new sessions to start the autopilot.
2. Is a bundled server acceptable (source maps instead of live TypeScript stack traces in production logs)? If yes, F3 plus F5 give the biggest runtime and image win.
3. Should `deploy/tests/*.test.sh` run in CI, or are they retired (F6)?
4. Is CI time worth more engineering (F1 plus F2 target about 5 min), or is 11 min per push acceptable given the images and deploy follow it (images add about 3.5 min, so merge to live is about 15 min today, about 8 min after F1 and F4)?
5. Image sizes need a Docker daemon or GHCR read scope to measure; can I get either for a follow-up measurement?
