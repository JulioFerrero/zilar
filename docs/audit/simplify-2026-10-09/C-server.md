# C - Server internals audit (apps/server/src)

Scope: 204 non-test files / 62.1k lines (`wc -l` over `find ... ! -name '*.test.ts'`), 162 test files / ~70.8k lines. Read-only. All line numbers are as of HEAD 44209a4c.

## 1. Summary

- **The service layer is still "async function + Effect inside".** 442 `async function` declarations in services (287 exported + 155 local, 58+38 files), 56 byte-identical copies of `function runSql(db, effect) { return sqlRuntimeFor(db).runPromise(effect) }` plus 77 inline `sqlRuntimeFor(db).runPromise` calls, and 417 `Effect.promise(() => ...)` in `*api.ts`/gateway files that turn the promise straight back into an Effect. Every request therefore does Effect -> Promise -> Effect, loses interruption, and throws `HttpError` as a *defect* (66 `catchDefect`, 196 `withErrorEnvelope`). This is the root cause of most boilerplate below.
- **Pure boilerplate that a 100-line shared module would delete (~2,000+ lines, low risk):** `runSql` x56 (~390 lines), `schemaErrorLayer` x25 (14 byte-identical, 3 near; ~420 lines), rate-limit middleware layers x~18-24 (all identical after parametrisation; ~450 lines), handler envelope `requestIdOf` + `withErrorEnvelope(Effect.gen(CurrentUser ... Effect.promise))` x196 (~900 lines), hand-kept `*_API_ROUTES` manifests (36 files, 159 entries, ~300 lines) that `HttpApi.reflect` can derive.
- **Request path has 3 conversions per request** (edge.ts:366 `toWeb` -> `forwardEdgeRequest` clones Headers+Request -> per-module `HttpRouter.toWebHandler` (38 of them) -> `fromWeb`) and a linear scan over 159 routes (edge.ts:363). Not a measured bottleneck (DB dominates) but it is the largest structural complexity and the reason `errorBody`/`internalErrorBody` (edge.ts:156-175) duplicate `httpErrorResponse`/`failureResponse` (http-core.ts:94-120).
- **Biggest real perf finding: no session cache.** `auth.ts:67-133` configures no `session.cookieCache`; `http-core.ts:55` calls `auth.api.getSession` on every authenticated request, and the custom adapter has no join support (sql-adapter.ts has none), so each request is >=2 round trips (session, user) before the handler's own queries (inferred, UNVERIFIED by EXPLAIN/log).
- **Confirmed N+1s on user-facing lists:** `listTools`/`listToolsForAi` (tools/service.ts:380, 1160: 2+ queries per tool, full `SELECT *` incl. source), `toTopicViews` (topics/access.ts:520: 4 queries x topics), approvals list (`canDecide` per row, up to 100 rows, approvals/service.ts:656), sticker discover (stickers/service.ts:555: 1 query per pack), `canSeeRoomJid` (chat-prefs/service.ts:78), `tools/api.ts:405/992` per-AI loops.
- **Authz is copy-pasted:** 41 `FROM group_members` queries, 9 hand-written "is owner/admin" checks (`role === 'owner' || role === 'admin'`) in tools/api.ts:828,893, routines/api.ts:434,464, approvals/service.ts:783, approvals/rules.ts:303, audit/service.ts:430, group-turn.ts:444, topics/access.ts:259, plus two private `requireGroupManager` (roles/service.ts:88, invite-links/service.ts:161) that differ only in message.
- **Dead/near-dead:** `auth/session.ts` (17 lines, zero importers), `effect/runtime.ts` (39 lines, only its own test, and its header contradicts the 138 `runPromise` calls), `SqlLive` (effect/sql.ts:50, only exported), `ServerConfigLive`/`ServerConfig` tag (test only), 294 exports flagged unused even by tests (knip), mostly `*_RATE_LIMIT_MAX/_WINDOW_MS` and `*_API_ROUTES` constants.
- **Index gaps** (migrations vs queries): no index on `group_members(user_id)`, `topic_members(user_id)`, `group_ais(ai_id)`, `topic_ais(ai_id)`, `group_member_roles(user_id)`, `lower(xmpp_accounts.jid)` although all are filtered on in hot lookups. Cheap to add (one hand-written SQL migration).

## 2. Measurements

