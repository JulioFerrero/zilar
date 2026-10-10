# F-tests: audit of the test suites

## 1. Summary

- Test time is a server problem. CI job "Test" took 10m47s (`pnpm test` step, run 37972033759, 2026-10-09); Typecheck, Lint and Build jobs took 30 s each. Locally, server = 189 s wall, web = 16 s, mobile = 16 s, devtools = 11 s, xmpp-core = 2 s. Server is 91% test time (not import) and 97% of that is the 85 files that build a PGlite database (1,022 ms average per test, against 61 ms per test in files without a database).
- Slow tail: 173 of 2,299 server tests take more than 2 s and hold 47% of all server test time (724 of 1,555 CPU-s). Top 20 files = 49%. `agents/gateway.test.ts` alone is 100 s on one worker (168 tests, 7,242 lines), so it is the critical path.
- Cheapest big win: the migrated-DB snapshot (`apps/server/src/test-support.ts:285-300`) lives in module state, and vitest isolates modules per file, so the 47 migrations are re-run and a 40 MB snapshot re-dumped once per DB file (about 85 times), not once per run. A `globalSetup` that writes it once is the fix (estimate 5-10% of server CPU, UNVERIFIED).
- Duplication is real but smaller than the 195k suggests: about 7-9k lines (4%) are removable without losing behaviour. Biggest pieces: 8 byte-identical `fakeCore` plus about 25 near-identical `fakeApi` in mobile and web store tests (about 2.5k lines), about 38 `seedAi` / 15 `seedGroup` / 10 `seedUser` copies in server tests with 468 raw `INSERT INTO` lines (about 1.5-2k), 80 `jsonResponse` helpers (about 560), 7.9k lines of `vi.mock` in mobile/web with about 1k lines of identical native-module mocks.
- Flaky pattern: `flush`/`settle` helpers are defined 40+ different ways (5 microtask ticks in some, 2x `setTimeout(0)` in others) and awaited 484 times. Today's red CI came from exactly this (T-0842, commit 30e1c38a). One shared `flush`/`waitFor` and a lint rule on `setTimeout(resolve, 0)` would remove the class.
- Source-pinning tests (read `.ts/.tsx/.css` as text): 19 files. 10 pin component source strings in mobile (about 1.3k lines) and will break on any refactor; 4 are legitimate drift/lint guards (tokens-drift x2, no-legacy-name, native-pitfalls, pwa). List in finding 7.
- web (jsdom + vmThreads) and mobile (react-dom/server, node env) are already cheap. Do not spend effort on environment choice there.

## 2. Measurements

Caveat: other auditors ran heavy jobs on this 11-core machine (load average 15-26 during the server run), so absolute times are inflated and the per-test average is high. Ratios and ordering hold. A first server attempt without `--testTimeout=30000` and run in parallel with other audit jobs was killed after 12 minutes with two workers at 99% CPU; cause UNVERIFIED (likely contention). The second run passed in 190 s.

| Package | Files | Tests | Test lines | Wall | Notes |
|---|---|---|---|---|---|
| apps/server | 162 | 2,299 (2,289 passed, 10 skipped by `skipIf`) | 70.8k | 188.9 s | tests 91%, import 8%; sum of test time 1,555 CPU-s |
| apps/web | 185 | 1,943 | 41.7k | 16.3 s | tests 61%, import 19%; p50 test 10 ms |
| apps/mobile | 298 | 2,762 | 59.9k | 16.1 s | import 48%, tests 24%, environment 15% |
| packages/devtools | 35 | 799 | 10.9k | 11 s | `lead/merge.test.ts` = 10.4 s of it (17 tests, 610 ms each) |
| packages/xmpp-core | 15 | 249 (4 skipped) | 5.7k | 2 s | integration files skip without infra |

Commands: `pnpm exec vitest run --reporter=json --outputFile=<scratch>/<pkg>.json --reporter=verbose` in each package, analysed with `<scratch>/an.mjs`. CI step times from `gh run view 37972033759 --json jobs`.

Server per file (CPU-s, tests): gateway.test.ts 100.4 (168), search.test.ts 72.9 (27), files/routes.test.ts 54.1 (14), groups.test.ts 48.7 (56), ais/routes.test.ts 43.2, actions/gateway.test.ts 40.1, media/routes.test.ts 36.3 (10), tools/service.test.ts 35.6, topics.test.ts 34.7, stickers/favorites.test.ts 33.7 (12), memory/indexer.test.ts 31.3 (10), sandbox/run-tool.test.ts 31.1, db/migrate.test.ts 29.5. By dir: agents 209 s, approvals 99, stickers 82, actions 74.

