# Simplify plan status (T-1093, 2026-10-11)

Read-only. This is the status of every item of `docs/audit/simplify-plan.md` §3
(lines 65-139) **on `main` today**, after the cuts of 2026-10-09/10. Each row is
one programme item; `evidence` is a `file:line` read in this worktree plus the
merged task ids `git log --oneline --grep` finds; `what is left` is concrete,
with files and an estimate in changed lines for every `partly` / `open` row.

Status values: `done` (the item's goal is on main), `partly` (the shared thing
exists and is adopted in places, copies remain), `open` (not started, or kept on
purpose after a decision).

**Summary:** 32 done, 6 partly, 3 open, of 41 items.

| Phase | Done | Partly | Open |
| --- | ---: | ---: | ---: |
| 0 bugs and cheap performance | 6 | 2 | 0 |
| 1 deletions | 4 | 0 | 1 |
| 2 server boilerplate | 3 | 3 | 2 |
| 3 one API contract | 3 | 1 | 0 |
| 4 one client core | 4 | 0 | 0 |
| 5 tests and CI | 7 | 0 | 0 |
| 6 build and runtime | 5 | 0 | 0 |

Most of the programme landed between T-0843 and T-0865 (Phases 0, 1, 3, 5, 6),
the server helpers between T-0863 and T-0908, the store core between T-0902 and
T-0929 (Phase 4), and the dedup helpers T-1043/T-1052-T-1057 (Phase 2.7). What
is left is concentrated in Phase 2 (adoption of helpers that already exist) and
the web API facade (Phase 3.3).

## Phase 0: bugs and cheap performance

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 0.1 | Mobile marks AI DMs as AI | done | `apps/mobile/src/store/real-store.ts:68` (`isAI: entry.kind === 'dm' && entry.isAi === true`); `apps/mobile/src/lib/chat-api.ts:111`; T-0843 | none |
| 0.2 | Other drift: pinned topics, one money format, one search debounce | partly | `packages/chat-core/src/topics.ts:8` `sortTopics` (pinned first), `packages/chat-core/src/money.ts:4`, re-export `apps/mobile/src/lib/chat.ts:3`; T-0844 | the debounce constant is still copied per app: `apps/web/src/lib/useMessageSearch.ts:8` and `apps/mobile/src/components/chat/message-search-format.ts:4`, both 250 ms → move to chat-core. Failed mobile send is Julio's decision D-1 (keep "sending", `apps/mobile/src/store/effects/send.ts`). ~15 lines |
| 0.3 | Web store selector hook + `memo` | done | `apps/web/src/store/ChatStoreProvider.tsx:80` (`useAtomValue(atom, selector)`); `apps/web/src/components/MessageBubble.tsx:60`, `ChatListItem.tsx:28`; T-0845, T-0879 | none |
| 0.4 | Mobile message list: real windowing + memo | partly | memoised bubbles and the AI draft outside entries are done (T-0846); `apps/mobile/src/components/chat/message-list.tsx:219` still `initialNumToRender={Math.max(entries.length, 1)}` | real windowing: drop the all-at-once initial render, set `windowSize`/`maxToRenderPerBatch`, keep the `onScrollToIndexFailed` jump. `apps/mobile/src/components/chat/message-list.tsx`. ~60-150 lines. **medium risk** |
| 0.5 | Mock backend out of the production bundles | done | web `apps/web/src/mock/load.ts:7-13` (build-time gate); mobile guarded `require` in `apps/mobile/src/components/settings/use-profile-api.ts:23-25`, `apps/mobile/src/auth/RequireAuth.tsx:13`; T-0847, T-0848, T-0882 | none (see the build check below) |
| 0.6 | One migration: membership indexes | done | `apps/server/drizzle/0046_membership-indexes.sql:1-7` (all six, plus `contacts`); T-0849 | none |
| 0.7 | Fix the 4 N+1 lists | done | `apps/server/src/approvals/queries.ts:152` `canDecideMany`; `tools/access.ts:172` `listToolsForGroup`; `topics/access.ts:664` `toTopicViews`; `stickers/packs.ts:249` `discoverPacks`; T-0850-T-0853 | none |
| 0.8 | Mobile fonts: 5 faces, no Material Symbols | done | `apps/mobile/package.json:17-18` (only `geist` + `geist-mono`); T-0854 | none |

