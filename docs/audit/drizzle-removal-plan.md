# The last drizzle removal: test recipe, test-support switch, migrator and deletions

Status: plan (T-0691), 2026-10-09. **No code was changed by this task.** Every
claim cites `file:line`.

Companions (read together):

- `docs/audit/effect-sql-migration.md` — §(a) the conversion recipe, §(b) the
  migration strategy and the tested adoption seed, §(c) better-auth, §(d) the
  removal order, §(e) the per-module estimates.
- `docs/audit/effect-last-mile.md` — §1 the non-test inventory (group D is the
  drizzle core), §2 the task list (D1–D3), §3 the `bigint` watch-list.
- `docs/EFFECT_GUIDE.md:226` — "Tests that fake drizzle stop working" and the
  two proven replacement patterns.

The lead's decisions are in `work/NOW.md:400-401` (2026-10-07): better-auth
moves to a custom adapter over `effect/sql`; `drizzle-kit` migrations stay until
the last step, **then one transaction per migration**.

Scope of what is left, per the task spec: **tests** (56 files import
`drizzle-orm`, plus 13 more that import table objects from `db/schema`),
`test-support.ts` and its seeders, **D3 the migrator**, **D1** (`db/client.ts`,
`db/schema.ts`, `effect/sql.ts`'s drizzle snapshot, `app.ts`'s health check), and
**D2** better-auth (T-0690, later). The in-flight module tasks T-0684
(`approvals/service.ts`) and T-0688 (`groups/service.ts`) remove the last two
production module imports; this plan assumes they land.

---

## 1. Inventory

### How the counts were measured

- **Test files importing drizzle:**
  `git grep -l "from 'drizzle-orm" -- 'apps/server/src/*.test.ts'` → **56**.