Commands run from `apps/server/src` (file list in `scratchpad/audit/c-files.txt`, tests excluded via `find ! -name '*.test.ts'`; `rg -c` summed).

| Metric | Result |
|---|---|
| non-test src files / lines | 204 / 62,113 |
| test files / lines | 162 / ~70.8k; biggest test: agents/gateway.test.ts 7,242 lines (10% of all test lines), ais/routes.test.ts 2,412, actions/gateway.test.ts 1,931, groups/groups.test.ts 1,920 |
| `async ` / `await ` | 534 in 90 files / 1,184 in 85 files |
| `export async function` / local `async function` | 287 (58 files) / 155 (38 files) |
| `Effect.promise(() =>` | 398 in 63 files (417 `Effect.promise`); worst: approvals/api.ts 25, tools/api.ts 24, topics/api.ts 23, group-turn.ts 19 |
| `Effect.tryPromise` | 49 in 19 files |
| `.runPromise(` (domain code) / `Effect.runPromise` / `runFork` | 132 in 99 files / 55 in 35 / 28 in 15 |
| `function runSql` copies | 56 (one per module; media/api.ts:160, topics/service.ts:775, approvals/service.ts:14 ... routines/db.ts:6 exported) |
| `new Promise` | 4 (app.ts:612, effect/node-serve.ts:58, ais/service.ts:1216, ais/api.ts:384) |
| `Effect.gen` / `Effect.fn` | 840 in 109 files / 98 in 39 files |
| `HttpError(` constructions / `throw new` | 518 in 62 files / 493 in 78 |
| `'not_found'` / `'invalid_request'` / `'forbidden'` literals | 150 / 124 / 22 |
| `withErrorEnvelope` / `requestIdOf(request` / `catchDefect` | 196 / 207 / 66 |
| `HttpRouter.toWebHandler` | 38 (one per module) |
| `schemaErrorLayer` copies | 25; 14 hash-identical, 3 near-identical (script on function body with the class name normalised) |
| rate-limit layer functions (`(limiter: RateLimiter)`) | 13 matched by regex, all hash-identical once name and message are normalised; `limiter.allow` 24 uses in 17 files; `createRateLimiter` 74 uses in 29 files |
| `*_API_ROUTES` manifests | 36 files, 159 `{ method, path }` entries |
| SQL: `sql\`` / `SELECT *` / `LIMIT 1` / `withTransaction` / `pg_advisory_xact_lock` | 380 in 64 files / 143 in 34 files / 239 / 70 / 38 |
| `FROM group_members` / `FROM groups` | 41 / 19 sites |
| `argsHash: null` in audit record literals | 45 in 24 files (10-field `audit.record({...})` literal each time) |
| `process.env` outside config | 7 in 5 files (config.ts:457, app.ts:582 `ZILAR_COMMIT`, main.ts:229/447, migrate-cli, invite-cli) |
| env vars | config.ts ~47 + push/config.ts 9 + xmpp/config.ts 7 = ~63 declared keys; DATABASE_URL is declared twice (config.ts schema and `Config.Redacted('DATABASE_URL')` in unused `SqlLive`, effect/sql.ts:50) |
| tables / explicit indexes (46 migrations, 3.9 MB `drizzle/`) | 60 `CREATE TABLE` / 48 `CREATE INDEX` |
| duplicated helper names across files (top-level `function`) | errorName x7, isUniqueViolation x6, bareJid x4, readCapped x4, truncateChars x4, escapeLike x3, deriveKey/encryptOnce/decryptOnce x3 (crypto), safeStringify x3, decodePathId x3, serviceNow x3 |

Top 20 files by lines (non-test): groups/service.ts 1589, agents/reply.ts 1585, ais/service.ts 1397, stickers/service.ts 1381, tools/service.ts 1193, topics/service.ts 1140, tools/api.ts 1050, actions/gateway.ts 1047, tools/adapters.ts 951, approvals/service.ts 892, stickers/api.ts 869, roles/service.ts 774, contact-requests/service.ts 739, approvals/api.ts 714, main.ts 713, routines/service.ts 664, groups/api.ts 664, ais/api.ts 655, invite-links/service.ts 639, push/api.ts 627. Judgement per file is in section 3 (F11).

