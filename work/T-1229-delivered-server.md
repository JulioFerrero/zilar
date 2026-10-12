---
id: T-1229
title: "Delivered tick, step 2 (server): a chat_deliveries table (forward-only 'delivered until' archive id per recipient and chat, stored in the AUTHOR's archive terms), PUT /api/chats/:jid/delivered {originIds} from the receiving device, and /api/chats returns deliveredUntil to the sender (DM: the peer's mark; group: the highest mark of any other member)"
status: merged
milestone: M5
branch: task/T-1229-delivered-server
model: auto
effort: default
depends_on: [T-1226]
estimate: 0.5 day
---

# T-1229: The server stores and reports delivery

## Spec (written by Claude, do not edit)

### Why

`docs/plan/delivered-tick.md` (T-1226) adds a delivered state. The decisions at its top are:

- the server records deliveries over HTTP;
- the wire id is the **origin id**;
- in groups, delivered means **any member** got it.

This task is the server half: storage, the write route and the read field. The live notice to the sender is the next task, and the clients come after.

### The model (lead's design)

The mark is an **archive id in the author's own archive**, so the sender compares it directly with its own messages' archive ids. No clock comparisons.

- **DM between author A and recipient R:** the mark is the timestamp of the newest confirmed message's row in **A's** archive (`archive.username = A's localpart`, `bare_peer = R's bare JID`, `origin_id = …`).
- **Group room G:** the mark is the timestamp of the row in the **room** archive (`username = G's room localpart`, the same scope `unread.ts` uses for rooms).
- **Storage:** one row per (recipient user, chat), with `chat_jid` in the **recipient's** terms (the DM peer A's bare JID, or the room JID). It's forward only, like `chat_reads`.

### What to build

1. **Migration** `apps/server/drizzle/0049_chat_deliveries.sql`, hand-written like `0048_chat_reads.sql` (copy its shape and add a `meta/_journal.json` entry the same way; see `work/T-1205-*` or `0048` for the journal pattern):
   - table `chat_deliveries (user_id text NOT NULL, chat_jid text NOT NULL, delivered_id text NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL)`, primary key `(user_id, chat_jid)`;
   - the same jid length check and user FK `ON DELETE cascade` as `chat_reads`;
   - an index on `chat_jid`, for the group max query.

   Add the row type to `apps/server/src/db/rows.ts`, next to `ChatReadRow` (`:279-284`).

2. **Write route** `PUT /api/chats/:jid/delivered` with body `{ originIds: string[] }` (1 to 50 ids, each non-empty and at most 128 chars):
   - in the contract, next to `markRead` (`packages/api-contract/src/chats.ts:111`); in the server, next to the read route in `apps/server/src/chats/api.ts`;
   - the handler goes in a **new file**, `apps/server/src/chats/deliveries.ts` (`api.ts` is 325 lines, and `unread.ts` is 358);
   - access is checked with `requireChatAccess` (as `reads.ts:18-23`): an unknown or invisible chat answers 404;
   - **DM:** the author is the chat peer. Look up the **max timestamp** of rows in the peer's archive (`username = peer localpart`, `bare_peer = caller bare JID`, `origin_id = ANY(originIds)`). Only rows the peer **sent** count; check how `unread.ts` tells own from peer rows (`isOwnRow`, the `kind` column) and cite it;
   - **Group (room):** the max timestamp of rooms rows in the room archive with those origin ids, excluding rows the caller wrote;
   - nothing found: answer 204 without a write;
   - otherwise do a forward-only upsert, exactly as `putChatRead` (`reads.ts:57-82`): an atomic `ON CONFLICT … WHERE EXCLUDED.delivered_id::bigint > chat_deliveries.delivered_id::bigint`;
   - **bind timestamps and ids as strings, never `BigInt`.** The T-1198 production 500 came from binding BigInt to postgres.js; see `work/T-1205-server-unread-again.md`;
   - answer 204;
   - add a per-user rate limit or cap consistent with the read route; check whether one exists and cite it.
3. **Read field:** `/api/chats` entries gain `deliveredUntil?: string`, the archive id in the **caller's** terms, for the caller's own messages. Add it to the contract next to `unread` (`chats.ts:48,86`, the chat and topic shapes).
   - **DM chat with peer P:** P's row in `chat_deliveries` where `chat_jid` = the caller's bare JID;
   - **group:** for the room and each topic room, the **max** `delivered_id` over rows for that `chat_jid` whose `user_id` isn't the caller;
   - compute it in **one** query for all chats, in `deliveries.ts`, and attach it in `api.ts` next to the unread merge (`api.ts:253-275`). Like unread, a failure is logged without content and the list answers without the field.