Server per test: p50 506 ms, p90 1,020 ms, p99 5.3 s; tests over 2 s: 173 (724 s), over 5 s: 35 (227 s). DB-backed files: 85 files, 1,471 tests, 1,022 ms average, 1,504 s. Non-DB files: 77 files, 828 tests, 61 ms average, 51 s.

DB fixture cost (scratch scripts, load about 15-20): bare `new PGlite()` 490 ms (cold 1.9 s); restore from snapshot about 90 ms for an empty database, `createTestContext` plus ready 128 ms and close about 125 ms for the migrated one; `testApp` 5 ms; `bootstrapUser` 7-10 ms (OTP sign-in, no password hashing). So the fixed floor per DB test is about 250 ms; the rest of the 1 s is the test's own seeding and requests (under load).

Counts (all packages, 745 test files, 195,848 lines):
- `vi.mock(` calls: 1,430 in 184 files (7,944 lines in mobile+web). Top: react-native 120 files (85 distinct bodies), `@/components/ui/text` 102, nativewind 87 (69 identical), lucide-react-native 80, safe-area-context 61 (37 identical), reanimated 49 (41 identical).
- `jsonResponse` helper definitions: 80 (two signatures: `(body, status)` x39, `(status, body)` x37).
- `useFakeTimers`: 95 uses in 48 files; TestClock: 4 uses in 1 file; real `setTimeout` sleeps: 178 in 102 files; `setTimeout(...,0)`/setImmediate/nextTick flushes: 79 in 51 files; `waitFor(`: 857 in 97 files; `await flush()/settle()`: 484 (realStore.test.tsx 93, mobile real-store.test.ts 34, prefs-pins 25, xmpp-core core.test.ts 24).
- Raw `INSERT INTO` in server tests: 468 lines in 60 files; `INSERT INTO ais` 43, `groups` 37, `group_members` 45, `provider_connections` 47, `topics` 51. No server test imports `db/rows.ts`.
- `createTestContext` called in `beforeEach` in all 82 callers; none uses `beforeAll`.
- Tests with no DOM still run under jsdom in web: 46 pure `.test.ts` files.

## 3. Findings (highest value / effort first)

### F1. Build the migrated DB snapshot once per run, not once per file
Evidence: `apps/server/src/test-support.ts:285-300` keeps `migratedSnapshot` in a module variable; vitest default isolation reloads the module for each of the 85 DB files, so each file re-runs 47 migrations (`apps/server/drizzle`, 47 entries) and dumps a 40 MB blob (`dumpDataDir('none')` measured 40,391,680 bytes for an empty DB). First `createTestContext` in a process took 987 ms vs 2 ms after.
Impact: about 1 s x 85 files = 85 CPU-s of 1,555 (5%); also removes 40 MB of per-worker memory churn. UNVERIFIED until measured on a quiet machine.
Risk: low. A `globalSetup` writes the snapshot to a temp file once; `freshDatabase` reads it. Detect: full server suite stays green, `db/migrate.test.ts` unchanged (it tests migrations separately).
Effort: S (half a day). Recommendation: do first.

### F2. Cut the 35 server tests over 5 s (227 CPU-s) and the loop-driven ones
Evidence: `files/routes.test.ts` "answers 429 after 600 requests a minute" does 600 real requests (10.5 s); `stickers/favorites.test.ts:201-226` uploads 200 stickers over HTTP in three tests (7-8 s each); `memory/tree.test.ts` "cover covers [0,total) exactly" 10.3 s; `search/search.test.ts` 9.4 s; `topics.test.ts` "creates a General topic" 7.2 s; several others at 6-8 s are first tests of a file (they pay cold imports plus the snapshot from F1).
Impact: roughly 100-150 CPU-s (7-10%) if the loops move to direct SQL seeding or inject a lower limit (the limiter is already injectable: `uploadLimiter: { allow: () => true }` at favorites.test.ts:211; add a `limit` option for the files limiter).
Risk: low; each test keeps asserting the same boundary (cap 200, 429 at 600) with a smaller constant or a seeded state.
Effort: S-M (1-2 days for the top 15).