Longest functions (awk on top-level `function`/`const =>`, `scratchpad/audit/fnlen.awk`; the 502-line tool-worker.ts hit is an awk artifact): group-turn.ts `createGroupTurn` 473, main.ts `startServer` 487, stickers/api.ts `createStickersApi` 427, push/api.ts `createPushApi` 390, tools/api.ts `createToolsApi` 355, gateway/tool-exec.ts 344, approvals/api.ts 343, machines/api.ts 330, groups/api.ts 328, ais/api.ts 327, gateway/sessions.ts 310, xmpp/admin-client.ts `createEjabberdAdminClient` 290, dm-turn.ts 289, sandbox/run-tool.ts `runTool` 284. Every `createXApi` is long because the handler list is inlined; they shrink mechanically with F4.

## 3. Findings (value / effort, best first)

### F1. One shared `runSql` (and kill the Promise hop where cheap)
- Evidence: 56 identical copies, list via `rg -n "^function runSql" apps/server/src` (e.g. blocks/service.ts:~38, contacts/service.ts:42, approvals/service.ts:14, tools/service.ts:127, actions/gateway.ts:124, agents/gateway/db.ts:11). `routines/db.ts:6` already exports one. Also 77 inline `sqlRuntimeFor(db).runPromise(...)`. Variants differ only in the error type parameter (`A` vs `A, E`).
- Impact: ~390 lines (56 x ~7) deleted, plus ~56 `import { sqlRuntimeFor }`/`SqlError` imports. Zero behaviour change.
- Risk: very low; typecheck catches signature drift (generic `E` variant: make the shared one `<A, E>(db, effect: Effect<A, E, SqlClient>)`).
- Effort: S (half day, mechanical; one task per 10 modules).
- Recommendation: export `runSql` from `effect/sql.ts` (next to `sqlRuntimeFor`), replace all copies, delete `routines/db.ts` runSql. Do first: it is the prerequisite that makes F6 diff-reviewable.

### F2. Shared schema-error middleware
- Evidence: `schemaErrorLayer` in 25 files (roles/api.ts:97, pins/api.ts:~118, ...), each declares its own `XxxSchemaErrors` class (126 `SchemaErrors` references in 25 files) and an identical `layerSchemaErrorTransform` body returning `failureResponse(logger, requestIdOf(request), new HttpError(400, 'invalid_request', error.cause.message))`.
- Impact: ~18 lines x 25 = ~420 lines to ~30 (one class + one layer in `effect/http-core.ts`, `.middleware(SchemaErrors)` per group, `Layer.provide(schemaErrorLayer(logger))`).
- Risk: low. The 3 near-identical and ~5 other variants (check each: some may use a different message or status) need a diff before folding; `authz-sweep.test.ts` and the routes tests cover 400 bodies.
- Effort: S.
- Recommendation: add `SchemaErrors` to http-core.ts; migrate the 17 identical ones first, inspect the other 8 individually.

### F3. Rate-limit middleware factory
- Evidence: blocks/api.ts:67-105 defines two classes and two layers whose bodies are byte-identical except the limiter; pins/api.ts:132-153, topics/api.ts:243, contact-requests/api.ts:136/162/185, groups/api.ts:205/231, integrations/api.ts:144/179, handles, directory, search, xmpp, backgrounds, voice-transcription, agents/memory (~20 classes). Each repeats the 429 `rate_limited` envelope with a different message string. Plus ~60 exported `*_RATE_LIMIT_MAX` / `_WINDOW_MS` constants, 95 of which knip reports unused even in tests.
- Impact: ~22 lines x 20 = ~450 lines to a ~25-line `makeRateLimit(tagName, message)` that returns `{ Middleware, layer(limiter) }`. Also lets you declare limits as data: `{ max, windowMs }` instead of 3 constants + `createRateLimiter` + `?? default` boilerplate in every `createXApi` (blocks/api.ts:132-146).
- Risk: low-medium: middleware ordering is load-bearing ("budget spent before payload decode", pins/api.ts:128-131; search `SearchGuards`, voice `TranscriptConfigured`/`VoiceSettingsOwnerLimit` are not plain limits - leave those). Keep the tag strings (`zilar/effect/http/<Name>`) unchanged.
- Effort: S-M.
- Recommendation: factory in `effect/http-core.ts` or new `effect/rate-limit-middleware.ts`; convert module by module, with the existing `*routes.test.ts` 429 tests as net.

