# The Effect last mile: what is still on drizzle, hono or zod, and the bigint check

Status: audit (T-0626), 2026-10-08. Written from the code; every claim cites
`file:line`. No code was changed by this task.

**Progress (lead, 2026-10-09 ~01:55): the line numbers below are from 10-08 and are now stale.**

| Done | Items | Tasks |
|---|---|---|
| Done | C1 | T-0663, T-0670, T-0672 |
| Done | C2 | T-0664, T-0670, T-0679 |
| Done | C3 | T-0660 |
| Done | C3b | T-0648 and T-0652, plus T-0671, T-0677 and T-0681; `ais/service.ts` has no drizzle |
| Done | C4 | T-0667 to T-0669 and T-0675 |
| Done | C5 | T-0665, T-0666, T-0670 |
| Done | F6 | T-0674 |
| Done | A1 to A11 | A7 = T-0685 |
| Done | E1 to E4 | |

**In progress:**
- groups, in slices T-0678, T-0682 and T-0686, with `createGroup` and `patchGroup` left;
- topics, in slices T-0676, T-0680 and T-0683, with `createTopic` and `patchTopic` left;
- approvals/service (T-0684).

**Left:**
- D1 to D3, which run after every module is converted (D2 needs the better-auth adapter decision);
- A12 git (Julio's call);
- B1, the edge flip.

This document is the plan the lead cuts small tasks from. It lists every
non-test file that still imports a legacy library, groups them by what blocks
each one, gives an ordered list of small tasks, and checks the one class of
conversion bug that is silent: `effect/sql` returns a Postgres `bigint` as a
string while drizzle's `bigint(..., { mode: 'number' })` typed it as a number.

## 0. How the inventory was produced

```bash
git grep -lE "from '(drizzle-orm|hono|@hono/|zod|zustand)" -- 'apps' 'packages' ':!*.test.ts' ':!*.test.tsx'
```

returned **52 files** (75 matching import lines). Dropping files whose only
matches are `import type` removes two:

- `apps/server/src/errors.ts:1` — `import type { ContentfulStatusCode } from 'hono/utils/http-status'` (only).
- `apps/server/src/git/proxy.ts:1` — `import type { Context, Handler } from 'hono'` (only).

`apps/server/src/git/proxy.ts` is still a Hono handler at runtime (it returns a
`Handler` and serves git smart HTTP), so it is discussed in group B even though
it is not a row in the inventory. The remaining **50 files** are the inventory.

No `packages/**` or other `apps/**` file matched: the protocol, web, mobile,
runner and devtools packages are already off these libraries (they import
`effect`/`effect/Schema` instead).

Group keys, used in the table and below:

- **A** — test-only Hono wrappers (a factory only tests mount).
- **B** — the server shell (Hono/`@hono/node-server` still serves traffic).
- **C** — drizzle waiting for a caller's transaction.
- **D** — drizzle core (the schema, client, migrator, auth, test harness).
- **E** — zod leftovers.
- **F** — plain drizzle modules with no blocker; convertible now.

---

## 1. Inventory

One row per file. "Blocked by" cites the group or the `file:line` that keeps it
on the legacy library.

| File | Lines | Legacy | Grp | Blocked by (evidence) |
| --- | ---: | --- | :-: | --- |
| `apps/server/src/actions/gateway.ts` | 976 | drizzle | F | None. `db:` calls are plain (`db.select`/`insert`/`update`); no caller holds its transaction. |
| `apps/server/src/agents/gateway/group-turn.ts` | 539 | drizzle | F | None. Plain reads/writes. |
| `apps/server/src/agents/memory/indexer.ts` | 327 | drizzle | F | None, but see the bigint note (`aiMemoryState.indexedThroughMicros` at `:213`, `:218`). |
| `apps/server/src/agents/memory/store.ts` | 599 | drizzle | C | `deleteRoomMemory` `:522` takes the caller's transaction: `groups/service.ts:1114` passes `tx` (chain C5). Its `topics/service.ts:924` caller passes a real `deps.db`. |
| `apps/server/src/ais/service.ts` | 1245 | drizzle | C | Calls `connections/service.ts` `decryptForGatewayUse` inside its own transactions at `:879` and `:975`; the callee cannot move until these do (see chain C3). Six further transactions take no caller-supplied transaction: `:402`, `:465`, `:490`, `:533`, `:561`, `:1011` (task C3b). |
| `apps/server/src/app.ts` | 730 | drizzle, hono | B | `new Hono` at `:256`; `requestId()` `:270`; origin guard `:272`; CORS `:296`; Hono-only `app.all('/api/auth/*')` at `:312`. |
| `apps/server/src/approvals/routes.ts` | 52 | hono | A | Wrapper `createApprovalsRoutes` (`:36`) only for `approvals/routes.test.ts`, `approvals/rules.routes.test.ts`. |
| `apps/server/src/approvals/rules.ts` | 332 | drizzle | C | `createRule` `:108`, `findActiveRuleForUpdate` `:81`, `revokeActiveRulesForAiInGroup` `:282` take the caller's drizzle transaction (see chain C1). |
| `apps/server/src/approvals/service.ts` | 764 | drizzle | C | `db.transaction` at `:331` calls `createRule` at `:357` (chain C1). |
| `apps/server/src/audit/api.ts` | 235 | hono | B | Effect `createAuditApi` `:148` plus the Hono wrapper `createAuditRoutes` `:223` used by `audit/routes.test.ts`. |
| `apps/server/src/auth/auth-schema.ts` | 93 | drizzle | D | better-auth's tables via `drizzleAdapter` (`auth/auth.ts:2,48`); replaced by the adapter decision (chain D2). |
| `apps/server/src/auth/cli-config.ts` | 42 | drizzle | D | Builds a `drizzle(postgres(...))` handle at `:40` for the better-auth CLI/schema tooling. |
| `apps/server/src/connections/routes.ts` | 35 | hono | A | Wrapper `createConnectionsRoutes` (`:27`) only for `connections/routes.test.ts`. |
| `apps/server/src/connections/service.ts` | 174 | drizzle | C | `decryptForGatewayUse` `:160` stays on drizzle (comment `:151-154`); caller is `ais/service.ts` (chain C3). |
| `apps/server/src/contact-requests/api.ts` | 463 | zod | E | `legacyCreateBodySchema` `:117` reproduces the old zod message (comment `:113`). |
| `apps/server/src/db/client.ts` | 28 | drizzle | D | `createDb` `:18` and the `ServerDatabase` union `:9-11`; every registry/runtime is keyed on it (chain D1). |
| `apps/server/src/db/migrate.ts` | 18 | drizzle | D | Drizzle migrator `:8`; replaced by `runSqlMigrations` (chain D3). |
| `apps/server/src/db/schema.ts` | 1534 | drizzle, zod | D | Source of truth for `db:generate`; also exports zod-derived `GroupKind` `:213-214` and `AvatarOwnerKind` `:898-899` (group E). |
| `apps/server/src/drafts/routes.ts` | 36 | hono | A | Wrapper `createDraftsRoutes` (`:22`) only for `drafts/routes.test.ts`. |
| `apps/server/src/effect/http.ts` | 214 | @hono | B | `getConnInfo` `:16`; `forwardRequest` `:162`; `mountEffectApi`/`mountEffectRoutes` `:190`,`:206` are the Hono↔Effect bridge. |
| `apps/server/src/effect/sql.ts` | 205 | drizzle | D | The drizzle handle is used only in `snapshotOfMigratedDatabase` `:127` (`runMigrations(drizzle(...))`); drops after the migrator switch (chain D3). |
| `apps/server/src/files/api.ts` | 323 | drizzle | F | None. `findFileRow` `:95` is a plain read. |
| `apps/server/src/files/routes.ts` | 32 | hono | A | Wrapper `createFilesRoutes` (`:24`) only for `files/routes.test.ts`. |
| `apps/server/src/groups/service.ts` | 1406 | drizzle | C | `removeGroupAi` transaction `:1067` calls `revokeActiveRulesForAiInGroup` `:1090` and `deleteToolsForAiInGroup` `:1099`; five more transactions at `:341,567,630,777,989` (chains C1, C2). |
| `apps/server/src/handles/api.ts` | 279 | zod | E | `legacyClaimBodySchema` `:72` reproduces the old zod message (comment `:68`). |
| `apps/server/src/index.ts` | 549 | @hono | B | `serve` from `@hono/node-server` at `:1`, used at `:401`; edge flips to `NodeHttpServer` (group B). |
| `apps/server/src/integrations/settings.ts` | 60 | drizzle | C | Takes `SetupTransaction` (`:44`, `:58`) from `setup/settings.ts` (chain C4). |
| `apps/server/src/invite-links/routes.ts` | 77 | @hono | A | Hono-typed socket helper (`getConnInfo` `:1`, `clientIpFor` `:50`); only `invite-links/invite-links.test.ts` imports `trustedClientIp` `:62`. The `clientIpFor` path is unused (stale comment `:47-49`). |
| `apps/server/src/machines/routes.ts` | 77 | @hono, hono | A | Wrapper `createMachinesRoutes` (`:48`) mounted by `machines/routes.test.ts` and by `machines/hub.test.ts:27,684` (which injects the `isMachineOnline` seam `:41`, passed at `:688`); `getConnInfo` `:10`. |
| `apps/server/src/media/indexer.ts` | 411 | drizzle | F | None, but `mediaIndexState.indexedThroughMicros` is read at `:314`,`:320` (bigint note). |
| `apps/server/src/push/api.ts` | 644 | hono | B | Effect `createPushApi` `:239` plus the Hono wrapper `createPushRoutes` `:636` used by `push/routes.test.ts`. |
| `apps/server/src/push/test-tables.ts` | 34 | drizzle | F | None. |
| `apps/server/src/routines/routes.ts` | 48 | hono | A | Wrapper `createRoutinesRoutes` (`:36`) only for `routines/service.test.ts`. |
| `apps/server/src/routines/service.ts` | 570 | drizzle | C | `deleteRoutinesForAiInGroup` `:468` takes the caller's transaction (`groups/service.ts:1106`, chain C5); `deleteRoutinesForAiInTopic` `:447` is called with a real `deps.db` (`topics/service.ts:921`). The routines API is already on effect/sql (`routines/api.ts`). |
| `apps/server/src/setup/api.ts` | 408 | drizzle | C | `deps.db.transaction` `:238` with `SetupTransaction` (chain C4). |
| `apps/server/src/setup/routes.ts` | 83 | @hono, hono | A | Wrapper `createSetupRoutes` (`:55`) only for `setup/routes.test.ts`; `getConnInfo` `:15`. |
| `apps/server/src/setup/settings.ts` | 98 | drizzle | C | Defines `SetupTransaction` (`:34-36`) and the `Queryable` union `:38` (chain C4). |
| `apps/server/src/stickers/api.ts` | 902 | zod | E | Legacy zod bodies/queries `:165-208` reproduce byte-identical messages (comment `:161`). |
| `apps/server/src/stickers/service.ts` | 1261 | drizzle | F | None; transactions at `:294`,`:358` convert with `sql.withTransaction` (no blocker). |
| `apps/server/src/test-support.ts` | 441 | drizzle | D | `drizzle` `:2`, `registerSqlRuntime` `:9`; `createTestContext` builds the handle (chain D1/D4). |
| `apps/server/src/tools/adapters.ts` | 936 | drizzle | F | None. |
| `apps/server/src/tools/api.ts` | 1006 | drizzle | F | None; remaining drizzle reads are plain. |
| `apps/server/src/tools/routes.ts` | 70 | hono | A | Wrapper `createToolsRoutes` (`:47`) only for `tools/routes.test.ts`. |
| `apps/server/src/tools/service.ts` | 1207 | drizzle | C | `deleteToolsForAiInTopic` `:614` and `deleteToolsForAiInGroup` `:636` ride the caller's transaction/test (chain C2). |
| `apps/server/src/topics/rooms.ts` | 478 | drizzle | F | None. |
| `apps/server/src/topics/service.ts` | 974 | drizzle | C | `removeAiFromTopic` calls `deleteToolsForAiInTopic(deps.db, …)` at `:920`; its test path supplies a transaction (chain C2). |
| `apps/server/src/voice-transcription/api.ts` | 487 | drizzle | C | `deps.db.transaction(async (tx: SetupTransaction))` at `:412`,`:445` (chain C4). |
| `apps/server/src/voice-transcription/pipeline.ts` | 318 | drizzle | C | `db.transaction(async (tx: SetupTransaction))` at `:165` (chain C4). |
| `apps/server/src/voice-transcription/settings.ts` | 91 | drizzle | C | Takes `SetupTransaction` (`:50`, `:83`) (chain C4). |
| `apps/server/src/git/routes.ts` | 8 | hono | B | Mounts the Hono git proxy (`createGitRoutes` `:4`); git traffic still runs on Hono. |

### A — test-only Hono wrappers

Each wrapper builds the module's Effect `HttpApi` op and re-registers its routes
on a throwaway `new Hono()` so the existing Hono-level test keeps passing
(`docs/EFFECT_GUIDE.md` item 11). The wrapper is dead in production (`app.ts`
mounts `<module>Api.routes` through `mountEffectRoutes`). What the tests inject:

| Wrapper | Tests that mount it | Injected seams the test needs |
| --- | --- | --- |
| `approvals/routes.ts:36` | `approvals/routes.test.ts`, `approvals/rules.routes.test.ts` | optional `logger` (a captor) |
| `connections/routes.ts:27` | `connections/routes.test.ts` | `now` |
| `drafts/routes.ts:22` | `drafts/routes.test.ts` | `hub` |
| `files/routes.ts:24` | `files/routes.test.ts` | `fetchImpl` (files/api deps), `now` |
| `machines/routes.ts:48` | `machines/routes.test.ts` | `now`, `getClientIp` |
| `routines/routes.ts:36` | `routines/service.test.ts` | `now: () => Date` |
| `setup/routes.ts:55` | `setup/routes.test.ts` | `limiter`, `getClientIp`, `trustedProxyHops`, `sendTestCode`, `swapMailer` |
| `tools/routes.ts:47` | `tools/routes.test.ts` | `now`, `toolRunner` |
| `audit/api.ts:223` (`createAuditRoutes`; re-exported by `audit/routes.ts:5`) | `audit/routes.test.ts` | optional `logger` |
| `push/api.ts:636` (`createPushRoutes`; re-exported by `push/routes.ts:13`) | `push/routes.test.ts` | `sender` (fake) |
| `git/routes.ts:4` | `git/proxy.test.ts` | `fetch` (real Hono router, not an item-11 wrapper) |
| `invite-links/routes.ts:62` | `invite-links/invite-links.test.ts` | none; the test imports `trustedClientIp` |

Each wrapper goes away when its test moves to `createApp(...)` (the push and
audit wrappers live inside their `api.ts`, so removing them drops the file's
last Hono import).

### B — the server shell

- `app.ts` is the outer Hono app: `new Hono` `:256`, request-id `:270`, the
  unsafe-method origin guard `:272`, CORS `:296`, the redacted `/api/*`
  request logging `:304`, and the better-auth catch-all
  `app.all('/api/auth/*', …)` `:312`. It imports `sql` from drizzle only for the
  health/`SELECT 1` path.
- `index.ts` calls `serve({ fetch: app.fetch, … })` `:401` and disposes the
  `effect/sql` runtime at shutdown `:539`.
- `effect/http.ts` is the Hono↔Effect bridge: `forwardRequest` `:162` stamps the
  socket header and `mountEffectApi`/`mountEffectRoutes` `:190`,`:206` register
  Effect handlers on a Hono app. `getConnInfo` `:16` is the only
  `@hono/node-server` runtime dependency.
- `push/api.ts` and `audit/api.ts` still import `Hono` for their test wrapper
  (`:636`, `:223`) even though production mounts their Effect ops.
- `git/routes.ts` and the dropped `git/proxy.ts` still serve git traffic on
  Hono (`git/proxy.ts:1`), with the Hono test `git/proxy.test.ts`.
- `errors.ts:1` (dropped from the inventory as type-only) depends on Hono's
  `ContentfulStatusCode` for the fixed error mapping.

### C — drizzle waiting for a caller's transaction

`effect/sql` runs on a `SqlClient.SqlClient` whose runtime is registered per
top-level `db` (`effect/sql.ts:86-104`), not per drizzle transaction. So a
module whose exported function receives a drizzle transaction handle cannot run
its query through `sqlRuntimeFor(db)`; it must move together with the caller
that opens the transaction. Each chain, caller → callee:

**C1 · approvals rules.**
- `approvals/service.ts:331` opens `db.transaction(async (tx) => …)` and calls
  `createRule(tx as unknown as ServerDatabase, …)` at `:357`.
- `groups/service.ts:1067` opens `db.transaction(async (tx) => …)` and calls
  `revokeActiveRulesForAiInGroup(tx as unknown as ServerDatabase, …)` at `:1090`.
- Callees: `approvals/rules.ts` `findActiveRuleForUpdate` `:81`, `createRule`
  `:108` (which calls `findActiveRuleForUpdate` `:113`), and
  `revokeActiveRulesForAiInGroup` `:282`. The file's other queries are already
  `effect/sql` (`:161-330`).
- **Move order:** convert both caller transactions to `sql.withTransaction`
  first, then the three callees.

**C2 · tools.**
- `groups/service.ts:1067` tx calls `deleteToolsForAiInGroup(tx, …)` at `:1099`.
- `topics/service.ts:920` calls `deleteToolsForAiInTopic(deps.db, …)`; the
  `deps.db` is a real handle there, but `tools/service.test.ts:820,858` drives
  both functions inside a raw drizzle transaction and passes it
  (`rawTx as unknown as typeof context.db`), so the functions must stay on
  drizzle until that test injection changes.
- Callees: `tools/service.ts` `deleteToolsForAiInTopic` `:614`,
  `deleteToolsForAiInGroup` `:636`.
- **Move order:** convert the `groups/service.ts` and `topics/service.ts` call
  sites and rewrite the `tools/service.test.ts` injection first, then delete the
  two drizzle functions.

**C3 · connections → AI gateway.**
- `ais/service.ts` opens transactions at `:853` and `:955` and calls
  `decryptForGatewayUse(txDb, …)` at `:879` and `:975` (also a plain `deps.db`
  call at `:296`).
- Callee: `connections/service.ts` `decryptForGatewayUse` `:160` (comment
  `:151-154` says exactly this).
- **Move order:** convert the two `ais/service.ts` transactions, then the callee
  (or move the decrypt into the transaction effect itself).

**C4 · setup settings cluster.**
- `setup/settings.ts` defines `SetupTransaction` `:34-36` (a drizzle
  `PgTransaction` for postgres-js or PGlite) and `Queryable` `:38`; it exports
  the setup/instance-settings helpers `needsSetup` `:51`, `getMailSettings`
  `:56`, `saveMailSettings` `:70`, `deleteMailSettings` `:90`,
  `takeSetupLock` `:96`.
- Callers holding that transaction: `setup/api.ts:238`
  (`deps.db.transaction(async (tx: SetupTransaction) => { takeSetupLock ...
  needsSetup ... saveMailSettings ... createSetupInvite(tx) })`),
  `voice-transcription/api.ts:412,445`, `voice-transcription/pipeline.ts:165`.
- Other modules that take `SetupTransaction` as a parameter:
  `integrations/settings.ts:44,58`, `voice-transcription/settings.ts:50,83`;
  `integrations/routes.ts:233` re-exports the type.
- **Move order:** introduce one effect/sql transaction seam (a `SetupTransaction`
  abstraction over `SqlClient.SqlClient` / `sql.withTransaction`), convert
  `setup/settings.ts` and `integrations/settings.ts`, then the callers
  `setup/api.ts`, `integrations/routes.ts`, `voice-transcription/{settings,api,pipeline}.ts`.
- `setup/routes.test.ts:226-235` patches `context.db.transaction` and must be
  allowed to switch to the new seam (it wraps the real transaction to park a
  concurrent join; the assertions stay).

**C5 · routines and room memory.**
- `groups/service.ts:1067` tx (the same one C1/C2 use) calls
  `deleteRoutinesForAiInGroup(tx as unknown as ServerDatabase, …)` at `:1106`
  and `deleteRoomMemory(tx as unknown as ServerDatabase, …)` at `:1114`.
- Callees: `routines/service.ts` `deleteRoutinesForAiInGroup` `:468` and
  `agents/memory/store.ts` `deleteRoomMemory` `:522`. Neither can move to
  `runSql` while it can receive that drizzle transaction: a drizzle tx is never
  a registered runtime key, so `sqlRuntimeFor` throws (`effect/sql.ts:99`).
- Their siblings are not blocked: `deleteRoutinesForAiInTopic` `:447` is called
  with a real `deps.db` (`topics/service.ts:921`), and `deleteRoomMemory` is also
  called with `deps.db` (`topics/service.ts:924`) and with `context.db`
  (`agents/memory/cleanup.test.ts:250,263`).
- **Move order:** convert the `groups/service.ts:1067` transaction with C1/C2,
  then the two callees. F7 (`routines/service.ts`) and the `store.ts` half of F3
  wait for that conversion.

### D — drizzle core, in removal order

1. **`db/client.ts` (`:18` `createDb`, `:9-11` `ServerDatabase`) and
   `test-support.ts` (`:2` `drizzle`, `:9` `registerSqlRuntime`).** The
   `ServerDatabase` handle is the `WeakMap` key for every registered runtime
   (`effect/sql.ts:86`) and the first parameter of almost every converted
   function, so it can only be deleted when the last module and the tests stop
   passing a drizzle handle. `test-support.ts`'s `createTestContext` must build
   the effect/sql `SqlTest` client instead (plan (d) step 7).
2. **`auth/auth-schema.ts` (`:1-2`) and `auth/cli-config.ts` (`:40`).** Blocked
   by the better-auth adapter decision (`docs/audit/effect-sql-migration.md` §c):
   a custom `DBAdapter` over `effect/sql` (no new dependency) or the Kysely
   adapter (`pg` + a PGlite dialect). Neither the adapter nor the migration can
   be chosen inside this task's allowed files; the lead must decide.
   `auth/cli-config.ts` feeds the better-auth CLI/schema tooling and dies with
   the drizzle adapter.
3. **`db/migrate.ts` (`:8`) and `db/schema.ts` (1534 lines).** The migrator
   switch is already de-risked: `runSqlMigrations` and the `.sql` loader exist
   and are tested (`effect/sql.ts:156-205`, `effect/sql.test.ts`). `schema.ts`
   stays the `db:generate` source of truth until every module is converted; then
   the drizzle migrator is replaced by `runSqlMigrations` plus the adoption seed
   (plan (d) step 4) and `schema.ts` is deleted (step 5).
4. **`effect/sql.ts` (`:20`, `:127`).** Its only drizzle use is the
   migrated-snapshot helper; when `test-support.ts`/`SqlTest` build from the SQL
   history, drop `import { drizzle }` and `runMigrations` here.

### E — zod leftovers

Only four non-test server files still import zod:

- `handles/api.ts:72` `legacyClaimBodySchema` — kept only to reproduce the old
  `issues[0].message` (`Unrecognized key: …`, `Invalid input: …`) after the
  Effect Schema decode fails (comment `:68-71`); the real decode is
  `HandleClaimBody` `:64`.
- `contact-requests/api.ts:117` `legacyCreateBodySchema` — same pattern (comment
  `:113-116`); the real decode is `CreateContactRequestBody`.
- `stickers/api.ts:165-208` — five legacy zod bodies/one query
  (`legacyCreatePackBodySchema`, `legacyPatchPackBodySchema`,
  `legacyTelegramImportBodySchema`, `legacyReorderPanelBodySchema`,
  `legacyFavoriteBodySchema`, `legacyDiscoverQuerySchema`), kept for
  byte-identical messages (comment `:161-164`).
- `db/schema.ts:213-214,898-899` — `groupKindSchema`/`GroupKind` (unused outside
  the file) and `avatarOwnerKindSchema`/`AvatarOwnerKind` (the type is imported
  by `avatars/service.ts:8` and used at `:371`).

Each zod file leaves when the tests that assert the old text move to the Effect
Schema text (the guide item 10 rule) or when the shared enum types move to
`packages/protocol`/Effect Schema.

### F — plain drizzle modules, convertible now

`actions/gateway.ts`, `agents/gateway/group-turn.ts`,
`agents/memory/indexer.ts`, `files/api.ts`, `media/indexer.ts`,
`push/test-tables.ts`, `stickers/service.ts`,
`tools/adapters.ts`, `tools/api.ts`, `topics/rooms.ts`. None of these is passed
a transaction by a caller and none has a test that patches drizzle (the only
`db.transaction =` patch is `setup/routes.test.ts:226`). `stickers/service.ts`
has real transactions (`:294`,`:358`) but those convert with
`sql.withTransaction`, so they are not a blocker.

Two files that were listed here in the first draft are in fact group C:
`agents/memory/store.ts` (`deleteRoomMemory` `:522`) and `routines/service.ts`
(`deleteRoutinesForAiInGroup` `:468`) receive the `groups/service.ts:1067`
transaction at `:1114` and `:1106` (chain C5). The rest of each file is plain,
but the shared function blocks the file's conversion until C5 lands.

---

## 2. Ordered task list

Sizes: **S** ≤ 0.5 day, **M** ≤ 1 day. "Tests" are the existing tests that must
stay green (or, where marked, the allowed test file the task also edits).
Everything is dependency-ordered: a task may only start once the tasks above it
that share a chain have merged.

### Phase 2 — group C chains (unblock the large modules)

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| C1 | Move the approvals decision + rules onto `effect/sql`: convert `approvals/service.ts:331` and `groups/service.ts:1067` to `sql.withTransaction`, then port `approvals/rules.ts` `findActiveRuleForUpdate`/`createRule`/`revokeActiveRulesForAiInGroup` | `approvals/service.ts`, `approvals/rules.ts`, `groups/service.ts` (removeGroupAi) | `approvals/rules.test.ts`, `approvals/routes.test.ts`, `groups/*.test.ts` | M |
| C2 | Move the tools delete paths: convert the `groups/service.ts:1067` and `topics/service.ts:920` call sites and rewrite the `tools/service.test.ts:820,858` transaction injection, then delete the two drizzle functions | `tools/service.ts`, `topics/service.ts`, `tools/service.test.ts` (allowed) | `tools/service.test.ts`, `topics/*.test.ts` | M |
| C3 | Move the gateway decrypt: convert the `ais/service.ts:853,955` transactions, then `connections/service.ts` `decryptForGatewayUse` | `ais/service.ts`, `connections/service.ts` | `ais/*.test.ts`, `connections/*.test.ts` | M |
| C3b | Convert the other six `ais/service.ts` transactions (`:402`, `:465`, `:490`, `:533`, `:561`, `:1011`); none takes a caller-supplied transaction, so each converts with `sql.withTransaction` on its own | `ais/service.ts` | `ais/*.test.ts` | M |
| C4 | Move the setup settings cluster onto one effect/sql transaction seam | `setup/settings.ts`, `integrations/settings.ts`; then `setup/api.ts`, `integrations/routes.ts`, `voice-transcription/{settings,api,pipeline}.ts`; `setup/routes.test.ts` (allowed seam change) | `setup/routes.test.ts`, `integrations/*.test.ts`, `voice-transcription/*.test.ts` | M |
| C5 | Move the routines and room-memory deletes: convert the `groups/service.ts:1067` transaction (with C1/C2), then port `deleteRoutinesForAiInGroup` and `deleteRoomMemory` | `routines/service.ts`, `agents/memory/store.ts`, `groups/service.ts` | `routines/*.test.ts`, `agents/memory/*.test.ts`, `groups/*.test.ts` | M |

After C1–C5, group C is not finished: C3b still converts the other six
`ais/service.ts` transactions, and `groups/service.ts` may need a second pass for
its other five transactions (`:341,567,630,777,989`). Neither has a callee
blocker, so both can be taken on their own after C1–C5.

### Phase 3 — group F conversions (parallel, except F3/F7, which wait for C5)

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| F1 | Convert the action gateway | `actions/gateway.ts` | `actions/gateway.test.ts` | S |
| F2 | Convert the group turn | `agents/gateway/group-turn.ts` | `agents/gateway/*.test.ts` | S |
| F3 | Convert the AI-memory indexer/store (`store.ts` after C5) | `agents/memory/{indexer,store}.ts` | `agents/memory/*.test.ts` | M |
| F4 | Convert the files API | `files/api.ts` | `files/routes.test.ts` | S |
| F5 | Convert the media indexer (bigint: keep `BigInt(string)`/guard, see §3) | `media/indexer.ts` | `media/*.test.ts` | S |
| F6 | Convert the push test tables | `push/test-tables.ts` | `push/*.test.ts` | S |
| F7 | Convert the routines service (after C5) | `routines/service.ts` | `routines/*.test.ts` | M |
| F8 | Convert the stickers service (two transactions) | `stickers/service.ts` | `stickers/*.test.ts` | M |
| F9 | Convert the tools adapters + API | `tools/adapters.ts`, `tools/api.ts` | `tools/*.test.ts` | M |
| F10 | Convert the topic rooms module | `topics/rooms.ts` | `topics/*.test.ts` | S |

F3 and F7 depend on C5: `agents/memory/store.ts` and `routines/service.ts`
export functions that receive the `groups/service.ts:1067` transaction
(`:1114`, `:1106`), so those files cannot move to `effect/sql` until that
transaction does.

### Phase 4 — group A: retire the Hono wrappers (one per module)

Each task moves the listed test(s) onto `createApp(...)` and deletes the wrapper,
so the file loses its Hono import. Independent of each other; `setup` must wait
for C4 (its test patches `db.transaction`).

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| A1 | Retire `createApprovalsRoutes` | `approvals/routes.ts` | `approvals/routes.test.ts`, `approvals/rules.routes.test.ts` | S |
| A2 | Retire `createConnectionsRoutes` | `connections/routes.ts` | `connections/routes.test.ts` | S |
| A3 | Retire `createDraftsRoutes` | `drafts/routes.ts` | `drafts/routes.test.ts` | S |
| A4 | Retire `createFilesRoutes` | `files/routes.ts` | `files/routes.test.ts` | S |
| A5 | Retire `createMachinesRoutes`; keep the `isMachineOnline` seam (`routes.ts:41`, `api.ts:231,310`) reachable for `machines/hub.test.ts:688` | `machines/routes.ts` | `machines/routes.test.ts`, `machines/hub.test.ts` | S |
| A6 | Retire `createRoutinesRoutes` | `routines/routes.ts` | `routines/service.test.ts` | S |
| A7 | Retire `createSetupRoutes` (after C4) | `setup/routes.ts` | `setup/routes.test.ts` | S |
| A8 | Retire `createToolsRoutes` | `tools/routes.ts` | `tools/routes.test.ts` | S |
| A9 | Retire `createPushRoutes`; `push/api.ts` then drops Hono | `push/api.ts` | `push/routes.test.ts` | S |
| A10 | Retire `createAuditRoutes`; `audit/api.ts` then drops Hono | `audit/api.ts` | `audit/routes.test.ts` | S |
| A11 | Delete `invite-links/routes.ts`: move `trustedClientIp` coverage to `http/client-ip.test.ts` | `invite-links/routes.ts` | `invite-links/invite-links.test.ts` | S |
| A12 | Move the git proxy off Hono (returns an Effect/Web handler), then delete `git/routes.ts` | `git/proxy.ts`, `git/routes.ts` | `git/proxy.test.ts` | M |

### Phase 5 — group E (zod)

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| E1 | Drop the `handles` legacy schema; assert the Effect Schema message | `handles/api.ts` | `handles/*.test.ts` | S |
| E2 | Drop the `contact-requests` legacy schema | `contact-requests/api.ts` | `contact-requests/*.test.ts` | S |
| E3 | Drop the `stickers` legacy schemas | `stickers/api.ts` | `stickers/*.test.ts` | S |
| E4 | Replace `db/schema.ts` zod enums with plain unions / shared Schema | `db/schema.ts`, `avatars/service.ts`, `avatars/api.ts` (imports the schema and decodes it at `:38`,`:100`) | `avatars/*.test.ts` | S |

### Phase 6 — group D (core removal) and group B (edge flip)

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| D2 | Choose and land the better-auth adapter; move the four auth tables to SQL history; delete `auth/auth-schema.ts`, `auth/cli-config.ts` | `auth/*`, `apps/server/drizzle/*.sql` | `auth/*.test.ts` | M (needs a lead decision first) |
| D3 | Switch `runMigrations` to `runSqlMigrations` + adoption seed; delete the drizzle branch | `db/migrate.ts`, `effect/sql.ts` | `effect/sql.test.ts` | M |
| D1 | Update `test-support.ts` to build the `SqlTest` client; then delete `db/client.ts` and `db/schema.ts` | `test-support.ts`, `db/client.ts`, `db/schema.ts` | all server tests | M |
| B1 | Flip the edge: move CORS/origin-guard/request-id/error mapping into `HttpApi` middleware, replace `serve` with `NodeHttpServer`, delete Hono and `effect/http.ts`'s bridge | `app.ts`, `index.ts`, `effect/http.ts` | `app.test.ts`, authz sweep | M |

`errors.ts:1` (Hono `ContentfulStatusCode`) moves with B1.

---

## 3. The bigint check

### 3.1 Every `bigint` column in `apps/server/src/db/schema.ts`

| Table | Column | Declaration |
| --- | --- | --- |
| `media_items` | `at_micros` | `:1400` `bigint('at_micros', { mode: 'number' }).notNull()` |
| `media_index_state` | `indexed_through_micros` | `:1443` `bigint('indexed_through_micros', { mode: 'number' }).notNull()` |
| `ai_memory_state` | `indexed_through_micros` | `:1529` `bigint('indexed_through_micros', { mode: 'number' }).notNull().default(0)` |

Only these three columns (the import is at `:4`). Drizzle's `{ mode: 'number' }`
types each as `number`; `effect/sql` hands a Postgres `int8` back as a string
(confirmed by the comment at `media/api.ts:170-172`).

### 3.2 Every `effect/sql` query that returns one of them

Grep basis: `SqlClient.SqlClient` in non-test `apps/server/src`; then the only
converted code touching these tables is:

| Query | Returns | Treatment | Verdict |
| --- | --- | --- | --- |
| `media/api.ts:359` `` sql`SELECT * FROM media_items …` `` (the media gallery read) | `at_micros` | `raw.map` casts to `MediaItemRow` then overrides `atMicros: Number((row as { atMicros: string \| number }).atMicros)` at `:367`; downstream `toMediaItem` `:210` does `new Date(Math.floor(row.atMicros / 1000))` (no bigint), and the cursor is `String(last.atMicros)` `:379`. | **safe** — explicit `Number(...)`; the SQL `ORDER BY at_micros DESC` `:361` and `AND at_micros < ${before}` `:358` run in the database. |

No other `effect/sql` query returns any of the three columns. `media_index_state`
and `ai_memory_state` are still read through drizzle
(`media/indexer.ts:314`, `agents/memory/indexer.ts:213`), so they cannot produce
a string today.

### 3.3 Conversion watch-list (not bugs today)

These are the places that will hit the string-on-read behaviour when they move
to `effect/sql`. All three happen to be naturally safe, which is why this is a
watch-list and not a defect list:

- `media/indexer.ts:320-321`: `state[0]?.indexedThroughMicros` is compared and
  passed through `BigInt(stored)`. `BigInt()` accepts a string with the same
  result, so the conversion is safe as long as the value is not fed to
  arithmetic/`Date` before the `BigInt(...)` call (it is not: `:321`).
- `agents/memory/indexer.ts:217-218`: same `BigInt(stored)` shape; safe for the
  same reason.
- `files/api.ts:95-114`: `findFileRow` uses `.select()` (all columns), so it
  will return `at_micros` as a string, but the function never reads `atMicros`
  (the value only travels in the row), so nothing breaks. If a later read is
  added, convert it explicitly.

Rule for every conversion: any `effect/sql` query that reads `at_micros` or
`indexed_through_micros` must either cast in SQL (`::int`/`::float8`) or wrap
the value in `Number(...)`/`BigInt(...)` before arithmetic, comparison, JSON
output or `Date` math. `SELECT *` / `RETURNING *` plus a drizzle row type is the
exact trap named in the spec.