### F3. Split `agents/gateway.test.ts` and extract its harness
Evidence: 7,242 lines, 168 tests, 21 describes, 100 s on one worker (53% of the `agents` dir at 209 s). One 100 s file bounds wall time on any runner with spare cores, and on a 2-4 core CI runner it makes scheduling uneven. Its describes are independent: groups 2939-4380 (1,440 lines), topics 5118-5724, persona tools 1631-1938, request_action 2295-2650, kill switch 4380-4668, listener 5724-end. Lines 1-434 are a private harness (`FakeCore` implementing `XmppCore`, `FakeLitellm`, `seedAi`, `jsonResponse`, `waitFor`); the same `FakeLitellm` is redefined in `ais/service.test.ts`, `ais/routes.test.ts`, `ais/usage.test.ts`.
Impact: no lines removed by itself, but 100 s becomes 6-8 files of 10-20 s; `actions/gateway.test.ts` (1,931), `ais/routes.test.ts` (2,412), `groups.test.ts` (1,920) are next. Pairs with F4.
Risk: low (move-only). Detect: test count identical before and after (168).
Effort: M (1-2 days, mechanical, good for one worker per file).

### F4. One shared server seed module and fakes (`apps/server/src/test-support.ts` or `test-seed.ts`)
Evidence: `seedAi` defined in about 38 test files (e.g. `tools/service.test.ts:74-87`, `approvals/service.test.ts`, `agents/gateway.test.ts:336`, `audit/service.test.ts`, `routines/service.test.ts`), `seedGroup` in about 15, `seedUser` in about 10, `FakeLitellm` in 4, `FakeProbe` in 2. Each writes raw SQL (`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status) ...`), so any column change hits 40+ files. `db/rows.ts` has row types but tests do not use them.
Impact: about 1,500-2,000 lines removed; a schema change touches one helper; fewer places for seed drift (some copies insert different defaults, e.g. `ai_limits` 1.00/20.00).
Risk: medium-low: copies differ in defaults, so the shared helper takes overrides; run the whole server suite. Do it per directory, one task per 5-6 files.
Effort: M (2-3 days).

### F5. Shared mobile and web store fakes
Evidence: mobile `real-store.*.test.ts` has 8 byte-identical `fakeCore` (md5 equal: prefs-pins:91, invite-links:41, groups-create:41, roles:106, general-only:81, channels:79, media:43, topics:83) plus `fakeAppState` x11, `fakeApi` x about 25 (`real-store.forward.test.ts:103`, `attachments:75`, `roles:75`, ...). Web: `fakeApi` is 159 lines in both `realStore.test.tsx:205` and `realStore.forward.test.tsx:130`, 151 in `realStore.media.test.tsx:59`; `fakeXmpp` 62/63/26 lines. `web/src/test/` has only `setup.ts` and `renderApp.tsx`; mobile has no shared test dir.
Impact: about 2,000-2,500 lines; real-store.test.ts (2,498) and realStore.test.tsx (4,133) can then be split by feature without copying a harness.
Risk: low; helpers are pure. Detect: suites green.
Effort: M (2 days; one task for mobile, one for web).

### F6. Mobile native-module mocks in a setup file or aliases
Evidence: `apps/mobile/vitest.config.mts` only sets the `@` alias ("native primitives stay mocked per test"). 1,417 `vi.mock` calls / 7,944 lines in mobile+web; `nativewind` mock identical in 69 of 87 files, `react-native-reanimated` 41 of 49, `safe-area-context` 37 of 61, `@/components/ui/text` 39 of 102. `react-native` is hand-mocked 120 times with 85 different bodies, so tests drift apart and each new test re-invents a `View: 'div'`.
Impact: about 1,000-1,500 lines; also less import work (mobile import = 48% of its 16 s). Put the common stubs in a `setupFiles` entry (`vi.mock` works in setup files) or alias them with `resolve.alias` to `src/test/stubs/*.tsx`; files with special needs keep a local `vi.mock`.
Risk: medium: the 85 `react-native` variants differ, so migrate only the 37-69 identical ones first. Detect: any snapshot/markup diff fails the test.
Effort: M (2 days).