- **Query sites:** occurrences of
  `context.db.<select|insert|update|delete|execute>(` (the metric behind the
  spec's 57 for `agents/gateway.test.ts` and 59 for `ais/routes.test.ts`). A
  builder call on its own line after `context.db` (`context.db\n .select(...)`)
  is **not** counted by this metric; totals from the raw builder pattern
  (`.select(`/`.insert(`/… ) are higher: 451 select, 404 insert, 100 update,
  24 delete, 4 execute.
- **Tests:** lines matching `\bit(\.each)?\(`.
- **Tests that import `db/schema` but not `drizzle-orm`:** 13 more files (§1.2),
  found with `comm` over the two `git grep` lists.

### 1.1 The 56 test files that import `drizzle-orm`

`q` = query sites, `lines`, `tests`. Sorted by `q` ascending.

| File | q | lines | tests |
| --- | --: | --: | --: |
| `apps/server/src/auth/invites.test.ts` | 0 | 111 | 7 |
| `apps/server/src/effect/sql.test.ts` | 0 | 132 | 5 |
| `apps/server/src/ais/integration.test.ts` | 0 | 583 | 2 |
| `apps/server/src/machines/hub.effect.test.ts` | 1 | 249 | 3 |
| `apps/server/src/push/routes.test.ts` | 1 | 401 | 9 |
| `apps/server/src/media/routes.test.ts` | 1 | 570 | 10 |
| `apps/server/src/machines/registry.test.ts` | 2 | 113 | 5 |
| `apps/server/src/media/indexer.test.ts` | 2 | 544 | 15 |
| `apps/server/src/voice-transcription/routes.test.ts` | 2 | 621 | 25 |
| `apps/server/src/machines/hub.test.ts` | 2 | 703 | 19 |
| `apps/server/src/agents/memory/compactor.test.ts` | 3 | 207 | 5 |
| `apps/server/src/pins/pins.test.ts` | 3 | 421 | 10 |
| `apps/server/src/integrations/routes.test.ts` | 3 | 515 | 22 |
| `apps/server/src/agents/memory/indexer.test.ts` | 3 | 521 | 10 |
| `apps/server/src/chats/chats.test.ts` | 4 | 242 | 8 |
| `apps/server/src/agents/memory/store.test.ts` | 5 | 522 | 24 |
| `apps/server/src/routines/scheduler.effect.test.ts` | 6 | 232 | 2 |
| `apps/server/src/setup/routes.test.ts` | 6 | 384 | 16 |
| `apps/server/src/invite-links/invite-links.test.ts` | 6 | 884 | 21 |
| `apps/server/src/search/search.test.ts` | 6 | 1250 | 27 |
| `apps/server/src/approvals/sweeper.effect.test.ts` | 7 | 156 | 1 |
| `apps/server/src/agents/memory/routes.test.ts` | 7 | 300 | 7 |
| `apps/server/src/agents/delegation/service.test.ts` | 7 | 458 | 20 |
| `apps/server/src/handles/handles.test.ts` | 8 | 287 | 13 |
| `apps/server/src/audit/routes.test.ts` | 8 | 326 | 11 |
| `apps/server/src/ais/usage.test.ts` | 8 | 392 | 13 |
| `apps/server/src/blocks/blocks.test.ts` | 8 | 403 | 14 |
| `apps/server/src/stickers/telegram-import-routes.test.ts` | 8 | 728 | 24 |
| `apps/server/src/actions/production-announcer.test.ts` | 9 | 253 | 4 |
| `apps/server/src/actions/demo.test.ts` | 10 | 340 | 7 |
| `apps/server/src/audit/service.test.ts` | 11 | 438 | 21 |
| `apps/server/src/contact-requests/contact-requests.test.ts` | 11 | 575 | 16 |
| `apps/server/src/chat-prefs/chat-prefs.test.ts` | 12 | 571 | 17 |
| `apps/server/src/approvals/service.test.ts` | 12 | 1350 | 46 |
| `apps/server/src/db/migrate.test.ts` | 13 | 180 | 9 |
| `apps/server/src/agents/memory/cleanup.test.ts` | 13 | 308 | 4 |
| `apps/server/src/contacts/contacts.test.ts` | 13 | 324 | 8 |
| `apps/server/src/groups/visibility.test.ts` | 13 | 833 | 24 |
| `apps/server/src/machines/routes.test.ts` | 13 | 1143 | 26 |
| `apps/server/src/tools/service.test.ts` | 13 | 1303 | 37 |
| `apps/server/src/backgrounds/routes.test.ts` | 14 | 406 | 13 |
| `apps/server/src/tools/routes.test.ts` | 14 | 793 | 19 |
| `apps/server/src/approvals/rules.routes.test.ts` | 15 | 981 | 23 |
| `apps/server/src/routines/service.test.ts` | 16 | 887 | 20 |
| `apps/server/src/routines/scheduler.test.ts` | 17 | 924 | 21 |
| `apps/server/src/approvals/sweeper.test.ts` | 18 | 422 | 6 |
| `apps/server/src/topics/topics.test.ts` | 18 | 1101 | 32 |
| `apps/server/src/approvals/routes.test.ts` | 20 | 1010 | 20 |
| `apps/server/src/approvals/rules.test.ts` | 24 | 1171 | 30 |
| `apps/server/src/actions/flow.e2e.test.ts` | 27 | 1460 | 20 |
| `apps/server/src/actions/gateway.test.ts` | 27 | 1794 | 46 |
| `apps/server/src/roles/roles.test.ts` | 30 | 1150 | 22 |
| `apps/server/src/groups/groups.test.ts` | 35 | 1750 | 56 |
| `apps/server/src/ais/service.test.ts` | 44 | 873 | 26 |
| `apps/server/src/agents/gateway.test.ts` | 57 | 6846 | 161 |
| `apps/server/src/ais/routes.test.ts` | 59 | 2023 | 49 |

The spec's two "largest" numbers are reproduced exactly: `agents/gateway.test.ts`
= 57, `ais/routes.test.ts` = 59 (`agents/gateway.test.ts:3` imports `eq, and`;
its seed helpers are at `:352`, `:2879`, `:4480`, `:4902`).

`q` undercounts three files that build a **local** drizzle handle and chain
across lines: `auth/invites.test.ts:26` (`drizzle(client, { schema })`, one
multi-line `.insert(schema.user)` at `:54-56`), `ais/integration.test.ts`
(one multiline `.update`), and `effect/sql.test.ts` (no builders; drizzle is
used only for the migrator in `sql.test.ts:49,92`). `db/migrate.test.ts` uses a
local `db` too but its `.select()`/`.insert()` calls are single-line, so its 13
are captured.

### 1.2 The 13 further test files that import table objects from `db/schema`

They do not import `drizzle-orm`, but they call `context.db.*` (the drizzle
handle) or read `$inferSelect` through the table objects. They must move before
`db/schema.ts` can be deleted. `q` as above.

| File | q | lines | tests | note |
| --- | --: | --: | --: | --- |
| `apps/server/src/actions/announce.test.ts` | 0 | 160 | 10 | `type ApprovalRow = typeof approvals.$inferSelect` `:12` |
| `apps/server/src/agents/listener/score.test.ts` | 8 | 341 | 14 | 8 inserts |
| `apps/server/src/auth/auth.test.ts` | 13 | 738 | 36 | 13 selects on `user`/`session` |
| `apps/server/src/avatars/routes.test.ts` | 11 | 590 | 18 | 8 select, 3 insert |
| `apps/server/src/chat-folders/chat-folders.test.ts` | 3 | 417 | 10 | 3 select |
| `apps/server/src/connections/routes.test.ts` | 4 | 510 | 16 | 3 select, 1 insert |
| `apps/server/src/files/routes.test.ts` | 4 | 608 | 14 | 1 select, 3 insert |
| `apps/server/src/push/rooms.test.ts` | 5 | 273 | 5 | 5 insert |
| `apps/server/src/push/service.test.ts` | 19 | 675 | 20 | 19 insert |
| `apps/server/src/stickers/routes.test.ts` | 2 | 761 | 26 | 2 insert |
| `apps/server/src/tools/adapters.test.ts` | 10 | 771 | 27 | 2 select, 8 insert |
| `apps/server/src/xmpp/provisioning.test.ts` | 3 | 167 | 13 | 2 select, 1 insert |
| `apps/server/src/xmpp/routes.test.ts` | 2 | 247 | 8 | 2 select |

So **69 test files** depend on drizzle artifacts (56 + 13).

### 1.3 Per-method totals (query sites), by folder

`context.db.<method>(` sites; grand total **754**.

| Folder | files | select | insert | update | delete | execute | total |
| --- | --: | --: | --: | --: | --: | --: | --: |
| actions | 4 | 28 | 41 | 4 | 0 | 0 | 73 |
| agents | 1 | 1 | 51 | 4 | 1 | 0 | 57 |
| agents/delegation | 1 | 0 | 7 | 0 | 0 | 0 | 7 |
| agents/memory | 5 | 3 | 28 | 0 | 0 | 0 | 31 |
| ais | 4 | 79 | 20 | 11 | 1 | 0 | 111 |
| approvals | 6 | 32 | 56 | 4 | 4 | 0 | 96 |
| audit | 2 | 4 | 12 | 1 | 1 | 1 | 19 |
| auth | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| backgrounds | 1 | 6 | 8 | 0 | 0 | 0 | 14 |
| blocks | 1 | 4 | 3 | 0 | 1 | 0 | 8 |
| chat-prefs | 1 | 4 | 6 | 0 | 2 | 0 | 12 |
| chats | 1 | 1 | 3 | 0 | 0 | 0 | 4 |
| contact-requests | 1 | 8 | 1 | 0 | 1 | 0 | 10 |
| contacts | 1 | 9 | 0 | 1 | 0 | 0 | 10 |
| db | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| effect | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| groups | 2 | 30 | 12 | 3 | 0 | 1 | 46 |
| handles | 1 | 8 | 0 | 0 | 0 | 0 | 8 |
| integrations | 1 | 3 | 0 | 0 | 0 | 0 | 3 |
| invite-links | 1 | 5 | 1 | 0 | 0 | 0 | 6 |
| machines | 4 | 8 | 6 | 0 | 1 | 0 | 15 |
| media | 2 | 3 | 0 | 0 | 0 | 0 | 3 |
| pins | 1 | 3 | 0 | 0 | 0 | 0 | 3 |
| push | 1 | 0 | 0 | 0 | 0 | 1 | 1 |
| roles | 1 | 16 | 14 | 0 | 0 | 0 | 30 |
| routines | 3 | 9 | 25 | 5 | 0 | 0 | 39 |
| search | 1 | 3 | 3 | 0 | 0 | 0 | 6 |
| setup | 1 | 3 | 3 | 0 | 0 | 0 | 6 |
| stickers | 1 | 4 | 4 | 0 | 0 | 0 | 8 |
| tools | 2 | 7 | 17 | 3 | 0 | 0 | 27 |
| topics | 1 | 12 | 6 | 0 | 0 | 0 | 18 |
| voice-transcription | 1 | 2 | 0 | 0 | 0 | 0 | 2 |
| **total** | **56** | **326** | **377** | **36** | **12** | **3** | **754** |

### 1.4 Non-test files

Importing `drizzle-orm` directly (10):

| File | Evidence |
| --- | --- |
| `apps/server/src/app.ts` | `import { sql } from 'drizzle-orm'` `:1`; `isDatabaseUp` `:667-674` (`db.execute(sql\`select 1\`)` `:669`) |
| `apps/server/src/approvals/service.ts` | `:2` — in-flight **T-0684** removes it |
| `apps/server/src/groups/service.ts` | `:4` — in-flight **T-0688** removes it |
| `apps/server/src/auth/auth-schema.ts` | `:1-2` |
| `apps/server/src/auth/cli-config.ts` | `:1`, `:40` |
| `apps/server/src/db/client.ts` | `:1-4`, `:9-11` (`ServerDatabase`), `:18-27` (`createDb`) |
| `apps/server/src/db/migrate.ts` | `:1-2`, `:8-14`, `:16-17` |
| `apps/server/src/db/schema.ts` | `:1`, `:16` (1531 lines) |
| `apps/server/src/effect/sql.ts` | `:20`, `:27`, `:127` (snapshot) |
| `apps/server/src/test-support.ts` | `:2`, `:8`, `:293`, `:306` |

Depend on drizzle-derived types/APIs without importing `drizzle-orm` (they must
change with the final deletions):

- `apps/server/src/index.ts:32` (`createDb`), `:33` (`runMigrations`),
  `:72-73`, `:102` (`registerSqlRuntime`), `:151` (`createDbMachineRegistry`).
- `apps/server/src/auth/invite-cli.ts:4-6`, `:72` (`createDb`), `:75`
  (`runMigrations`), `:78` (`registerSqlRuntime`).
- `apps/server/src/db/migrate-cli.ts:3-4`, `:9` (`createDb`), `:12`
  (`runMigrations`).
- `apps/server/src/machines/registry.ts:38` (`createDbMachineRegistry(db:
  ServerDatabase)`).
- `apps/server/src/auth/auth.ts:2` (`drizzleAdapter`), `:8` (`* as schema`),
  `:48` (`database: drizzleAdapter(db, { provider: 'pg', schema })`) — **D2**.

`apps/server/src/db/migrate-cli.ts` and `apps/server/src/auth/invite-cli.ts`
are the two CLI entry points under the `db:migrate` script
(`apps/server/package.json:12`); both go with **D3**.

### 1.5 `test-support.ts` exports that use drizzle

- `snapshotOfMigratedDatabase` `:291-297` — `runMigrations(drizzle(template, { schema }))` `:293`.
- `createTestContext` `:304-348` — `drizzle(client, { schema })` `:306`,
  `registerSqlRuntime(db, '')` `:310`, `createAuth({ db, … })` `:329`,
  `disposeSqlRuntime(db)` `:344`.
- `TestContext.db: PgliteServerDatabase` `:244`; `testApp` passes `context.db`
  to `createApp` `:356`.
- The seed helpers: `bootstrapUser` `:423-430` and `contactOf` `:433-441` seed
  through `createInvite(context.db, …)` `:428`, `:439`.
- `TestMailer` `:31-45`, `FakeAdminClient` `:48-240`, `testXmppConfig`,
  `expectedJid`, `nextClientIp`, `signUpWithInvite` are drizzle-free.

### 1.6 Row types and table objects

- `$inferSelect` / `$inferInsert` in tests: only two places —
  `apps/server/src/actions/announce.test.ts:12` and
  `apps/server/src/actions/flow.e2e.test.ts:238`.
- Table objects are imported in all 69 files (§1.1/§1.2): 56 as `* as schema`
  or named tables with `drizzle-orm`, 13 named from `db/schema`.
- 18 non-test modules export a `*Row` type, but 12 of them are still
  `typeof <table>.$inferSelect` and so die with `db/schema.ts`
  (`apps/server/src/pins/service.ts:26` is the example; the hand-written ones
  are `connections/service.ts:9`, `contact-requests/service.ts:29`,
  `handles/store.ts:19`).

---

## 2. A test recipe

### 2.1 The helper (`H1`)

The only thing a test needs is access to the `SqlClient` that
`registerSqlRuntime` already built for the test database
(`test-support.ts:310`). Two small additions, both following the proven runner
in `pins/service.ts:60-64`:

In `apps/server/src/effect/sql.ts` — register a runtime for a bare PGlite
client (no drizzle handle), and make the registry key any object:

```ts
// effect/sql.ts
const runtimes = new WeakMap<object, SqlRuntime>();

export function registerPgliteSqlRuntime(pglite: PGlite): SqlRuntime {
  const existing = runtimes.get(pglite);
  if (existing !== undefined) {
    return existing;
  }
  const runtime = ManagedRuntime.make(
    PgliteClient.layer({ liveClient: pglite, transformResultNames: snakeToCamel, transformJson: false }),
  );
  runtimes.set(pglite, runtime);
  return runtime;
}
```

In `apps/server/src/test-support.ts`:

```ts
import type { Effect } from 'effect';
import type { SqlClient, SqlError } from 'effect/sql';
import { sqlRuntimeFor } from './effect/sql';

// Runs one effect on the SQL client registered for this test context, so a
// test seeds and asserts through the same effect/sql runtime the modules use.
export function testSql<A>(
  context: Pick<TestContext, 'db'>,
): (effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>) => Promise<A> {
  return (effect) => sqlRuntimeFor(context.db).runPromise(effect);
}
```

Exact signature: `testSql(context)` takes the context (or anything with `db`)
and returns a runner `(effect) => Promise<A>`, where the effect requires
`SqlClient.SqlClient` and can fail with `SqlError.SqlError`. Use:
`await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; … }))`.
`ManagedRuntime.runPromise` rejects on failure, so a test that wants to assert
a failure wraps the call in `await expect(...).rejects.toThrow(…)`.

Note `context.db` stays the **runtime key**, not a live client: `testSql` only
looks it up in the `WeakMap` at `effect/sql.ts:86`. That is why the helper can
land before the test-support switch (§3) and why every conversion below is
independent.

### 2.2 Before / after, four shapes

The raw SQL names **snake_case columns** (`pins/service.ts:150-151`:
`id, chat_jid, message_id, sender_name, …`); results come back camelCased by
`transformResultNames` (`effect/sql.ts:56`). Parameters are always bound
(`${value}`), never string-interpolated.

**Select with `where`** (the `findInviteByCode` shape, `auth/invites.ts`):

```ts
// before
const rows = await db.select().from(schema.invites).where(eq(schema.invites.code, code));
// after
const rows = await testSql(context)(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ id: string; code: string }>`SELECT * FROM invites WHERE code = ${code}`;
}));
```

**Insert:**

```ts
// before (auth/invites.test.ts:54-56)
await db.insert(schema.user).values({ id: 'user-1', name: 'Creator', email: 'creator@example.com' });
// after
await testSql(context)(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO "user" (id, name, email) VALUES (${'user-1'}, ${'Creator'}, ${'creator@example.com'})`;
}));
```

**Update:**

```ts
// before
await db.update(schema.groups).set({ title }).where(eq(schema.groups.id, groupId));
// after
await testSql(context)(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE groups SET title = ${title} WHERE id = ${groupId}`;
}));
```

**Count** (the `count(*)::int AS total` rule from
`docs/audit/effect-sql-migration.md:48`; `pins/service.ts:143`):

```ts
// before
const [{ total }] = await db.select({ total: count() }).from(schema.xmppAccounts);
// after
const [row] = await testSql(context)(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM xmpp_accounts`;
}));
```

Tests that already build their own PGlite + drizzle + migrations should switch
their `beforeEach` to `createTestContext()` (`test-support.ts:304`) or to
`freshMigratedPglite()` (`effect/sql.ts:133`) plus
`registerPgliteSqlRuntime`; the four affected files are
`auth/invites.test.ts`, `db/migrate.test.ts`, `ais/integration.test.ts` and
`effect/sql.test.ts` (`new PGlite()` at `invites.test.ts:25`,
`migrate.test.ts:25`, `sql.test.ts:91,121`).

### 2.3 Row types once `db/schema.ts` is gone

1. Prefer the `*Row` type the module already exports: `PinRow`
   (`pins/service.ts:26`), `AvatarRow` (`avatars/service.ts:28`),
   `MachineRow` (`machines/service.ts:19`), etc. Convert the 12 still-`infer`
   ones to a hand-written `interface` when their module conversion lands, then
   import the type in the test.
2. Otherwise write a local type in the test (the `connections/service.ts:9`
   pattern), e.g. `actions/announce.test.ts:12` becomes a hand-written
   `interface ApprovalRow { … }` with the same fields.
3. Never import a table object from `db/schema` in a test after conversion;
   the `* as schema` import goes with `drizzle-orm`.

The `bigint` rule from `docs/audit/effect-last-mile.md` §3 applies to seeded
values too: `at_micros` / `indexed_through_micros` read back as strings, so
cast in SQL (`::int`) or wrap in `Number(...)`/`BigInt(...)`.

---

## 3. The test-support switch (`S1`)

**Today** (`test-support.ts:304-348`): `createTestContext` builds
`drizzle(client, { schema })` `:306`, registers it as the runtime key `:310`,
hands it to `createAuth` `:329`, and exposes it as `TestContext.db`
(`:244`). `snapshotOfMigratedDatabase` `:291-297` migrates a template through
`runMigrations(drizzle(template, { schema }))` `:293`.

**Target:** `createTestContext` builds only a raw `PGlite` and registers the
effect/sql runtime for it:

```ts
const client = await freshDatabase();          // still a snapshot, see D3
const db = client;                              // PGlite is the runtime key
registerPgliteSqlRuntime(client);               // replaces drizzle(client, { schema })
```

`context.db` stays, but its type shrinks. After every module is converted, `db`
is used for exactly one thing: as the `WeakMap` key of
`sqlRuntimeFor(deps.db)` (`effect/sql.ts:86,98`). The `ServerDatabase` union
(`db/client.ts:9-11`) is therefore no longer needed; keep a **thin runtime-key
alias** so the `db: ServerDatabase` signatures in 96 non-test files (532
occurrences) do not change:

```ts
// effect/sql.ts (or a small db/types.ts)
export type ServerDatabase = object;
```

`sqlLayerFor` (`effect/sql.ts:65-84`) then keeps only its production branch
(`PgClient.layer`); the PGlite branch and `isPgliteDatabase` (`:41-43`) are
replaced by `registerPgliteSqlRuntime`. This answers the spec's question: **yes,
a thin `ServerDatabase` can stay as the runtime key**; the long-term plan F1/F3
(the `Database` `Context.Service` in `docs/audit/effect-sql-migration.md` §d step
2) replaces the parameter entirely, but that is a separate refactor.

**Ordering with D2 (`T-0690` better-auth).** `createAuth` still takes `db` and
wraps it in `drizzleAdapter` (`auth/auth.ts:48`), so the drizzle handle cannot
disappear from tests until the auth adapter switch lands. Two options:

- **Recommended:** land D2 first; `createAuth` takes the `SqlClient`/runtime and
  the test context no longer needs a drizzle handle. Then `S1` is a pure
  deletion.
- If `S1` must land first, keep the drizzle handle **only** for `createAuth`
  and use the PGlite as the module runtime key (two references to the same
  PGlite). This is transitional debt and is deleted by D2.

**Sequence inside `S1`:** (1) move both snapshots (`test-support.ts:291` and
`effect/sql.ts:125`) to `runSqlMigrations` **after** D3; (2) drop the
`drizzle`, `schema`, `runMigrations` and `PgliteServerDatabase` imports from
`test-support.ts:2,6,7,8`; (3) add `testSql` (§2.1); (4) run the whole server
suite.

---

## 4. The migrator switch (`D3`)

The loader and the migrator call already exist and are tested
(`effect/sql.ts:156-205`, `effect/sql.test.ts:90-131`). Switch `runMigrations`
from the drizzle migrator (`db/migrate.ts:8-14`) to `runSqlMigrations` and
delete the drizzle branch.

**Steps**

1. In `effect/sql.ts`, keep `sqlFileLoader(migrationsFolder)`
   (`migrationsFolder` at `db/migrate.ts:6`) and add a runner that (a) ensures
   the journal, (b) applies the adoption seed when a drizzle journal exists and
   the effect journal is empty, (c) runs the pending migrations.
2. Replace the two `runMigrations` call sites — `index.ts:73` and
   `auth/invite-cli.ts:75` — and delete `db/migrate-cli.ts` (or point it at the
   new runner). `db/migrate.ts` and its drizzle imports go with `D1`.
3. Drop the drizzle snapshot in `effect/sql.ts:125-131` and use the new runner
   on the template PGlite (as `sql.test.ts:120-131` already proves).

**Adoption seed for a live database** (tested at
`effect/sql.test.ts:98-107`, documented at
`docs/audit/effect-sql-migration.md:110-119`):

```sql
CREATE TABLE IF NOT EXISTS effect_sql_migrations (
  migration_id integer primary key,
  created_at timestamp with time zone not null default now(),
  name text not null
);
INSERT INTO effect_sql_migrations (migration_id, name)
SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations), 'adopted-from-drizzle'
WHERE NOT EXISTS (SELECT 1 FROM effect_sql_migrations);
```

Drizzle always applies a prefix in file order and `sqlFileLoader` maps file N to
id N+1 (`effect/sql.ts:169`), so `count(*)` is exactly the highest id already
applied; the migrator then skips every committed migration. The committed
history is 46 files (`ls apps/server/drizzle/*.sql`), matching
`effect/sql.test.ts:93,128`.

**One transaction per migration.** The core migrator wraps **all pending
migrations in a single transaction**
(`node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/sql/Migrator.js:146`,
`sql.withTransaction(run)`), while drizzle used one transaction per file
(`docs/audit/effect-sql-migration.md:95`). Julio decided "one transaction per
migration" (`work/NOW.md:401`). To honour it, `runSqlMigrations` must be called
once per pending migration id (a loader filtered to a single id) in a loop, so
each call's one pending migration gets its own transaction. This is the one
behaviour change to implement; it must be covered by a test that fails the
second of two migrations and asserts the first is committed and journaled.

**How to test** (`effect/sql.test.ts`):

- adoption: a PGlite migrated by drizzle (46 journal rows) plus the seed →
  `runSqlMigrations` returns `[]`, schema intact (already there `:90-118`);
- from empty: returns 46 entries, `pinned_messages` exists (already there
  `:120-131`);
- per-migration rollback: two temp migrations, the second fails → first
  committed, second absent from the journal.

**Deploy risk.** The seed is one-shot and must run **before** the first
`runSqlMigrations` on a live database; run it on every startup guarded by
`WHERE NOT EXISTS` (idempotent). The offset (file N → id N+1) and
`count(*)` must agree, or migrations will re-run (data risk) or be skipped.
Keep `drizzle.__drizzle_migrations` intact for rollback. This is a **live-DB
step for Julio**: take a backup and run `db:migrate` against a copy first.

---

## 5. Ordered task list

Sizes: **S** ≤ 0.5 day, **M** ≤ 1 day. Files are the task's Allowed files.
Everything after `H1` is parallel unless marked. Tasks that touch the schema or
a live database need **Julio** and are flagged.

### Phase 0 — the helper (must land first)

| # | Task | Files | Tests | Size |
| --- | --- | --- | --- | :-: |
| H1 | Add `testSql(context)` and `registerPgliteSqlRuntime`; shrink `ServerDatabase` to the runtime-key alias | `test-support.ts`, `effect/sql.ts`, `effect/sql.test.ts` | `effect/sql.test.ts` | S |

### Phase 1 — test conversions, per folder, smallest first (all depend on H1, all parallel)

Order by total query sites (§1.3). "extra" = the §1.2 files that folder must
also convert. Each task drops `drizzle-orm`, `db/schema` and `db/client`
imports from its files and replaces the query sites with `testSql` (§2).

| # | Folder | Files / extra | Query sites | Tests | Size |
| --- | --- | --- | --: | --: | :-: |
| T1 | auth | `auth/invites.test.ts`; extra `auth/auth.test.ts` | 14 | 43 | S |
| T2 | push | `push/routes.test.ts`; extra `push/rooms.test.ts`, `push/service.test.ts` | 25 | 34 | S |
| T3 | pins | `pins/pins.test.ts` | 3 | 10 | S |
| T4 | chats | `chats/chats.test.ts` | 4 | 8 | S |
| T5 | media | `media/indexer.test.ts`, `media/routes.test.ts` | 3 | 25 | S |
| T6 | voice-transcription | `voice-transcription/routes.test.ts` | 2 | 25 | S |
| T7 | search | `search/search.test.ts` | 6 | 27 | S |
| T8 | integrations | `integrations/routes.test.ts` | 3 | 22 | S |
| T9 | blocks | `blocks/blocks.test.ts` | 8 | 14 | S |
| T10 | handles | `handles/handles.test.ts` | 8 | 13 | S |
| T11 | chat-prefs | `chat-prefs/chat-prefs.test.ts` | 12 | 17 | S |
| T12 | contacts | `contacts/contacts.test.ts` | 10 | 8 | S |
| T13 | contact-requests | `contact-requests/contact-requests.test.ts` | 10 | 16 | S |
| T14 | backgrounds | `backgrounds/routes.test.ts` | 14 | 13 | S |
| T15 | agents/delegation | `agents/delegation/service.test.ts` | 7 | 20 | S |
| T16 | agents/memory | `agents/memory/{cleanup,compactor,indexer,routes,store}.test.ts` | 31 | 50 | M |
| T17 | audit | `audit/routes.test.ts`, `audit/service.test.ts` | 19 | 32 | S |
| T18 | setup | `setup/routes.test.ts` (patches `context.db.transaction` at `:226`, see `effect-last-mile.md:230`; allowed seam change) | 6 | 16 | S |
| T19 | invite-links | `invite-links/invite-links.test.ts` | 6 | 21 | S |
| T20 | machines | `machines/{hub.effect,hub,registry,routes}.test.ts` | 15 | 53 | M |
| T21 | topics | `topics/topics.test.ts` | 18 | 32 | M |
| T22 | tools | `tools/routes.test.ts`, `tools/service.test.ts`; extra `tools/adapters.test.ts`; transaction injection at `tools/service.test.ts:820,858` (allowed seam change, `effect-last-mile.md:330`) | 37 | 83 | M |
| T23 | stickers | `stickers/telegram-import-routes.test.ts`; extra `stickers/routes.test.ts` | 10 | 50 | S |
| T24 | roles | `roles/roles.test.ts` | 30 | 22 | M |
| T25 | routines | `routines/{scheduler.effect,scheduler,service}.test.ts` | 39 | 43 | M |
| T26 | groups | `groups/groups.test.ts`, `groups/visibility.test.ts` | 46 | 80 | M |
| T27 | agents (listener score) | `agents/listener/score.test.ts` | 8 | 14 | S |
| T28 | xmpp | `xmpp/provisioning.test.ts`, `xmpp/routes.test.ts` | 5 | 21 | S |
| T29 | avatars / chat-folders / connections / files | `avatars/routes.test.ts`, `chat-folders/chat-folders.test.ts`, `connections/routes.test.ts`, `files/routes.test.ts` | 22 | 58 | S |
| T30 | actions | `actions/{demo,flow.e2e,gateway,production-announcer}.test.ts`; extra `actions/announce.test.ts` (`$inferSelect` `:12`) | 73 | 87 | M |
| T31 | ais | `ais/{integration,routes,service,usage}.test.ts` | 111 | 90 | M |
| T32 | approvals | `approvals/{routes,rules.routes,rules,service,sweeper.effect,sweeper}.test.ts`; `sweeper.effect.test.ts` and the `db.transaction` patches need the `effect/sql` mock seam | 96 | 126 | M |
| T33 | agents/gateway | `agents/gateway.test.ts` (57 sites, 6846 lines, 161 tests — the largest single file; split into slices if needed) | 57 | 161 | M |

### Phase 2 — harness, migrator, health, deletions

| # | Task | Files | Tests | Size | Notes |
| --- | --- | --- | --- | :-: | --- |
| S1 | Test-support switch: build a raw PGlite + `registerPgliteSqlRuntime`; drop the drizzle handle | `test-support.ts` | all server tests | M | After T1–T33 and **D2** |
| D3 | Migrator switch: `runSqlMigrations` + adoption seed + one transaction per migration; delete `db/migrate.ts` and `db/migrate-cli.ts`, update `index.ts:73` and `auth/invite-cli.ts:75` | `effect/sql.ts`, `db/migrate.ts`, `db/migrate-cli.ts`, `effect/sql.test.ts` | `effect/sql.test.ts`, `db/migrate.test.ts` | M | Live-DB risk → **Julio** |
| H2 | Health check off drizzle: `isDatabaseUp` runs `SELECT 1` on the runtime; rewrite `app.test.ts:64-70` | `app.ts`, `app.test.ts` | `app.test.ts` | S | Needs `effect/sql` mock seam |
| DEL | Final deletions: `db/client.ts`, `db/schema.ts`, `auth/auth-schema.ts`, `auth/cli-config.ts`, `drizzle.config.ts`, `db:generate`/`db:migrate` scripts (`apps/server/package.json:11-12`), deps `drizzle-orm` `:24`, `drizzle-kit` `:37` (+ `postgres` `:30` if unused) | those files, `apps/server/package.json`, `apps/server/tsconfig.json:8` | all server tests | M | After every test + S1 + H2; **schema risk → Julio** |

### What runs in parallel, and what needs Julio

- **Parallel:** `H1` first; then `T1`–`T33` in parallel (each touches only its
  folder's test files); `D3` and `H2` can run after their prerequisites without
  waiting for all tests.
- **Serial:** `S1` waits for all `T*` and `D2`; `DEL` waits for `S1`, `D3`,
  `H2`, `D2` and the last module tasks (`T-0684`, `T-0688`).
- **Julio (live-DB or schema):** `D3`'s adoption seed and one-transaction
  semantics on the live database; deleting `db/schema.ts` (the `db:generate`
  source of truth, `drizzle.config.ts:5`) and dropping `drizzle-orm`/
  `drizzle-kit`/`postgres`.
- **Lead decision still open (`docs/audit/effect-sql-migration.md:269-277`):**
  the better-auth adapter (`D2`/T-0690) is the blocker for deleting
  `auth-schema.ts` and `cli-config.ts` and for `S1` if `S1` is to drop the
  drizzle handle completely.

### Notes / deviations

- The task text says "56 test files import `drizzle-orm`"; the inventory found
  **13 more** that import table objects from `db/schema` without importing
  `drizzle-orm` (§1.2). They are in scope for the same reason and must convert
  before `db/schema.ts` is deleted; ignoring them would leave a red `DEL`.
- The task text's D1/D3 labels differ from `docs/audit/effect-last-mile.md:250-274`
  (there D1 = client/schema/harness, D3 = migrator). This plan uses the task's
  labels: **D1** = client + schema + snapshot + health check, **D2** =
  better-auth, **D3** = migrator.