## Phase 1: deletions

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 1.1 | Dead files, 41 declarations, drop file-local `export`s | done | T-0865 (`cf826d32`, −357 lines) | none |
| 1.2 | Dead light theme in the dark-only mobile app | done | `apps/mobile/app.json:7` `"userInterfaceStyle": "dark"`; 0 `useColorScheme` / `[scheme]` left in `apps/mobile/src`; T-0881 | none |
| 1.3 | `apps/server/drizzle/meta/` snapshots | done | `apps/server/drizzle/meta/` holds only `_journal.json` (8.0 KB, was 3.7 MB); T-0855 | none |
| 1.4 | `agent-drivers`, git proxy, unused effect files | done | `packages/agent-drivers` and `apps/server/src/git` do not exist; T-0856 | none |
| 1.5 | OpenCode-era devtools lead code | open | `packages/devtools/src/lead/` is still present; Julio decided to keep it (`docs/audit/simplify-plan.md:166`) | none planned — the decision closes this item |

## Phase 2: server boilerplate

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 2.1 | One shared `runSql` | done | `apps/server/src/effect/sql.ts:111`; 526 call sites; only `pins/access.ts:48`, `auth/sql-adapter.ts:155`, `app.ts:597` (deferred) and `db/migrate.ts:9` (bootstrap) keep `sqlRuntimeFor`; T-0908, T-1052 | none |
| 2.2 | One schema-error middleware | done | `apps/server/src/effect/http-core.ts:93` `schemaErrorLayer` / `:97` `schemaErrorLayerFor`; no hand-written wrapper left; T-0897 | optional: chain the default layer once in `mountApi` (`http-core.ts:270`) so 26 modules stop providing it, ~30 lines (cosmetic) |
| 2.3 | Rate-limit middleware factory | partly | `apps/server/src/effect/rate-limit-middleware.ts:36` `rateLimitLayer` (12 adopted), `:59` `makeRateLimit`; 44 `createRateLimiter` instances | 6 hand-written layers (`groups/api.ts:63,84`, `invite-links/api.ts:82`, `integrations/api.ts:62,92`, `topics/api.ts:57`) and ~31 inline `allow` checks (dedup-status §4, slices S7-S9). ~450 lines. **security: rate limits** |
| 2.4 | `handler`/envelope with typed errors | partly | `apps/server/src/effect/http-core.ts:208` `handler` (158 uses) | 4 `withErrorEnvelope` kept on purpose (`auth/api.ts:195`, `setup/api.ts:216,232`, `machines/api.ts:311` — public routes with no session) and the `HttpError`-as-defect pattern (~327 `throw new HttpError`, ~26 `requestIdOf`; dedup-status §2). Removing the defect is a large mechanical move (~800 lines per module group). **none visible** |
| 2.5 | Derive route manifests from the HttpApi | done | `apps/server/src/effect/http-core.ts:251` `reflectRoutes` (`HttpApi.reflect` at `:255`), `:270` `mountApi`; T-0863 | none |
| 2.6 | One `groups/access.ts` | open | `apps/server/src/groups/access.ts` does not exist; 65 `group_members` mentions across `groups/`, `topics/`, `approvals/`, `roles/`, `invite-links/`, `audit/`, `tools/access.ts` (dedup-status §5) | build `apps/server/src/groups/access.ts` and adopt it (dedup-status S10, S11). ~650 lines. **security: permissions** |
| 2.7 | Small duplicates | partly | done: `apps/server/src/effect/error-utils.ts` (T-1043), `apps/server/src/jid.ts` + `apps/server/src/text.ts` (T-1053), `apps/server/src/http/read-capped.ts` (T-1054), `apps/server/src/effect/schema-issues.ts` (T-1057) | the crypto envelope ×3 (`push/crypto.ts`, `connections/crypto.ts`, `setup/crypto.ts` — byte-identical lines) and `scrubTokenText` (`stickers/telegram/errors.ts:77`). ~230 lines. **security: keys, secrets** |
| 2.8 | Error codes as constructors | open | 30 `new HttpError(…, 'xmpp_unavailable', …)` sites (503 ×21, 502 ×9), no constructor; `pin_limit` (1) and `too_many_pins` (1) both live | add constructors to the server errors module and adopt them. ~150 lines. Changes a few client-visible codes (pick one per case) |