### F7. Source-pinning tests: remove or replace the brittle ones
Evidence (tests that read repo source as text):
- Brittle, pin component source strings (about 1,300 lines): `apps/mobile/src/components/chat/composer-layout.test.ts` (57 lines, 12 `toContain` on `composer.tsx`, `voice-recorder.tsx`, `[id].tsx`), `attach-sheet.test.tsx:94` (16), `attachment-message.test.tsx:178` (28), `attachment-video.test.tsx:152`, `composer-gifs.test.tsx:135`, `gif-panel.test.tsx:237,250` (`expect(panel).toContain('loadingMoreRef')`), `group-roles-mounted.test.tsx:152,165`, `search-jump.test.ts:84`, `lib/hooks-guard.test.ts:47-66` (reads `app/chat/[id].tsx` and asserts a `key={composerOpen ? 'open' : 'closed'}` string). The file header says why: "The mobile app has no React Native testing library, so each rule is pinned in the source". They fail on rename or reformat and prove nothing about behaviour.
- Style/scan guards, keep but consider lint: `mobile/.../no-solid-pill.test.ts:141`, `web/.../no-accent-pill.test.ts:111` (could be oxlint custom rules or a grep), `mobile/lib/gradient-swap.test.ts:28`, `native-pitfalls.test.ts:51,74` (Kotlin/Hermes scan; legitimate).
- Legitimate drift guards, keep: `web/lib/tokens-drift.test.ts:22`, `mobile/lib/tokens-drift.test.ts:13` (CSS vs ui-tokens), `web/lib/pwa.test.ts` (manifest/index.html), `devtools/no-legacy-name.test.ts:51` (runs `git ls-files` and reads every tracked file; 0.4 s; fine but it is a lint, a CI grep would be cheaper and not block `vitest` runs in worktrees).
- Data reads, fine: `topics/backfill.test.ts:24`, `approvals/topic-scope-backfill.test.ts:26` read `drizzle/*.sql`.
Impact: delete or convert about 600-900 lines. `hooks-guard` is covered by enabling oxlint `react-hooks/rules-of-hooks` (check `.oxlintrc` first; UNVERIFIED that it is on). Others become render tests: mobile already renders with `react-dom/server` in 65 files, so layout rules like `behavior="padding"` can be asserted on the rendered props.
Risk: medium: these were written for real device bugs (2026-10-03 Android layout). Keep a one-line behaviour assertion per rule when converting.
Effort: M (1-2 days); do it when the area is refactored anyway.

### F8. One `flush` / `waitFor` / `jsonResponse` per package; ban one-tick waits
Evidence: `async function flush()` x24, `settle()` x15, `waitFor` x13+, `flushUntil` x3, `sleep` x5 — with different semantics: five `await Promise.resolve()` ticks in some, two `await new Promise(r => setTimeout(r, 0))` in others, ten-millisecond polling loops in `agents/gateway.test.ts:420-431`. 484 `await flush()/settle()` calls rely on "one tick is enough", which is what made CI red today: commit 30e1c38a (T-0842) had to change `expect(screen.getByText('Slide to cancel'))` to `await screen.findByText(...)` in `Composer.voice.test.tsx` and `MessageSearchResults.test.tsx`. Fixed-time real sleeps remain: `Composer.voice.test.tsx:246,273` (500 ms), `realStore.topics.test.tsx` 10x 600 ms (lines 320, 337, 384, 572-634), `realStore.test.tsx:372`, `ChatList.test.tsx` connecting bars (1.5 s each), `TypingIndicator.test.tsx` (0.8 s), `server main.test.ts:154-179`, `agents/integration.test.ts:360` (3 s, infra-gated). 95 uses of fake timers already show the pattern works here; `apps/web/src/store/effects/runtime.test.ts` uses `vi.advanceTimersByTimeAsync` correctly.
Impact: about 250-400 lines for helpers/jsonResponse (80 copies x 7 lines = 560) plus about 15 s of real sleeps in web (5% of web wall). Main value is stability.
Risk: low. Add one lint rule (oxlint `no-restricted-syntax`-style or a test that greps) for `setTimeout(resolve, 0)` and fixed sleeps in tests.
Effort: S-M (1-2 days).

