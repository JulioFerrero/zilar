# G: Dead code, unused dependencies, clones (tool-measured, hand-verified)

## 1. Summary

- The repo is cleaner than expected. No zod/drizzle/hono/zustand dependency or import remains in any source file (only the devtools classifier's test fixtures mention them). "galena" appears in code once (`apps/server/src/kdf-labels.ts`, intentional). Commented-out code is about 6 lines. 21 TODO/FIXME in non-test code.
- Confirmed dead files (zero importers, not even tests): `apps/mobile/src/components/chat/use-invites-api.ts` (38) plus its only dependency `apps/mobile/src/mock/invites.ts` (21), `apps/server/src/auth/session.ts` (18, `requireSession*` have no callers), `apps/mobile/src/lib/protocol.ts` (4, used only by its own test). About 81 lines with tests. Small.
- 41 exported declarations are referenced nowhere in the repo (about 202 lines, list in section 3 F2). 756 more exports are used only inside their own file (drop the `export`, no line savings). 521 exports are used only by tests (about 7,500 lines of declarations, mostly legitimate test seams).
- Bigger but UNCERTAIN: `apps/server/src/git/*` (proxy, 454 src lines plus 447 test lines) is not mounted in `app.ts`/`main.ts` (its own header says so). `apps/server/src/effect/logger.ts` + `runtime.ts` (131 src plus 282 test lines) have no production importer.
- Dependencies: no truly unused package found. Knip's 7 reports are all false positives or very likely so (verified one by one, section 2). 6 packages are declared at different versions across workspaces (effect `^4.0.2` vs `^4.0.0`, react 19.2.3 vs ^19.3.0, tailwindcss 3 vs 4, typescript 7.0.2 vs 6.0.2 alias); 10 packages repeat the same version in 2-3 workspaces (no pnpm catalog).
- Clones (jscpd, min 60 tokens / 8 lines): src 338 clones, 5,082 dup lines (2.6%), of which 73 clones / 1,429 lines cross the web/mobile/server/chat-core boundary. Whole files copied between web and mobile: `routines-format.ts`/`routines.ts` (130), `ais/limits.ts` (61), `ais/templates.ts` (45), `ais/form.ts`/`aiForm.ts` (40), `atomStore.ts` (59), `effect/use-action.ts` (76), `lib/attachments.ts` (35), `chatPrefs` (102), `tools` (53). `apps/server/src/chat-folders/service.ts:17-46` duplicates `packages/chat-core/src/folders.ts:5-34`. Tests: 776 clones, 14,734 dup lines (9.2%).
- Test-only waste: 25 `*.effect.test.ts` files sit beside the old `*.test.ts` for the same module (2,260 lines next to 9,334 lines), left over from the Effect migration. Probable overlap, UNVERIFIED how much.
- Production web bundle ships the full mock backend: `apps/web/src/lib/api.ts:4-5` statically imports `@/mock/api` (4,297 lines; mock dir is 205 KB source) into the single 1.4 MB JS chunk (412 KB gzip). Confirmed by finding `mock-gif-1`, `conn-mock` strings in `apps/web/dist/assets/index-*.js`.
- `apps/server/drizzle/meta/` holds 47 drizzle-kit snapshot files (3.7 MB, git-tracked); no code reads them (drizzle-kit is gone).
- Removable lines I am confident about: about 280 source lines (dead files plus dead declarations) plus about 50 test lines, plus 3.7 MB of snapshots, plus 66 stale "drizzle" comment lines to reword. Uncertain: about 900 (git proxy, with tests) plus about 410 (logger/runtime) plus 1,400 to 2,500 via sharing cross-app code, plus test dedup of several thousand lines.

## 2. Measurements

| What | Command / tool | Result |
| --- | --- | --- |
| knip default config | `pnpm dlx knip@5 --reporter json` (repo root) | exit 1; it treated all 300 test files as unused files (vitest plugin did not register them) and listed 767 exports + 581 types. Not trustworthy as is; used only for dependency lists. |
| knip production | `--production --config <scratch>/knip.prod.json` (entries I wrote per workspace; saved in scratch dir) | 38 unused files, 1,083 exports, 670 types, deps listed below |
| Export verification | my script `exp.cjs`: for each knip export, count word matches in every tracked ts/tsx/js/json/md file outside `work/` and `docs/` | 1,753 candidates: 797 referenced nowhere else (756 still used in their own file, 41 fully dead), 521 used only in tests, 435 used elsewhere (knip false positives from barrel or re-export usage) |
| Size of fully dead declarations | `dead.cjs` (bracket matching incl. JSDoc) | 41 declarations, 202 lines (server 112, mobile 64, web 15, devtools 8, runner-tunnel 3) |
| jscpd src | `pnpm dlx jscpd@4 apps packages --min-tokens 60 --min-lines 8 --ignore tests,node_modules,dist,ios` | 1,148 files, 195,771 lines, 338 clones, 5,082 dup lines (2.6%); 73 clones (1,429 lines) cross app/package |
| jscpd tests | same with `--pattern **/*.test.{ts,tsx}` | 802 files, 159,916 lines, 776 clones, 14,734 dup lines (9.21%); 33 cross-app (1,044 lines) |
| Legacy deps | grep package.json files for zod/drizzle/hono/zustand | none |
| Legacy imports | `git ls-files` + grep `from 'zod\|hono\|zustand\|drizzle'` | only `packages/devtools/src/effect-map/generate.test.ts` fixtures |
| "drizzle" in code | grep | 66 hits in 19 non-test files, all comments (e.g. `apps/server/src/contacts/service.ts:4-5` still says "modules still on drizzle", `auth/invite-cli.ts:91` "closing the drizzle client") |
| "galena" | grep in tracked code/config | 1 file (`apps/server/src/kdf-labels.ts`, 2 hits; KDF labels intentionally keep old text per project notes) |
| Commented-out code | regex for 3+ consecutive commented statements over 907 non-test src files | 2 blocks, 6 lines (both are doc-comment examples in `use-action.ts`) |
| Env flags | grep `process.env`/`import.meta.env` | no stale-looking flags; `ZILAR_PUSH_GATE`, `ZILAR_XMPP_SM_*`, `*_INTEGRATION` are test switches. The mock flag is documented in F6. |

### Dependency verification (knip output checked by hand)

| Knip says unused | Verdict |
| --- | --- |
| mobile `tailwindcss-animate` | FALSE POSITIVE: `apps/mobile/tailwind.config.js:92` `require('tailwindcss-animate')` |
| web `tw-animate-css` | FALSE POSITIVE: `apps/web/src/index.css:2` `@import 'tw-animate-css'` |
| mobile `expo-modules-core` | FALSE POSITIVE: imported by `modules/zilar-whistle/src/ZilarWhistleModule.ts:4` (knip does not see the local module) |
| mobile `react-native-css-interop` | probably a deliberate pin: nativewind 4.2.7 peer (`babel.config.js` uses `nativewind/babel`). UNVERIFIED that removal is safe. |
| mobile dev `@babel/core`, `@babel/plugin-transform-react-jsx` | `babel.config.js` uses only `babel-preset-expo` and `nativewind/babel`; both are peers of those presets. Probably pins, UNVERIFIED. |
| server dev `pino-pretty` | FALSE POSITIVE: `apps/server/src/logger.ts:39` transport target string (dev only; Dockerfile:66 says deliberately not installed in the image) |
| runner `@zilar/runner-tunnel`, `effect` | FALSE POSITIVE (my config missed the `src/cli.ts` entry; `start` script runs it) |
| `expo-updates` unlisted (app.json) | not a code import; check the Expo plugin config, UNVERIFIED |
| `effect` unlisted in `scripts/screenshots.ts` | file header says dev script, resolves via workspace packages; fine |

Other knip "unused file" reports that are false positives: `apps/runner/src/*` (cli entry), `apps/mobile/modules/zilar-whistle/src/*` (imported as `zilar-whistle/src/...` by `whistle-port.ts:105`, `whistle-last-voice.ts:16` and tests), `packages/devtools/src/{smoke,smoke-lib,xmpp-e2e}.ts` and `effect-map/ratchet-cli.ts` (package.json scripts and `gate/plan.ts:252`), `packages/runner-tunnel/src/demo.ts` (script `demo`), `deploy/scripts/healthcheck.mjs`, `tools/brand-3d/main.js`, `apps/mobile/metro.config.js`, `xmpp-node-stubs/empty.js`, `apps/web/src/test/{setup,renderApp}`, `server/src/test-support.ts` and `push/test-tables.ts` (test helpers), `lib/hooks-guard.ts` and `lib/native-pitfalls-scan.ts` (used by repo-scanning tests). Test-only helpers kept in src: `packages/agent-drivers/src/fake-opencode-server.ts`, `runner-tunnel/src/test-harness.ts`.

## 3. Findings (ranked by value / effort)

### F1. Remove confirmed dead files
- Evidence: `apps/mobile/src/components/chat/use-invites-api.ts` (38 lines) has no importer; grep for `use-invites-api`/`useInvitesApi` finds only itself. Its only consumer of `apps/mobile/src/mock/invites.ts` (21, `createMockInvitesApi`). `invite-sheet.tsx:33` takes `api: InvitesApi` as a prop instead. `apps/server/src/auth/session.ts` (18): `requireSessionEffect`/`requireSession` have no callers (hits are comments in `effect/http-core.ts:36`, `gifs/api.ts:10`, `push/api.ts:10`). `apps/mobile/src/lib/protocol.ts` (4) + `protocol.test.ts` are a self-contained pair with no app use.
- Impact: about 81 lines, about 100 with the test. Risk: low (typecheck + tests catch any importer; mobile screenshots scripts use dynamic paths? grep found none). Effort: S (under 1 hour).
- Recommendation: delete the five files, one task, run `pnpm gate`.

### F2. Delete 41 declarations that nothing references; drop `export` on 756 more
- Evidence: list in `<scratch>/dead.json` (fields file, line, name, lines). Largest: `apps/server/src/handles/store.ts:46 findHandle`, `:70 handleUserIdFor`, `:365 displayNameFor`, `:380 isHandleChangeTooSoon` (54 lines), `apps/mobile/src/store/real-store.ts:109 isUpdateStanza` (14), `apps/server/src/effect/sql.ts:50 SqlLive` (14), `apps/server/src/topics/access.ts:164 canSeeTopicById` (12), `apps/mobile/src/lib/depth.ts:47,53 TEXT_SHADOW_*` (10), `apps/mobile/src/components/{connections,machines}/*-mock.ts reset*Mock` (16), `apps/web/src/lib/api.ts:728 listTopicApprovalRules`, `apps/web/src/lib/push.ts:128 currentSubscription`. Name-based matching can only under-report dead code (a name clash hides a dead export), never over-report; check each by `git grep -w name` before deleting.
- Impact: about 200 lines; also stops 756 needless exports polluting the API surface. Risk: low. Effort: S-M (a worker can do it in 2-3 chunks by package).
- Recommendation: per-package tasks, delete only those with zero grep hits. Do not mass-unexport; add knip (production config in scratch folder is a starting point) to the gate later only if an owner wants the check enforced.

### F3. Unmounted git proxy and unused server Effect runtime/logger (UNCERTAIN, owner decision)
- Evidence: `apps/server/src/git/api.ts:1-9` header: "Not mounted in `app.ts`: the edge matcher has no wildcard routes ... the handler is only driven by tests until a wildcard mount exists." `git/{api,branches,proxy,token}.ts` = 450 lines, tests 447. `effect/logger.ts` (92) and `effect/runtime.ts` (39) are imported only by their tests (`main.ts:58` imports `./logger`, a different file).
- Impact: up to about 900 + 410 lines incl. tests. Risk: medium; this may be planned feature work (git proxy for desks) and deleting loses a finished, tested design (it stays in git history). Effort: S to delete.
- Recommendation: ask the owner whether the git proxy ships soon; if not in the next few weeks, delete and note the commit hash in the roadmap. Delete `effect/runtime.ts` + `logger.ts` now unless the planned server runtime wiring needs them.

### F4. Cross-app copy/paste: same code in web and mobile (and server vs chat-core)
- Evidence (jscpd, src only): `apps/mobile/src/lib/routines-format.ts:7-136` = `apps/web/src/lib/routines.ts:6-135` (130 lines, identical); `apps/mobile/src/components/ais/limits.ts:1-61` = `apps/web/src/components/ais/limits.ts:1-61`; `ais/templates.ts:5-49` identical on both; `ais/form.ts:17-56` vs `web/.../aiForm.ts:24-63`; `store/atomStore.ts:23-81` vs `web/store/atomStore.ts:15-73`; `lib/effect/use-action.ts:40-114` vs web `use-action.ts:39-113` (76); `lib/attachments.ts:64-98` vs `web/lib/attachments.ts:43-77`; `lib/chat-prefs.ts` vs `web/lib/chatPrefs.ts` (102, 6 clones); `mobile tools-api.ts:168` vs `web/lib/tools.ts:14` (53); `apps/server/src/chat-folders/service.ts:17-46` vs `packages/chat-core/src/folders.ts:5-34` (30). Test copies follow: `use-action.test.tsx`, `use-query.test.tsx` (157), both app copies.
- Root cause: apps were built in parallel by separate workers, and `packages/chat-core` is the only shared logic package, so a worker adding a pure helper had no obvious home for it. 73 clones / 1,429 src lines + 33 clones / 1,044 test lines cross boundaries.
- Impact: about 600 to 900 lines (the pure files) removable by moving them to `packages/chat-core` (or a new `packages/app-core`), more if hooks (`use-action`, `use-query`, `atomStore`) are shared via a platform-neutral package. Risk: low for pure files (identical text); medium for hooks (React Native vs DOM test setups). Detect with both apps' tests. Effort: M (2-3 days as 4-5 tasks).
- Recommendation: first the byte-identical pure modules (routines, limits, templates, chat-prefs, attachments helpers, tools constants, folders), then `use-action`/`use-query`/`atomStore` with their tests moved once. Keep platform code (components) separate.

### F5. Intra-app clones worth a helper
- `apps/web/src/components/ChatListItem.tsx:82-171` vs `TopicRow.tsx:80-165` (151 lines in 3 clones); mobile `chat-list-item.tsx:2-17` vs `topic-row.tsx:3-18` (73 lines, 4 clones) and their tests (131 lines). `apps/mobile/src/app/settings/blocked.tsx:105-137` vs `requests.tsx:115-149` (68). `apps/mobile/src/app/settings/integrations.tsx:329-347` vs `:459-477` (83, 5 clones, same file). `apps/web/.../MessageBubble.tsx:573-610` vs `:629-663` (109, 4 clones, same file). Server: `avatars/api.ts:213-225` vs `voice/api.ts:141-153` (52), `contact-requests/api.ts:144-160` vs `directory/api.ts:103-119` (51), `machines/api.ts:336-350` vs `:372-383` (43), `agents/gateway/dm-turn.ts:44-52` vs `group-turn.ts:82-92` (44).
- Impact: roughly 500 to 700 lines. Risk: medium for UI (visual regression), low for server `api.ts` (shared handler wrapper or response mapper). Effort: M.
- Recommendation: take server API helpers and the web/mobile row components first; do not touch same-file clones inside the large `MessageBubble` without a screenshot check.

### F6. Mock backend ships in the production web bundle
- Evidence: `apps/web/src/lib/api.ts:4-5` imports `isMockApiEnabled` and `mockRequest` statically; `apps/web/src/mock/` is 6,308 non-test lines (`api.ts` 4,297, 205 KB of source), plus `store/mockStore.ts` (1,294). `apps/web/dist/assets/index-*.js` is a single 1,437,399 byte chunk (412,149 gzip) containing `mock-gif-1`, `conn-mock`. The gate `resolveMockMode` (`mock/gate.ts`) is false in production, so the code is dead at runtime. `mode === 'test'` is also true by design. Mobile has the same pattern (`src/mock` 2,973 lines plus `*-mock.ts` 1,149 lines).
- Impact: bundle bytes (not repo lines). Estimate 30-60 KB gzip off the first load, UNVERIFIED (needs a build with the mock behind `import()`); no repo lines saved. Risk: low if the dynamic `import('@/mock/api')` is only taken when `isMockApiEnabled()` is true; test mode keeps working since vitest resolves dynamic imports. Effort: S-M.
- Recommendation: make `mockRequest` a dynamic import behind `isMockApiEnabled()` (or `import.meta.env.DEV || VITE_MOCK` so Vite tree-shakes it), and check the bundle after. Ask the performance auditor to cross-check.

### F7. Leftover `drizzle` snapshots and stale comments
- Evidence: `apps/server/drizzle/meta/` 47 files, 3,755,485 bytes tracked; nothing in `apps/server/src` or `Dockerfile` reads `meta/` or `_journal` (only `deploy/zilar` refers to `drizzle/0013_audit_log_immutable.sql`, the SQL file). The project notes say new migrations are hand-written SQL run by `migrateSql`. 66 comment lines across 19 non-test files still describe drizzle (examples above).
- Impact: 3.7 MB off the checkout; comments become accurate. Risk: low for comments; for `meta/` confirm `migrateSql` globs only `*.sql` (UNVERIFIED, read `apps/server/src/db/` before deleting). Effort: S.
- Recommendation: delete `meta/` if `migrateSql` ignores it, keep the `.sql` files and the folder name (renaming would break `deploy/zilar` references and history), and reword the 19 files' comments in one low-risk task.

### F8. Parallel old/new test files from the Effect migration
- Evidence: 25 pairs `X.effect.test.ts` + `X.test.ts` (29 `*.effect.test.*` files in total; list in `<scratch>/effpairs.txt`), e.g. `apps/server/src/approvals/sweeper.effect.test.ts` vs `sweeper.test.ts` (jscpd: 111 duplicated lines, same first 17 lines); `apps/mobile/src/lib/ai-memory-api.effect.test.ts` + `.test.ts`, `audit-api.effect.test.ts`, `chat-api.effect.test.ts`. Combined 2,260 + 9,334 lines. Test suite has 9.2% duplicated lines vs 2.6% in src; the worst: `apps/web/src/components/ApprovalCard.test.tsx` (647 dup lines inside one file, 13 clones), `mobile use-action.test.tsx` vs web (297), `server routines/scheduler.test.ts` (199 in one file), `mobile settings-*-screen.test.tsx` pairs (about 700 across 6 pairs).
- Impact: unknown without reading the pairs; plausible 1,000 to 3,000 test lines through `it.each`/shared fixtures, plus faster test runs. Risk: low per file if coverage is compared; detect with `vitest --coverage` before and after. Effort: M-L.
- Recommendation: audit the 25 pairs first (merge `.effect` into the main file where the tests overlap), then extract fixtures for the 5 worst files above.

### F9. Dependency version alignment
- Evidence: `effect` `^4.0.2` in 6 packages and `^4.0.0` in runner, devtools, runner-tunnel; react/react-dom/@types/react `19.2.3` pinned in mobile vs `^19.3.0` in web, devtools; `tailwindcss` `^3.4.17` (mobile, NativeWind needs v3) vs `^4.3.3` (web); `typescript` `7.0.2` at root vs `npm:@typescript/typescript6@6.0.2` in mobile. Identical versions repeated: vitest x2, `@effect/atom-react` x2, better-auth x3, tsx x3, vite x2, clsx x2, cva x2, tailwind-merge x2, `@xmpp/client` x2, scheduler x2.
- Impact: no lines; fewer lockfile entries and one effect version resolved. Risk: low for effect (`^4.0.2` everywhere), expected for react/tailwind/typescript mismatches (keep, they are platform constraints). Effort: S.
- Recommendation: use a `catalog:` in `pnpm-workspace.yaml` for the 10 repeated packages and `effect`; leave react (Expo-pinned), tailwind (3 vs 4) and typescript alias alone.

## 4. Things that look bad but should stay

- knip's 300+ "unused" test files and the 38 unused-file report: tooling false positives (see section 2); do not act on knip output without the verification steps above.
- `apps/mobile/modules/zilar-whistle` (about 900 lines): local Expo module resolved through `"zilar-whistle": "file:./modules/zilar-whistle"` and imported from `whistle-port.ts:105`; live.
- `apps/runner` (2,738 lines incl. tests) looks orphaned from the server's point of view but is a CLI (`start` script) and its docs table lists it as merged (`docs/FEATURES.md:103`).
- `packages/devtools` scripts (`smoke.ts`, `xmpp-e2e.ts`, `lead/*`): package.json entry points.
- `lib/hooks-guard.ts`, `lib/native-pitfalls-scan.ts`, `whistle-last-voice.ts`: referenced only by tests, but those tests exist to guard source files (repo-scan tests); keep.
- 435 knip exports that I found used elsewhere, and the 521 test-only exports (about 7,500 declaration lines): normal test seams for the DI-style service files; removing the export would break tests for no gain.
- `pino-pretty`, `tailwindcss-animate`, `tw-animate-css`, `expo-modules-core`: used through config or string references.
- The `drizzle` folder name and the SQL files: still referenced by `deploy/zilar` (audit-log triggers) and by the migration runner.
- The Expo `main` field and `src/app` (expo-router file routes): entry points, not dead files.

## 5. Open questions for the owner

1. Will the git proxy (`apps/server/src/git`) be mounted soon (needs wildcard routes in `effect/edge.ts`)? If not, delete about 900 lines.
2. Is `apps/server/src/effect/runtime.ts` + `logger.ts` waiting for a planned wiring, or abandoned?
3. May the mock backend be loaded lazily (F6) or is `?mock=1` in a dev build the only supported use? Should mobile keep `EXPO_PUBLIC_ZILAR_MOCK` in release builds?
4. Should shared web/mobile pure logic move to `packages/chat-core` or a new package (F4)? The answer decides the target of about 700 lines of de-duplication.
5. OK to delete `apps/server/drizzle/meta/` (F7) after a check that `migrateSql` only reads `*.sql`?
6. Keep the 25 `*.effect.test.ts` pairs as a permanent split, or merge them (F8)?