### F4. Handler boilerplate: one `authed`/`handle` helper (and typed errors)
- Evidence: every handler is `const requestId = requestIdOf(request.request); return withErrorEnvelope(Effect.gen(function* () { const user = yield* CurrentUser; return yield* Effect.promise(() => fn(...)) }), logger, requestId);` (blocks/api.ts:176-208; 196 `withErrorEnvelope`, 207 `requestIdOf(request`).
- Impact: 8-10 lines -> 3 per handler: ~900-1000 lines across 38 api files, and the 300-450 line `createXApi` functions drop to ~150.
- Risk: medium-low. Behaviour must stay identical (defect -> envelope). Do it as a pure helper first: `handler(logger, (ctx: {user, request, ...}) => Promise<A> | Effect<A>)`. Typed-failure variant (service returns `Effect<A, HttpError>`, `Effect.catchTag` once at the edge) is the real fix for the defect-as-control-flow design (`http-core.ts:132-140` comment admits it) but belongs with F6.
- Effort: M (helper S, mechanical conversion M).
- Recommendation: add helper, convert one module as pattern, then batch by directory. Do after F2/F3 so each file is touched once.

### F5. Derive route manifests from the HttpApi definition
- Evidence: `BLOCKS_API_ROUTES` (blocks/api.ts:107-111) re-lists what `BlocksGroup` (blocks/api.ts:75-97) already defines; 36 files, 159 entries. `HttpApi.reflect` exists in effect 4.0.2 (`node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/http-api/HttpApi.d.ts:146`). Drift risk: a new endpoint without a manifest entry is a silent 404 at the edge (edge.ts:363 routes only through the manifest); `authz-sweep.test.ts` is the only guard.
- Impact: ~300 lines and a class of bug; also lets the 95 unused `*_API_ROUTES` exports go.
- Risk: low-medium: need path normalisation (`/api` prefix, `:param` syntax) to equal the current strings; compare old manifest to reflected one in a test before deleting.
- Effort: S-M.

### F6. Finish the Effect conversion of services (Tier B) - ranked by value
161 files repo-wide; server share is 96 files with `async function`. Cheap vs valuable:
- Cheapest and highest value: the 37 `*api.ts` files that call a service function through `Effect.promise` (398 sites). Converting the *service* to return `Effect` (drop `runSql`, `await` -> `yield*`) removes the wrapper pair at both ends, restores interruption on client abort and gives typed errors. Order by `Effect.promise` count: approvals (service.ts+api.ts: 25+), tools (24), topics (23), stickers (18), ais (18), routines (16), machines (15), push (14), integrations (14), groups (13). Each pair is one task of 500-1500 lines; tests call the async API directly (e.g. `blockUser(deps, ...)`), so keep a thin `Effect.runPromise` wrapper only if tests would otherwise need rewriting (that is why they are still async: "keep the exported functions `async` so routes and tests keep their shape", blocks/service.ts:6-8, effect/sql.ts:15-16). That transition comment is now the main obstacle: the shape never changed back.
- Cheap and independent: `new Promise` x4 (app.ts:612, node-serve.ts:58, ais/service.ts:1216, ais/api.ts:384 is a hand-rolled `Effect.timeout`), `Effect.tryPromise` x49 where the callee is already Effect.
- Should stay Promise (edge libraries): better-auth (`auth.api.getSession`, `auth.handler`), `@zilar/xmpp-core` calls, pg `ArchivePool` (search/service.ts), web-push sender, nodemailer, ffmpeg child process (voice/engine.ts), `fetch` in LiteLLM/ejabberd clients (wrap once per client, not per call site).
- Impact: ~1,500-2,500 lines of `async/await/runSql/Effect.promise` glue and the 66 `catchDefect`; main win is correctness (interruption, typed errors, tracing) not size.
- Risk: medium; do per module with its existing tests as net, never two modules in one task.
- Recommendation: after F1-F4, convert approvals, tools, topics first (they also host the N+1s of F8, so the rewrite fixes them in passing). Replace `ServerDatabase` + global WeakMap (`effect/sql.ts:80-107`, throws at runtime if unregistered) by a `Db` service/Layer at the same time; `ServerConfig` Context tag (config.ts:454) is already the pattern.