## Phase 3: one API contract

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 3.1 | Make the contract truthful | done | 14 `HttpApiSchema.status(201)` in `packages/api-contract/src`; no `Schema.Void`; deletes declare a result (`chat-folders.ts:134,154`) and handlers send it (`apps/server/src/chat-folders/api.ts:152` `{ deleted: true }`) | none |
| 3.2 | `TextDecoder` polyfill for Hermes | done | `apps/mobile/src/lib/polyfills.ts:118` `Utf8TextDecoder`, installed at `:146-152`; T-0864 | none |
| 3.3 | `packages/api-contract` + derived clients | partly | package with 41 files; `packages/api-contract/src/client.ts:18,70` (`ZilarClient`, `makeZilarClient`); server mounts it, mobile derives from it; **web, lead re-check 2026-10-11:** `apps/web/src/lib/api/*.ts` already calls `callApi((client) => …)` 135 times | only 8 hand-written `request(` calls are left: `chats.ts:101` (`/xmpp/token`) and `settings.ts:70,74,91,99,158,175,204` (voice, voice-transcription settings, `/setup`, avatar delete), plus `http.ts` itself. These are the XMPP credential and keys/setup paths, which is slice S15: **security: auth, keys. Julio's decision.** S12-S14 have nothing left. |
| 3.4 | One mobile transport and one error class | done | `apps/mobile/src/lib/effect/api-client.ts:19` `createApiClient`; `packages/api-contract/src/client.ts:95` `ApiError`; 0 mobile `*-api.ts` call `fetch` directly; T-0864 | none |

## Phase 4: one client core

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 4.1 | Verbatim pure helpers into `chat-core` | done | `packages/chat-core/src/{edits,reactions,mentions,folders,money,ai-limits,ai-templates,ai-models,ai-form,routines}.ts`; JID/handle helpers in `@zilar/protocol`; T-0874-T-0877 | none |
| 4.2 | Shared React and Effect glue | done | `packages/client-core/src/{use-action,use-query,atom-store,api-effect}.ts`; T-0878 | none |
| 4.3 | Platform-free store core in `client-core` | done | `packages/client-core/src/store/` (ledger, send, lifecycle, polling, groups, pins, prefs, `ports.ts`); both stores import it (16 web, 14 mobile files); `StoreApi` + `createRealChatStore(deps)` kept; T-0902-T-0929 | none |
| 4.4 | Optional: mock stores rebuilt on the core | done | old mock stores deleted (T-0947 web, T-1060 mobile); mock mode runs on `@zilar/mock-backend`; the optional rebuild is moot | none |

## Phase 5: tests and CI

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 5.1 | DB snapshot once per run | done | `apps/server/vitest.config.ts:11` `globalSetup: ['./src/test-global-setup.ts']`; T-0859 | none |
| 5.2 | Shard server tests in CI (3 shards) | done | `.github/workflows/ci.yml:85-91` (`--shard=1/3` … `3/3`); T-0860 | none |
| 5.3 | Cut the slow loop tests | done | T-0887; `apps/server/src/rate-limit.test.ts` (no 600-request loop left) | none |
| 5.4 | Shared seeds and fakes | done | `apps/server/src/test-support/seed.ts:17,42,99` (`seedUser`/`seedAi`/`seedGroup`); `packages/xmpp-core/src/testing.ts:32` `createFakeXmppCore`; per-package wait helpers; T-0925, T-0884, T-0885, T-0926 | none |
| 5.5 | One `flush`/`waitFor`/`jsonResponse` per package | done | `apps/server/src/test-support/wait.ts:17,27,62`; `apps/web/src/test/wait.ts`; `apps/mobile/src/test/wait.ts`; T-0899, T-0911 | none |
| 5.6 | Replace brittle source-pinning tests | done | T-0898 | none |
| 5.7 | Split `agents/gateway.test.ts` | done | file gone; `apps/server/src/agents/gateway.test-harness.ts` remains; the server suite is now 26 files (T-0931); T-0886 | none |

## Phase 6: build and runtime

| # | Item | Status | Evidence | What is left |
| --- | --- | --- | --- | --- |
| 6.1 | Web code splitting | done | lazy `LoginPage`/`SetupPage`/`FoldersPage` chunks in the build (T-0862); markdown stack split (T-0880); `apps/web/vite.config.ts` | none |
| 6.2 | Bundle the server with esbuild | done | `apps/server/package.json:39` esbuild; `apps/server/Dockerfile:86` `CMD ["node", "dist/index.mjs"]`; T-0861 | none |
| 6.3 | PGlite lazy-imported, dev-only | done | T-0861, T-0909 | none |
| 6.4 | Dockerfile layer order, one build per workflow | done | `apps/server/Dockerfile:74-77` (node_modules, drizzle, dist) and ffmpeg at `:60`; one build job in `.github/workflows/images.yml`; T-0861 | none |
| 6.5 | `effect` aligned + pnpm catalog | done | `pnpm-workspace.yaml:5-11` catalog (incl. `effect: ^4.0.2`); no app pins a version outside the catalog; T-0900 | none |

## Mock backend check (0.5)

Command run in this worktree:

```bash
pnpm --filter @zilar/web build
# ✓ built in 1.02s; apps/web/dist/assets holds 34 files
grep -rl "Acme Announcements" apps/web/dist   # prints nothing
```

`Acme Announcements` (and `Not worth faking`, `AMD Ryzen 9 7950X`) exist in
`packages/mock-backend/src/domains/*/seed.ts` but not in `apps/web/dist`, so the
web release build contains no mock backend. That is the build-time gate in
`apps/web/src/mock/load.ts:7-13`: `VITE_MOCK !== '1'` and `MODE !== 'test'` fold
the dynamic `import('./backend')` away.

Mobile was not built (the spec forbids running the apps), so that side is
inspection only: every reachable path to `@/mock/backend` is a `require` inside
`if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)` (`use-profile-api.ts:23`,
`use-stickers-api.ts:38`, `chat-composer-dock.tsx:32`, `chat-search-results.tsx:70`,
`RequireAuth.tsx:13`), which Metro folds away in a release build.

## Next slices

> **Lead, 2026-10-11:**
> - **N2** is T-1098.
> - **N3-N5 are dropped:** the web facade is already on the derived client (see 3.3).
> - **N7 is dropped:** chaining the schema-error layer in `mountApi` needs a logger parameter there and touches 27 modules, `auth/api.ts` among them, with no real line cut.
> - **N1 waits for Julio,** because it changes client-visible error codes.
> - **N6** is large churn with no visible gain, so it waits too.
> - **The store splits,** which were deferred until the mock rebuild, run now: T-1094 to T-1097.
> - **Still deferred:** the two `createRealChatStore` closures (`apps/web/src/store/realStore.ts`, `apps/mobile/src/store/real-store.ts`), which are the message pipeline core.

Open or partly-done items that are low risk and need no decision from Julio, in
order. Each is at most about 800 changed lines. Files are full repo paths.

1. **N1 · 2.8 code change — error-code constructors.** Add the constructors to
   `apps/server/src/errors.ts` and adopt them where the literal is repeated:
   `apps/server/src/pins/service.ts`, `apps/server/src/stickers/{packs,favorites,storage,schemas,telegram}.ts`,
   `apps/server/src/roles/service.ts`, `apps/server/src/groups/{schemas,join}.ts`,
   `apps/server/src/invite-links/join.ts`, `apps/server/src/backgrounds/service.ts`,
   `apps/server/src/avatars/service.ts`, `apps/server/src/xmpp/api.ts`. ~150 lines.
   **Note:** this picks one status per code (`xmpp_unavailable` is 503 in 21
   sites and 502 in 9; `pin_limit` 400 vs `too_many_pins` 409), so it changes a
   few client-visible codes.
2. **N2 · 0.2 search debounce.** Move the constant into `packages/chat-core`
   and import it in `apps/web/src/lib/useMessageSearch.ts` and
   `apps/mobile/src/components/chat/message-search-format.ts`. ~15 lines. No flag.
3. **N3 · 3.3/S12 web facade `chats` + `groups`.** Move the hand-written
   bodies in `apps/web/src/lib/api/chats.ts` and `apps/web/src/lib/api/groups.ts`
   onto the derived `ZilarClient`, keeping the exported names. ~350 lines. No flag.
4. **N4 · 3.3/S13 web facade `topics` + `ais` + `machines`.**
   `apps/web/src/lib/api/{topics,ais,machines}.ts`. ~380 lines. No flag.
5. **N5 · 3.3/S14 web facade `stickers` + `media` + `people`.**
   `apps/web/src/lib/api/{stickers,media,people}.ts`. ~350 lines. No flag.
6. **N6 · 2.4 remove the `HttpError`-as-defect pattern**, one module group per
   slice (for example `apps/server/src/{pins,stickers,roles,backgrounds,avatars}/**`),
   rendering exactly as today. Up to ~800 lines per slice, ~90 files in total. No
   visible behaviour change.
7. **N7 · 2.2 chain the schema-error layer once** in
   `apps/server/src/effect/http-core.ts` `mountApi`, then drop the 26
   `Layer.provide(schemaErrorLayer…(logger))` lines in the modules. ~30 lines,
   cosmetic. No flag.

**Flagged, not in the slices** (a decision or a risk keeps them out):

- **2.3** (rate limits) — **security: rate limits**.
- **2.6** (permissions) — **security: permissions**.
- **2.7** remaining crypto envelope and `scrubTokenText` — **security: keys, secrets**.
- **0.4** mobile windowing — medium risk.
- **3.3/S15** `settings` + `http` web facade — **security: keys**.
- **1.5** devtools lead code — kept by Julio's 2026-10-09 decision.
