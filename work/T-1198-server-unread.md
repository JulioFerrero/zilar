---
id: T-1198
title: "MP-F3 server half (MP-6): a chat_reads table and PUT /api/chats/:jid/read store each user's last-read archive id per chat; /api/chats entries (DMs, groups' General and every topic) gain lastMessage and unread computed from the MAM archive against it"
status: merged
milestone: M5
branch: task/T-1198-server-unread
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1198: Unread counts and previews from the server

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-6 (P1, confirmed) and the server half of fix **F3**.
- **Unread is in-memory only:** it's computed only by `handleMessage` (`packages/client-core/src/store/incoming.ts:150`) and cleared by `recordRead` (`packages/client-core/src/store/reads.ts:25-39`). Every `/api/chats` row starts at `unread: 0` with no preview (`packages/client-core/src/store/chat-rows.ts:64,129`).
- **So:**
  - messages that arrived while the app was closed are never counted unread;
  - reading on one device never clears the count on the other;
  - the preview is stale after a reconnect (MP-5).
- **The task is server only.** The clients start using the new fields and the new route in a follow-up task. Old clients ignore the extra fields.

### What exists (read these, and cite the lines you use)
- **The chat list:** `apps/server/src/chats/api.ts` (201 lines), with `ChatListEntry` at `:20-56` and the handler at `:69` onward. It's mounted at `apps/server/src/app.ts:358` (`createChatsApi({ auth, db, config, logger })`).
- **The contract:** `packages/api-contract/src/chats.ts` (86 lines): `DmChatEntry`, `GroupChatEntry`, `ChatsGroup` at `:81-86`.
- **The archive** (ejabberd MAM, read-only): there's a read-only pool, `archive` in `app.ts:140-143`, wired from `main.ts:462,501,581`. Search answers 501 without it (`apps/server/src/search/api.ts:49`).
  - Queries on `archive` are scoped by `username` (the room for a group, or the user's own localpart for DMs) and `bare_peer`: `apps/server/src/push/archive-scan.ts:148-156` and `apps/server/src/search/archive-query.ts:55-62`, using the `(username, timestamp)` index.
  - The MAM id that clients see is the row's `timestamp`. **Verify this** in the ejabberd SQL schema (`deploy/` or the `mod_mam` SQL) or in how `search` builds result ids, and write the line in the Report.
- **Telling sender from receiver:** `push/archive-scan.ts` reads `peer`, `nick` and `xml` to find who sent a row. Reuse the same rule for "not sent by me", and cite it.
- **Migrations:** hand-written SQL in `apps/server/drizzle/`; the newest is `0047_native_push.sql`, so the new one is **`0048_chat_reads.sql`**. Row interfaces go in `apps/server/src/db/rows.ts` (278 lines). Since T-1186, the gate rejects a number that isn't the next one.

### What to build
1. **Migration `apps/server/drizzle/0048_chat_reads.sql`:**
   - the table `chat_reads(user_id <same type as users.id> NOT NULL REFERENCES users(id) ON DELETE CASCADE, chat_jid text NOT NULL, last_read_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, chat_jid))`;
   - check the users id type and the FK style against an earlier migration;
   - add the row interface to `db/rows.ts`.
2. **A new `apps/server/src/chats/reads.ts`:**
   - `PUT /api/chats/:jid/read` with body `{ messageId: string }`. It's in the contract (a new endpoint in `ChatsGroup`) and uses the session middleware;
   - it rejects a `jid` the user can't see: a DM that isn't a contact or own AI, or a group or topic room they aren't a member of. Reuse the access checks the list already uses; no new permission logic;
   - it upserts **only forward**: keep the larger archive id (compare as numbers, since they're microsecond timestamps), so an old device can't move the mark back;
   - answer `204`, with a per-user rate limit like the other budgets (`apps/server/src/rate-limit.ts`): 600 per 10 minutes.
3. **A new `apps/server/src/chats/unread.ts`.** Given the user and the list of chat jids, it returns `{ [jid]: { unread: number, lastMessage?: { id, text, senderName?, at } } }`:
   - read the user's `chat_reads` rows for those jids, from the app DB;
   - at most **2 archive queries in total**, not one per chat. Use `unnest` arrays of (scope, threshold), or a `LATERAL` join, inside the existing `(username, timestamp)` index;
   - unread counts only rows **not sent by the user** with `timestamp > last_read_id`, **capped at 100** (count over a `LIMIT 101` subquery, or equivalent). A chat with no `chat_reads` row counts from the last 30 days only, so a first sign-in doesn't show thousands;
   - `lastMessage` is the newest row per chat. Text comes from `txt`; a non-text row gets a short label ("Photo", "File", "Voice message", "Sticker"). Find how push or search label these, and reuse it;
   - when the archive pool is absent, return `{}`. The list must still answer, without the two fields.
4. **`chats/api.ts`:** pass the archive pool in (change `app.ts:358` **in place**, with no new lines in `app.ts`, which is 583 lines), call `unread.ts` once per list, and add the optional `unread` and `lastMessage` fields to DM entries, group entries (for the General chat jid), and each `TopicView` entry (check that `toTopicViews` output can take two optional fields; if not, add them where the view is built). Extend the contract schemas with the same optional fields. `chats/api.ts` stays at most 400 lines.
5. **Tests** (permissions, the message pipeline), 3, in a new `apps/server/src/chats/reads.test.ts`, using the existing PGlite and archive test support (find how `search` tests fake the archive and cite it):
   - (a) PUT on a chat the user can't see answers 403 or 404 (match the house error) and writes nothing;
   - (b) PUT never moves the mark backwards;
   - (c) the unread count skips own messages and rows at or below the mark.
   - The migration is exercised by the existing migrate-from-empty helper.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (MP-5, MP-6, F3), `apps/server/src/chats/api.ts`, `packages/api-contract/src/chats.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/search/archive-query.ts`, `apps/server/src/search/api.ts`, `apps/server/src/topics/visible-batch.ts`, `apps/server/src/rate-limit.ts`, `apps/server/drizzle/0047_native_push.sql` and `apps/server/src/db/rows.ts`.

### Allowed files
`apps/server/drizzle/0048_chat_reads.sql`, `apps/server/src/db/rows.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/chats/reads.ts`, `apps/server/src/chats/unread.ts`, `apps/server/src/chats/reads.test.ts`, `apps/server/src/app.ts`, `apps/server/src/topics/access.ts`, `packages/api-contract/src/chats.ts`, `work/T-1198-server-unread.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every new or touched file stays at most 400 lines, except `app.ts`, which must not grow.
- **The lead's check after deploy:** `/api/chats` for the test account shows `unread` and `lastMessage` on the Julio DM; `/health` is ok.

---

## Report (written by the worker when done)

Done. Server-side unread counts and previews for `/api/chats`, plus the read-mark route.

### What I built
- **Migration `apps/server/drizzle/0048_chat_reads.sql`**: `chat_reads(user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, chat_jid text NOT NULL, last_read_id text NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL, PK(user_id, chat_jid))`, with the 1–255 JID check, the FK style, and the `chat_reads_user_idx` index copied from the `chat_prefs` migration (`0024_abandoned_skullbuster.sql:1-13`; users id is `text`, FK style per `0043_giant_nitro.sql:27-29`). Row interface `ChatReadRow` added to `db/rows.ts`.
- **`apps/server/src/chats/reads.ts`** (70 lines): `putChatRead` — validates the mark is a non-empty numeric archive id (400 otherwise), resolves access through `requireChatAccess` (`chat-prefs/access.ts:101-133`, the same rule the list uses, 404 for unknown and invisible alike), and upserts forward-only. The forward-only rule is atomic: the early return skips the write, and the `ON CONFLICT ... WHERE EXCLUDED.last_read_id::bigint > chat_reads.last_read_id::bigint` keeps a racing older write from winning (per AGENTS.md §security, read-then-write is not enough on its own).
- **`apps/server/src/chats/unread.ts`** (319 lines): `unreadForChats` returns `{ [jid]: { unread, lastMessage? } }`. Reads the user's `chat_reads` rows, filters the list's chats through the caller's archive scope (`allowedArchives`, `search/service.ts:77-144`), then runs **at most 2 archive queries total**: (1) a `LATERAL` join of one capped (101) newest-rows lookup per chat inside the existing `(username, timestamp)` index, (2) a `LATERAL` newest-row lookup for chats the first query missed. Unread counts non-own rows after the mark, capped at 100; no-mark chats count from the last 30 days only; previews label non-text rows Photo/File/Voice message/Sticker (labels match `apps/web/src/components/PinsPanel.tsx:16-22`). Own-row rule reused from push (`push/candidates.ts:86-88` for rooms via `nick`, `search/snippet.ts:52-58` for DMs via stanza `from`). Absent archive pool returns `{}` and the list keeps its old shape.
- **`chats/api.ts`** (314 lines): list builds one scope map (DMs, group General jids, every visible topic) and calls `unreadForChats` once; `unread`/`lastMessage` added to DM entries, group entries, and each topic via a `ChatTopicView = TopicView & ChatUnreadFields` intersection (so `topics/access.ts` is untouched). New `markRead` handler: access check → 600/10min write budget (429 `rate_limited`) → write; answers 204 (`HttpApiSchema.NoContent`). Added `schemaErrorLayer` so a bad payload is the house 400 `invalid_request` (previously the group had none, the list needed none).
- **Contract `packages/api-contract/src/chats.ts`** (115 lines): `ChatLastMessage` struct, optional `unread`/`lastMessage` on `DmChatEntry` and `GroupChatEntry`, and `PUT /chats/:jid/read` with `{ messageId }` → NoContent on `ChatsGroup` (session middleware, so the 401 sweep covers it automatically).
- **`app.ts`**: line 358 only, still 583 lines: `createChatsApi({ auth, db, config, logger, archive })`. `ChatsApiDependencies.archive` is required-but-nullable (`ArchivePool | undefined`) so the call fits on one prettier-clean line; undefined = no unread.
- **Tests `apps/server/src/chats/reads.test.ts`** (4 tests, PGlite archive fake copied from `push/api-preview.test.ts:19-50`): (a) PUT on an invisible chat answers 404 `not_found` and `chat_reads` stays empty; (b) newer mark then older mark keeps `unread: 1` (only the row after the newer mark counts); (c) rows at/below the mark and the caller's own outgoing DM row don't count, preview is the newest incoming row; 401 without a session.

### Verified spec lines
- MAM id = archive `timestamp`: `docs/SEARCH_NOTES.md:12` ("`timestamp bigint` — microseconds since epoch, also the MAM stanza id") and `:49-50` ("`messageId` is `origin_id`; `at` is `timestamp` as ISO"). Stored marks and comparisons are therefore microsecond-timestamp bigints; `lastMessage.id` is the row's `origin_id` (what clients address edits/reactions by, SEARCH_NOTES.md:19-21).
- Sender-vs-receiver rule: `push/candidates.ts:86-88` (rooms: `nick` vs own localpart) and `search/snippet.ts:52-58` (DMs: stanza `from` vs own bare JID). Cited in code comments.

### Checks (real results)
- `pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot`: 4 passed (run 3× during work, last at the end).
- `pnpm gate`: `GATE PASS` — PASS install/format/lint/typecheck/effect, PASS tests @zilar/server, SKIP tests @zilar/api-contract (no nearby test files), `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`.

### Deviations / notes
- `topics/access.ts` (allowed) left untouched: topic entries gain the two optional fields through the `ChatTopicView` intersection in `chats/api.ts` instead of editing `TopicView` where the view is built — same wire shape, smaller blast radius.
- First-draft unread query used one global page with per-branch minimum thresholds; replaced with per-chat `LATERAL` capped lookups so a loud chat can't starve a quiet one's count, still 2 queries max.
- `app.ts` grew by one line mid-task via a prettier-mandated expansion; reworked the call to a single line so it is back at exactly 583 lines.
- Security checklist: no secrets/ids-in-logs (audit untouched); mark write scoped by (user_id, chat_jid); forward-only enforced atomically in SQL; unknown/invisible chats share one 404; new route under Session (401 sweep automatic — gate's scope step passed, and the test asserts 401); write has the 600/10min budget; no audit entries added.

### Open questions
None. Follow-up (clients using the new fields) is a separate task per the spec.

### Round 2 (fix round: PREREVIEW findings 1-2)
- **Finding 1 (should-fix, bad PUT payload answered 400 with an empty body instead of the house 400):** added `.middleware(SchemaErrors)` to `ChatsGroup` (`packages/api-contract/src/chats.ts`), matching every sibling write group (e.g. chat-prefs). Before, the module-provided `schemaErrorLayer(logger)` was dead code (`http-core.ts:89-91`: the transform only runs for endpoints whose middleware list declares the tag), so a payload failing the contract decode (`{}` / `{"messageId": 123}`) surfaced with an empty 400 body instead of `{ error: { code: 'invalid_request', ... } }`. Verified on the wire: now `Missing key at ["messageId"]` / `Expected string at ["messageId"]`. Test: new `answers 400 for a payload that fails the contract schema` in `reads.test.ts` (status + `invalid_request` code, nothing written).
- **Finding 2 (should-fix, out-of-range numeric mark blew up the SQL cast):** `reads.ts` now range-checks the parsed mark against int8 (`0..9223372036854775807`), refusing `99999999999999999999999` and `-1` with 400 `invalid_request` before the upsert instead of throwing in Postgres (`22003`). Test: new `answers 400 for a mark outside the int8 range and writes nothing` in `reads.test.ts`.
- **Finding 3 (nit, preview `id` is `origin_id`, not a usable read mark):** left as is per instructions (nits only if on a touched line). Noted for the lead: clients must echo archive timestamps, not `lastMessage.id`, into `PUT .../read`; a doc line could live in the client follow-up.
- **Checks:** `pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot --maxWorkers=2`: 6 passed (single run at the end, plus one mid-round run at 5).
- **Gate:** `pnpm gate`: `GATE PASS` — PASS install/format/lint/typecheck/effect, PASS tests @zilar/server, SKIP tests @zilar/api-contract (no nearby test files), scope clean, migration continues from base.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round. The pre-review is clean, with 1 nit.**
- **Migration `0048_chat_reads.sql`:** a new table only (PK `user_id, chat_jid`, FK to `user` with cascade, a jid length check). No existing data is touched.
- **`PUT /api/chats/:jid/read`** (`chats/reads.ts`):
  - access through `requireChatAccess` (the same rule as the list; 404 for unknown or invisible chats);
  - a numeric archive id only;
  - forward-only in SQL;
  - rate-limited.
- **`chats/unread.ts`:**
  - per-chat `LATERAL` capped counts (at most 100), and a 30-day window without a mark;
  - own messages are skipped (the push and search sender rules, cited);
  - the newest row is the preview;
  - at most 2 archive queries, and `{}` without the archive pool.
- **`/api/chats`:** optional `unread` and `lastMessage` on DMs, groups and every topic. Old clients ignore them. `app.ts` is unchanged in size, and `chats/api.ts` is 314 lines.
- **Tests:** `reads.test.ts` 6 of 6, run by the lead.
- **The nit, for the client half:** `lastMessage.id` is the `origin_id`. Clients must send the **archive id (timestamp)** to `PUT …/read`, not `lastMessage.id`.
- **Still to do after deploy:** `/health` ok, and `/api/chats` carries the fields.

**Lead, 2026-10-12 ~04:30: REVERTED.**
- **What happened:** after the deploy, `GET /api/chats` answered **500** for every user (requestId `7cc3a069-16d6-4341-b5b5-663026cf3eb9`); other routes answered 200.
- **The revert:** the code was reverted in `6904f5900`. The migration `0048` and `rows.ts` stay, because the table is live. `/api/chats` answers 200 again.
- **The likely cause:** a JavaScript `BigInt` array bound to postgres.js (`::bigint[]`), which the test fake stringified.
- **Lead's miss:** the review accepted a fake archive pool that hides driver behaviour.
- **The redo is T-1205.**