### F7. Hot path: session cache
- Evidence: `effect/http-core.ts:55` and `auth/session.ts` / `auth/api.ts:273` call `auth.api.getSession` per request; `auth/auth.ts:67-133` has no `session: { cookieCache }`; adapter `auth/sql-adapter.ts` implements no join (rg "join" -> 0), so session + user are two selects (UNVERIFIED by query log).
- Impact: removes ~2 round trips from every authenticated API call (every route, ~159); biggest single latency/DB-load win available.
- Risk: medium: revoked sessions stay valid for the cache TTL (use 30-60 s or in-process LRU keyed by token hash invalidated on sign-out); bearer() path (mobile) must be verified to hit the cache.
- Effort: S-M. Recommendation: enable better-auth `session.cookieCache` (maxAge 60 s) first, measure with the request log (`durationMs`) before/after on the Android and web clients.

### F8. N+1 queries (fix while converting, otherwise as small tasks)
1. tools/service.ts:364-395 `listTools` and :1139-1170 `listToolsForAi`: per tool one `SELECT *` of `ai_tool_versions` (includes source up to `MAX_TOOL_SOURCE_BYTES`) and one `latestRunStatus`. Fix: two `IN` queries (`DISTINCT ON (tool_id)` for last run), select only the columns `PublicTool` uses. tools/api.ts:405 and :992 additionally loop per `aiId`.
2. topics/access.ts:515-535 `toTopicViews`: `toTopicView` (:370) runs 4 queries (`countTopicMembers`, `resolveOwnerName`, `listTopicAis`, `rolesOfTopic`) per topic, topics sequentially. Fix: `GROUP BY topic_id` batched queries keyed by topic ids.
3. approvals/service.ts:656 list loop: `canDecide` (:723) does 3-6 queries per row, up to 100 rows. Fix: preload AI owners, visible topic ids (one call to the batch visibility code that already exists at topics/access.ts:219-231), approver-role holders.
4. stickers/service.ts:555-566 discover page: 1 query per pack (page up to 200). Use the `pack_id IN ${sql.in(...)}` form already written at :334.
5. chat-prefs/service.ts:78 `canSeeRoomJid` loops `canSeeTopic` (3 queries) per topic row; roles/service.ts:163,493 and topics/rooms.ts:267-355 per-member admin calls (XMPP, intentionally sequential - keep).
6. agents/gateway/db.ts:157 `allowedTopicAiIds` per topic in `listAiRooms` (runs on every reconcile).
- Impact: list endpoints from O(rows x 4) queries to O(1); on small instances unnoticeable, on a 50-topic group `GET topics` is ~200 round trips.
- Effort: S each. Risk: low with existing service tests (all those have `*.test.ts`).

### F9. Missing indexes
- Evidence (migration PKs): `group_members` PK(group_id,user_id), `topic_members` PK(topic_id,user_id), `topic_ais` PK(topic_id,ai_id), `group_ais` PK(group_id,ai_id), `group_member_roles` PK(role_id,user_id). Queries by the *second* column: `FROM group_members WHERE user_id = ...` (topics/rooms.ts:472, approvals/service.ts:802, approvals/api.ts:709, directory/service.ts:302, tools/api.ts:1019, approvals/rules.ts:299), `topic_ais WHERE ai_id` (agents/gateway/db.ts:~150, 33 `WHERE ai_id =` sites in 7 files), `group_ais ... ai_id` (approvals/service.ts:248, actions/gateway.ts:919, routines/execute.ts:207), `group_member_roles WHERE gmr.user_id` (topics/access.ts:230), `lower(jid) = ...` (blocks/service.ts:~62, isDmBlocked; `xmpp_accounts_jid_unique` is on raw `jid`, not usable). `contacts.contact_user_id` has no index either (5 reverse lookups).
- Impact: seq scans today, harmless at small scale; become real with growth since several run on every message/turn.
- Effort: S: one hand-written migration (CREATE INDEX IF NOT EXISTS x6) + `db/rows.ts` unaffected. Risk: low.
- Recommendation: add `group_members(user_id)`, `topic_members(user_id)`, `topic_ais(ai_id)`, `group_ais(ai_id)`, `group_member_roles(user_id)`, `xmpp_accounts(lower(jid))`; confirm with `EXPLAIN` on a copy (UNVERIFIED which the planner would already cover at current table sizes).