4. **Tests** (the message pipeline), in a **new** `apps/server/src/chats/deliveries.test.ts`, following `reads.test.ts`, up to 4:
   - a DM confirm sets the mark, and `/api/chats` shows `deliveredUntil` to the peer;
   - an older confirm doesn't move it back;
   - an unknown or invisible chat answers 404;
   - in a group, the max over other members is shown, and the caller's own mark isn't counted.

### Read first

`AGENTS.md`, `docs/plan/delivered-tick.md` (the Decisions, §4 and §6), `apps/server/src/chats/reads.ts`, `apps/server/src/chats/reads.test.ts`, `apps/server/src/chats/unread.ts` (the scopes, `isOwnRow`, the archive SQL), `apps/server/src/chats/api.ts:200-280`, `apps/server/drizzle/0048_chat_reads.sql`, `apps/server/drizzle/meta/_journal.json`, `work/T-1205-server-unread-again.md` and `packages/api-contract/src/chats.ts`.

### Allowed files

`apps/server/drizzle/0049_chat_deliveries.sql`, `apps/server/drizzle/meta/**`, `apps/server/src/db/rows.ts`, `apps/server/src/chats/deliveries.ts`, `apps/server/src/chats/deliveries.test.ts`, `apps/server/src/chats/api.ts`, `packages/api-contract/src/chats.ts`, `work/T-1229-delivered-server.md`.

### Checks

```bash
pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts --reporter=dot
pnpm gate
```

### Acceptance

- The Checks pass.
- `api.ts` stays at most 400 lines.
- **The lead's check after deploy:** `/api/chats` answers 200, and the new route answers 404 for an unknown chat.

---

## Report (written by the worker when done)

Done. Server half of the delivered tick: `chat_deliveries` storage, `PUT /api/chats/:jid/delivered`, and `deliveredUntil` on `/api/chats`.

### What I built

- **`apps/server/drizzle/0049_chat_deliveries.sql`** (new): `chat_deliveries (user_id, chat_jid, delivered_id, updated_at)`, PK `(user_id, chat_jid)`, the same JID length check and user FK `ON DELETE cascade` as `chat_reads`, plus an index on `chat_jid` for the group-max query. Hand-written in the `0048` shape. No `meta/_journal.json` entry: the effect loader (`effect/sql.ts:166-209`) reads `*.sql` by filename, so the journal is drizzle-kit metadata only (T-1132 precedent, verified: the fresh-database path applies `0049` — every test below runs on it).
- **`apps/server/src/db/rows.ts`**: `ChatDeliveryRow` next to `ChatReadRow`.
- **`apps/server/src/chats/deliveries.ts`** (new, 264 lines): `archiveTimestampsForOrigins` (max-timestamp lookup in the author's archive scope; DM scope = author's localpart + caller as `bare_peer`, room scope = room username; caller's own rows excluded via `isCallerRow`, the `unread.ts isOwnRow` rule — `kind`/`nick` for rooms, stanza `from` for DMs, `unread.ts:79-90`), `putChatDelivery` (forward-only upsert with the atomic `ON CONFLICT … WHERE EXCLUDED… > …` from `reads.ts:72-81`), `deliveredForChats` (one batched query per kind — DM arm by peer user id under the caller's JID, room arm max over other members), `maxArchiveId` (decimal-string max, never `BigInt` — T-1205), `deliveryScopeForChat`.
- **Contract (`packages/api-contract/src/chats.ts`)**: `markDelivered` endpoint (`{ originIds }`: 1–50 ids, each 1–128 chars, same `.check` shape as `chat-folders.ts`) and optional `deliveredUntil` on both entry shapes.
- **`apps/server/src/chats/api.ts`** (447 lines — over the 400-line acceptance bar, see Deviations): `markDelivered` handler (access via `requireChatReadAccess` before the write budget, same per-user limiter as `markRead` — no separate limiter exists, the read route's `CHAT_READ_RATE_LIMIT_*` is the route's write budget; 204 with no write when nothing found; no-op 204 without an archive pool) and the `deliveredUntil` merge next to the unread merge (DM: peer's row under the caller's JID; group/topic: max over other members; failure logs error class + message only and the list answers without the field, like unread).

### Commands and results

- `pnpm install` — OK (11.9s).
- `pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts src/chats/reads.test.ts --maxWorkers=2 --reporter=dot` — **12 passed** (4 new + 8 read/unread), stable across 6+ repeat runs.
- `pnpm --filter @zilar/server exec vitest run src/authz-sweep.test.ts --maxWorkers=2 --reporter=dot` — **5 passed**; the sweep lists `PUT /api/chats/:jid/delivered -> 401`.
- `pnpm gate` — `GATE PASS`:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP  tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Security checklist