### F9. Near-duplicate web and mobile `lib/effect` tests
Evidence: `use-action.test.tsx` 308 vs 371 lines, `use-query.test.tsx` 168 vs 243, `effects/runtime.test.ts` 86 vs 72, `api-effect.test.ts` 63 vs 75, `atomStore.test.ts` 85 vs 157, `ports.test.ts` 44 vs 38; diffs of 37-148 lines between pairs. The sources are parallel copies too (web `src/lib/effect/`, mobile `src/lib/effect/`).
Impact: about 850 test lines if the two hooks libraries move to one shared package (this is a source-level change; see the code audit).
Risk: medium (shared package, two runtimes). Effort: L. Only if the source dedup is approved.

### F10. Per-test PGlite lifetime
Evidence: 82 files call `createTestContext` in `beforeEach` (fresh PGlite plus close, about 250 ms floor measured). Some also open a second `new PGlite()` per test (`files/routes.test.ts:146`, cold boot 490 ms) for the archive.
Impact: up to 15-25% of server CPU if files could share one database per file with `TRUNCATE` or transaction rollback; the archive DB could use the snapshot approach too. UNVERIFIED and riskier: better-auth sessions, rate limiters and sequences leak state between tests, and `createApp` holds state.
Risk: high-ish; do for pure service tests first (no `createApp`), not for route tests.
Effort: L. Rank after F1-F5; measure on a quiet machine before committing.

### F11. Smaller items
- Web: 46 pure `.test.ts` files run in jsdom; add `// @vitest-environment node` to them (web `import` + environment = 25% of the 16 s). Gain under 1-2 s; only worth it as part of other edits.
- CI shape: one job runs `pnpm test` for all packages (`.github/workflows/ci.yml:71-96`), and server dominates. Add `vitest --shard` for server (2 shards) in a matrix, or run server tests in their own job; wall time follows the slowest job. Turbo `test` has no inputs/outputs (`turbo.json`), so cache key is every file in the package; fine.
- `packages/devtools/src/lead/merge.test.ts`: 10.4 s for 17 tests (610 ms each, real git). Not on the product path; leave unless gate time matters.
- `skipIf` integration tests (`agents/integration.test.ts`, `ais/integration.test.ts`, xmpp-core integration x4, `push/live-gate.test.ts`, `voice/engine.test.ts`) never run in CI (no infra); 10+ tests of unknown health. See open questions.
- 313 test names carry `(T-xxxx)` task tags; harmless, but they do not describe behaviour. Optional rename when files are touched.

## 4. Things that look bad but should stay

- `createTestContext` snapshot approach (`test-support.ts:285`): restoring from a data-dir snapshot (about 90-130 ms) is much cheaper than migrating 47 files per test. Keep; only move the cache out of module state (F1).
- PGlite instead of a Docker Postgres in the default suite: no infra needed, matches `effect/sql` behaviour; the real-Postgres tests (`sql-adapter.pg.test.ts`) are correctly opt-in.
- web `pool: 'vmThreads'` with jsdom (`apps/web/vite.config.ts:27`) and the 15 s test timeout: documented, measured (T-0036), and web is 16 s total.
- mobile tests using `react-dom/server` with mocked native primitives: fast (16 s for 2,762 tests). Do not replace with a React Native renderer.
- The 11k lines of devtools tests: tooling for the lead/worker loop, 799 tests in 11 s, mostly pure functions (`policy.test.ts` 206 tests in under 0.1 s).
- Large behaviour files such as `xmpp-core/stanza.test.ts` (1,342 lines, 77 tests, 0.1 s): long but pure and fast; no reason to touch.
- `no-legacy-name.test.ts`, tokens-drift and pwa tests: real cross-file invariants, cheap.
- 10 `.effect.test.ts` siblings next to `.test.ts` (e.g. `config.effect.test.ts` 98 vs 809 lines): small, test the Effect entry point separately; merging would give no saving.

## 5. Open questions for the owner

1. Is a 10-minute CI Test job a problem for you, or only the worker/gate time? That decides if sharding (F11) or file splitting (F3) comes first.
2. Do the opt-in integration tests (real XMPP, LiteLLM, Postgres) still run anywhere? If not, delete or run them nightly; they rot silently.
3. May a worker replace the mobile source-pinning tests (F7) with render assertions, accepting a short window of lower coverage on the Android layout rules?
4. Is oxlint `react-hooks/rules-of-hooks` enabled? If yes, `hooks-guard.test.ts` can go.
5. Should web and mobile `lib/effect` merge into a shared package (F9)? It is a source decision, not a test one.