### F10. Shared group access helper (authz)
- Evidence: see summary; `getGroupMembership` already exists (topics/access.ts:104) and `isGroupManager`-like logic at topics/access.ts:259-294, yet roles/service.ts:68-97 and invite-links/service.ts:161-190 re-query `group_members` (the latter with two separate selects for group and membership) and others inline `membership.role === 'owner' || 'admin'`. Non-members get 404 "so group ids cannot be probed" - the same rule is re-implemented ~8 times, i.e. one drifted copy is an info leak.
- Impact: ~150-250 lines; main value is a single place that encodes "404 for non-member, 403 for member on manage".
- Effort: M. Risk: medium (security-sensitive, but `authz-sweep.test.ts` + per-module tests). Recommendation: `groups/access.ts` exporting `requireGroupMember(db, groupId, userId)` and `requireGroupManager(db, groupId, userId, message)` plus `isManager(role)`; migrate roles, invite-links, tools/api, routines/api, approvals, audit first.

### F11. Largest files - verdicts
- agents/reply.ts 1585: three concerns in one file: LiteLLM transport (`completeChat`, :343-411, overlaps ai/litellm-client.ts 589 lines), the DM tool loop (:514-1134) and the group turn (:1339-1585). Split into `reply/transport.ts`, `reply/dm-turn.ts`, `reply/group-turn.ts`; agents/gateway/{dm,group}-turn.ts already also exist, so there are two layers named "turn" - rename or merge. Risk low (pure moves), 0 lines saved, big clarity win.
- groups/service.ts 1589, topics/service.ts 1140, roles 774, invite-links 639: fix via F1/F10 first, then split by use case (members, ais, roles, visibility; groups/visibility.ts and join.ts already show the pattern).
- ais/service.ts 1397, stickers/service.ts 1381 (+ telegram-import.ts 573, api.ts 869): stickers service mixes packs, panel, favourites, discover and Telegram import (222-line `importTelegramPack`, :1034); split by those five. ais/service.ts mixes CRUD, LiteLLM key lifecycle and gateway records.
- tools/service.ts 1193, tools/api.ts 1050 (SQL inside api: 12 `sql` uses in api.ts, also routines/api.ts 8, approvals/api.ts 7, setup/api.ts 5, auth/api.ts 2): layering leak; move queries into service/store files while converting (F6).
- actions/gateway.ts 1047 (policy + recovery loop + SQL + errorName/safeStringify duplicates) vs approvals/service.ts 892: these two share the approval state machine; audit separately before moving anything.
- tools/adapters.ts 951, web-tools/adapters.ts 606: registry glue plus many constants; fine, but 13 exported-unused constants.
- main.ts 713: `startServer` is one 487-line `Effect.gen` that wires ~40 components procedurally; should become a `Layer` graph (config, sql, auth, mounts, gateway, push, runner hub) so `Effect.promise(() => closeX())` shutdown (main.ts:127-147) becomes `Layer` finalizers. Medium effort, medium value, do after F6.
- sandbox/tool-worker.ts 616: single-purpose worker; keep.

### F12. Edge/router consolidation (largest structural change)
- Evidence: edge.ts:252-438 hand-rolls CORS, origin guard, request id, request log, masked path, dispatch; each of 38 modules builds its own `HttpRouter.toWebHandler` (a ManagedRuntime-like layer build each, ~38 at startup) and edge forwards through web Request/Response (edge.ts:366-372). Header comments cite "Hono parity" (edge.ts:1-30, 200-205), i.e. it is a port of Hono behaviour, not the idiomatic Effect shape.
- Target: one `HttpApi` composed of the 38 groups (`HttpApi.make('zilar').add(...)` / `.addHttpApi`), one `HttpApiBuilder.layer`, CORS/request-id/log as `HttpMiddleware`, error mapping via `HttpApiBuilder`'s error schema or one middleware. Removes: edge dispatch (~100 lines), 38 `toWebHandler` tails (~600 lines with `disableLogger` comments), `EffectApiMount`, manifests (F5), the Request/Headers cloning, and the linear route scan.
- Impact: -1,000+ lines, one router, OpenAPI for free (`HttpApi` supports it, d.ts header line 7), and per-request conversions 3 -> 0.
- Risk: HIGH: edge behaviours are pinned by `authz-sweep.test.ts`, `edge.test.ts`, `edge-node.test.ts`, `http.test.ts` - keep those green as acceptance. SSE (drafts/api.ts), multipart/stream uploads (stickers, avatars, backgrounds, files) and git smart-HTTP proxy (git/proxy.ts) need streaming parity (UNVERIFIED how `toWebHandler` handles them; they work today through web `Request`).
- Effort: L (1-2 weeks). Do last; F1-F5 make it smaller.