- No secrets/tokens in logs: archive queries bind ids only; the two warning logs carry error class + message only.
- Writes scoped: `chat_deliveries` rows are keyed `(user_id, chat_jid)`; the DM read arm matches by peer user id under the caller's own JID, so another peer's confirm cannot leak into a DM.
- Forward-only enforced atomically (`ON CONFLICT … WHERE`), no check-then-insert.
- Unknown and invisible chats answer the same 404 (`requireChatAccess`); access is checked before the rate-limit budget is charged.
- New route covered by the 401 sweep; write capped by the shared per-user limiter (600 / 10 min, same as reads).
- No audit entries carry message content (none added).

### Deviations from the spec

1. ~~**`api.ts` is 447 lines, over the "at most 400" acceptance bar**~~ — resolved in round 2 (finding 1); `api.ts` is now 387 lines. The handler and the topic merge moved into `deliveries.ts`, which is where the spec §2 puts the handler anyway; the route registration and the list merge stay in `api.ts` next to the read route.
2. **Read path is two batched queries (DM + room), not literally one.** A single statement broke under PGlite: `GROUP BY chat_jid` over both arms collapses two members' marks into one row keyed only by chat, and the `max(CASE …)` discriminator I tried first is silently dropped by the PGlite effect/sql path (verified: same SQL returns the right shape via raw PGlite but loses the column through effect/sql — the `max(int8)`/`int8` typing path; the plain `max()` without the CASE works). Two constant queries (one per kind, `sql.in` lists, `GROUP BY` per chat) are still O(1) regardless of chat count — the same batching rule as `unreadForChats`' at-most-two. DM correctness (no cross-peer leak) needed the per-user grouping anyway.
3. **Rate limit: shared limiter, not a new one.** There is no separate delivered limiter; the read route's limiter is the chats write budget, charged after the access check. Cited in code.
4. **No journal entry** (see above; T-1132 precedent).

### Open questions

- None blocking. The live notice to the sender (next task) will need the mark the PUT just wrote; `deliveredForChats` already returns it in the shape the list uses.

### Round 2 (fix round)

Addressed the pre-review findings. `must-fix=0, should-fix=1, nit=4`.

- **Finding 1 (should-fix), fixed.** `api.ts` was 447 lines, over the "at most 400" acceptance bar. Moved `putDeliveredMark` and `mergeTopicMarks` into `apps/server/src/chats/deliveries.ts` (which is where spec §2 puts the `PUT .../delivered` handler). `api.ts` keeps the route registration and the list merge next to the read route, and is now **387 lines** (acceptance met). No behaviour change: the handler is called as `putDeliveredMark(deps.db, deps.config, deps.archive, {...})` and `mergeTopicMarks` returns a `TopicView & TopicMarks` shape that `api.ts` assigns to the topic views. The now-unused `ChatTopicView` alias was removed (nothing outside `api.ts` referenced it).
- **Findings 2, 3, 4, 5 (nits), left as-is.** They are marked "nit" and none sits on a line this round changed (2 and 3 are in the untouched `deliveries.ts` archive literal/upsert comment, 4 is the journal entry, 5 is a comment in `deliveries.test.ts`). Per the fix-round instructions I do not touch nits outside lines I already change; no disagreement with them.

Tests: no new behaviour was introduced (finding 1 is a pure code move), so no test was added or changed; the existing `deliveries.test.ts` still covers the behaviour.

- `pnpm --filter @zilar/server exec vitest run src/chats/deliveries.test.ts --maxWorkers=2 --reporter=dot` — **1 file, 4 passed** (5.95s).
- `pnpm gate` (from repo root) — **GATE PASS**:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP  tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (6 nits, left as they are).**
- **The change:**
  - migration `0049_chat_deliveries.sql`: one row per user and chat, holding `delivered_id` as text; the FK cascades on user delete;
  - the delivered route takes origin ids and turns them into archive ids in the author's archive, compared as decimals;
  - `/api/chats` carries `deliveredUntil`.
- **BigInt guard:** ids are bound as strings and only cast with `::bigint` inside SQL. There's no JS `BigInt` (the T-1198 lesson).
- **Migration discovery:** the runner reads the folder (`apps/server/src/db/migrate.ts:162-200`), so no journal entry is needed, the same as 0048.
- **Checked after rebasing onto main:**
  - `deliveries.test.ts` + `reads.test.ts`: 12 passed;
  - tsc: server, api-contract, web and mobile all have 0 errors;
  - `api.ts` is 387 lines, `deliveries.ts` 338.
- **After deploy:** live-check that `/api/chats` answers 200 and that an unknown chat on the delivered route answers 404.