### F13. Hot paths: search, push, message handling
- Search (search/routes.ts:173-262, 330-480): three query builders (`buildArchiveQuery`, `buildArchiveEditsQuery`, `buildFuzzyCandidatesQuery`) repeat the same 8-line scope builder 3x (~40 lines duplicated). Each search issues up to 3 scans of 5,000 rows (`SEARCH_MAX_CANDIDATES`), computing `to_tsvector('simple', translate(lower(txt), ...))` per row (no functional/GIN index possible with ejabberd's schema without changing ejabberd; UNVERIFIED), the edits scan uses `xml LIKE '%urn:xmpp:message-correct:0%'` over the same window, and the fuzzy pass fetches full `xml` for 5,000 rows to score in JS. Extract `scopeClause(input, next)`; fetch `xml` only for the page of hits; measure with `EXPLAIN ANALYZE` on the live-sized archive before touching ejabberd indexes.
- Push (push/service.ts): per publish IQ resolves the newest archived message with up to 3 attempts x 300 ms (`ARCHIVE_LOOKUP_*`, correct by design for the MAM race) - fine. Local `awaitDb`/`runSql` wrappers duplicate F1.
- Message handling for agents (agents/gateway/group-ingest.ts, db.ts): single-row loaders (`loadGroupTitle`, `loadTopicName`, `loadTopicIsGeneral`, `loadGroupListenerSettings`, `loadRoomGateState` ...: agents/gateway/db.ts:196-342) are called sequentially per turn; each is an independent round trip, and the LLM call dominates, so low priority; a single `loadTurnContext` join would remove ~5 queries per turn.

### F14. Duplicated helpers inside the server
- crypto: connections/crypto.ts (105), setup/crypto.ts (106), push/crypto.ts (100) each carry `deriveKey/encryptOnce/decryptOnce` (hkdf + aes-256-gcm), differing only by KDF label (`kdf-labels.test.ts` pins labels). One `crypto/envelope.ts` with `createEnvelopeCipher(label)`: ~311 -> ~150 lines. Security-sensitive; keep envelope format byte-identical and keep kdf-labels test.
- `errorName` x7, `isUniqueViolation` x6 (machines/service.ts:467, topics/service.ts:1122, handles/store.ts:319 exported, pins:253, push/api.ts:208, roles:295), `bareJid` x4, `escapeLike` x3, `truncateChars` x4, `readCapped` x4 (upload body readers, avatars/stickers/voice/backgrounds api), `decodePathId` x3, `serviceNow` x3, `auditFor` wrappers: put in `util/` (or `effect/sql.ts` for `isUniqueViolation`; `SqlError` has a reason/cause code to match). ~150 lines total.
- Audit recording: 45 literals with 10 fields (`aiId: null, groupId: null, argsHash: null, costCurrency: null, costAmount: null, result: 'ok', detail: null`); give `AuditRecorder.record` defaults or add `recordOk(actor, action, subject, extras?)`. ~250 lines (45 x ~6).
- Pagination: no shared helper but only 5 real cursor sites with different keys - leave.

### F15. Dead code
- Delete: `auth/session.ts` (17 lines, no importer; its HttpError 401 path is superseded by `sessionLayer`), `effect/runtime.ts` + `runtime.test.ts` (39+63 lines; header at :1-12 states "Effect.runPromise belongs at the edge" which the code base contradicts), `SqlLive` (effect/sql.ts:50-58), `ServerConfig` tag/`ServerConfigLive` (config.ts:451-458) and its `config.effect.test.ts` unless a Layer-based main is planned (F11 main.ts).
- Unexport/delete (knip, includes tests): 294 unused exports + 300 unused types in apps/server; real deletions are small (`handles/store.ts`: `findHandle`, `handleUserIdFor`, `displayNameFor`, `isHandleChangeTooSoon`; `invite-links/service.ts`: 8 helpers; `machines/service.ts`: `countMachines/countPendingMachines/countActivePairingCodes`; `agents/tools.ts`: 14 schema/consts; `search/routes.ts` builders only used by tests). Bulk-convert to non-exported by one worker with `pnpm gate`. Note knip's prod mode reports git/*, xmpp/routes.ts as unreachable but they ARE wired (app.ts imports `git/api`, 13 files import `xmpp/routes`), so do not trust the prod-only list.
- Everything else in `app.ts` is wired: all 37 `createXApi` are mounted (app.ts imports listed lines 8-65).

### F16. Config/env sprawl
- config.ts (507 lines) + push/config.ts (185) + xmpp/config.ts (128) = three Schema decoders, three `...OrExit` loaders, ~63 keys; mostly sound. Findings: (1) `app.ts:582` reads `process.env.ZILAR_COMMIT` directly, bypassing config; (2) `DATABASE_URL` declared in config and again in dead `SqlLive`; (3) `loadPushConfigOrExit(process.env)` called separately in main.ts:447 so push config errors surface *after* the server has started wiring; load all three in one place at the top of `startServer`; (4) hand-rolled zod-parity helpers (`withDefault`, `literalWithDefault`, `portSchema`, config.ts:36-70) could be `Config.*` combinators (`Config.withDefault`, `Config.port`) with redaction, making `ConfigError` and `formatIssues` obsolete (~150 lines) - but the current output deliberately never echoes values, so verify that property in a test before replacing.

## 4. Looks bad but should stay

- **Hand-written row types in db/rows.ts (426 lines, 30 interfaces) and `sql<Row>` casts.** No runtime validation, but the snake->camel transform plus migrations-as-truth is simple and fast; adding Schema decoding per row would cost CPU on every query. Keep; instead add one test that diffs each `Row` type's keys against `information_schema.columns` after `migrateSql` (cheap guard, ~60 lines).
- **`SELECT *` (143 sites).** Mostly narrow tables read by id; only ai_tool_versions (source blob), ais, media_items and sticker lists deserve explicit columns (F8). Do not mass-rewrite.
- **Advisory locks inside transactions (38 sites).** Look heavy, but they encode real races (blocks vs contact-requests, blocks/service.ts:96-110 comment). Keep; document the lock key namespace in one place (`contact-sender:`, `user-block:` ...).
- **Separate ManagedRuntime/pool per DB key in a WeakMap** (effect/sql.ts:80-107): global state, but required so PGlite tests and production share module code; replace only as part of F6 with a `Db` Layer, not earlier.
- **`sandbox/` worker + `web-tools/guarded-fetch.ts` + `sandbox/ip-guard.ts`** (SSRF pinning, `fetchPinnedHttps`): long, but security-critical and well covered (ip-guard.test, host-fetch.test); keep structure.
- **Rate limiting in memory per process** (rate-limit.ts): documented trade-off; fine for single-instance Coolify deploy.
- **`agents/gateway/` factory-with-ctx decomposition** (createXxx(ctx) x11, gateway.ts:55-318 wires them): verbose but explicit; the closure style is not an Effect Layer but converting it is not worth the churn unless main.ts becomes a Layer graph.
- **Search fuzzy pass in JS** (match.ts Damerau): bounded by 5,000 candidates and only for queries >=3 chars; acceptable, just stop shipping `xml` (F13).
- **agents/gateway.test.ts 7,242 lines**: large, but one factory under test; splitting by concern (like the source split) is nice-to-have, no cost saving.

## 5. Open questions for the owner

1. Is the goal "idiomatic Effect everywhere" (F6 + F12, weeks) or "stop paying maintenance on boilerplate" (F1-F5 + F14, ~1 week for ~2,500 lines)? The latter is a strict prefix of the former, so do it first either way.
2. May `getSession` results be cached up to 60 s (F7)? Revocation (sign-out-everywhere, admin disabling a user) would lag by that much.
3. Instance size target: if single-digit users, F8/F9 are hygiene; if hundreds, they are urgent. Same question for the search 5,000-row scan.
4. Should `HttpError` stay a thrown class (current 493 `throw new`, 518 constructions) or become a tagged/Schema error with `HttpApiEndpoint.error(...)` mapping (also gives the clients typed errors and OpenAPI)? This decides F4's target shape.
5. Are git/*, `voice-transcription`, `web-tools`, `sandbox` all still shipped features? They add ~6k lines; no dead entry points were found, but I did not verify production flags (`TOOLS_ENABLED`, etc.).
6. Is changing the ejabberd MAM schema (index on `archive(username, timestamp)` exists per comment at search/routes.ts:172; GIN on text) acceptable, or must search stay read-only on ejabberd's tables?
