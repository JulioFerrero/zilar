---
id: T-1205
title: "T-1198 again, after a production 500: re-apply the server unread/lastMessage work, pass every archive parameter as text (no BigInt), make an unread failure log and omit the fields instead of failing /api/chats, and make the test fake behave like postgres.js"
status: merged
milestone: M5
branch: task/T-1205-server-unread-again
model: auto
effort: default
depends_on: [T-1198]
estimate: 0.3 day
---

# T-1205: Server unread, without breaking the chat list

## Spec (written by Claude, do not edit)

### What happened
T-1198 (commit `2ac802f67`) merged and deployed at about 04:15 local. In production, **`GET /api/chats` answered 500** for every user (`{"error":{"code":"internal_error",…,"requestId":"7cc3a069-16d6-4341-b5b5-663026cf3eb9"}}`), while `/api/me`, `/api/contacts` and `/api/chat-prefs` answered 200. The lead reverted the code in commit `6904f5900`. It kept `apps/server/drizzle/0048_chat_reads.sql` and the `ChatReadRow` in `apps/server/src/db/rows.ts`, because the table is already live and journaled. `/api/chats` answers 200 again.

### The likely cause (verify it)
- **Production reads the archive through postgres.js:** `createArchivePool` (`apps/server/src/search/service.ts:37-49`) calls `sql.unsafe(text, values)`. Search and push already pass `text[]` arrays this way, and they work in production.
- **T-1198 added a `bigint[]` parameter built from JavaScript `BigInt` values:** `unnest(${markList}::bigint[])` in `unread.ts` (the page query, about `:136-150` of `2ac802f67`), with marks computed as `BigInt(...)` (the `floor` near `:235`).
- **The test fake hides this:** `pgliteArchivePool` in `reads.test.ts` (about `:36-50` of `2ac802f67`) turns every `bigint` and every array element into a string before PGlite sees it, so the tests can't fail on a parameter type that postgres.js rejects.

Confirm the cause with postgres.js itself. For example, a small vitest that builds the query values and passes them through postgres.js's own serialization (find the API in `node_modules/postgres`) without a server. Or, if postgres.js only fails when it talks to a server, cite its source line that rejects or mishandles a `BigInt`. Write what you found in the Report. If the cause is something else, find it, and say so.

### What to build
1. **Re-apply T-1198:** start with `git cherry-pick 2ac802f67`. The migration, `rows.ts` and the task file are already on main and identical, so those parts are no-ops. Resolve any conflict by keeping main's migration file unchanged.
2. **Every value passed to the archive pool is a string, a number or an array of strings.** Pass the marks as decimal strings, so the `::bigint[]` cast still compares as numbers. No `BigInt` reaches postgres.js.
3. **An unread or preview failure never fails the list.** In `chats/api.ts`, wrap the `unreadForChats` call: on any error, log one warning (no user data, just the error class and message), and answer the list **without** `unread` and `lastMessage`.
4. **The test fake behaves like postgres.js:** the fake archive pool in `reads.test.ts` **rejects** a `bigint` value or a `bigint` inside an array (throw, as the real driver would), instead of stringifying it. Keep its text-array binding.
5. **Tests** (the message pipeline):
   - the 6 from T-1198 still pass against the stricter fake;
   - plus 1: when the archive pool's `query` throws, `GET /api/chats` answers 200 with the chats and no `unread` fields.

### Read first
`AGENTS.md`, `work/T-1198-server-unread.md` (the spec, Report and Review), `git show 2ac802f67`, `apps/server/src/search/service.ts:30-60`, `apps/server/src/search/archive-query.ts` (how search binds arrays) and `apps/server/src/push/archive-scan.ts:140-200`.

### Allowed files
`apps/server/src/app.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/chats/reads.ts`, `apps/server/src/chats/unread.ts`, `apps/server/src/chats/reads.test.ts`, `packages/api-contract/src/chats.ts`, `work/T-1205-server-unread-again.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines, and `app.ts` doesn't grow.
- **The lead's check after deploy:** `GET /api/chats` answers 200 and carries `unread` on the DM rows; `/health` is ok.

---

## Report (written by the worker when done)

Done. Re-applied T-1198 on top of the revert, fixed the archive parameter types, made unread failures non-fatal, and hardened the test fake.

### Cause verification (spec item: confirm with postgres.js itself)
Confirmed the lead's hypothesis, with postgres.js 3.4.9 source and a no-server reproduction plus a PGlite array-literal check:
- `sql.unsafe(text, values)` routes plain (non-tagged) values through `handleValue` (`connection.js` `build`), which calls `inferType(x)` (`types.js`). `inferType` returns `20` (int8) when `typeof x === 'bigint'`, and for an array it recurses into the first element — so a JS `bigint[]` gets parameter type **20**.
- Type 20 has **no serializer** (only `string/number/json/boolean/date/bytea` register serializers in `typeHandlers`), so `Bind` (`connection.js`) falls back to `'' + x`. For `[10n, 20n]` that is the text `10,20` (verified: simulated `handleValue` gives types `[20,0]`-style inference and wire `"10,20"`).
- I passed the exact wire strings to PGlite (same Postgres array-input parser): `SELECT unnest($1::bigint[])` with `'10,20'` throws `malformed array literal: "10,20"`. The fake-built literal `'{"10","20"}'` returns both rows. So in production the marks array arrived as `10,20`, Postgres rejected it, and `GET /api/chats` answered 500. Verified with `/tmp/bigser*.mjs` scripts (postgres.js `inferType`/`handleValue` + PGlite `unnest`), no server needed.
- Side note found while verifying: the existing search/push `ANY($n)` text-array bindings have the same latent shape (a JS `string[]` would bind as `a,b`), but their fakes build `{...}` literals so tests pass and production evidently tolerates them today (search/push work in prod). Out of scope; left untouched, noted here only.

### What I built
- **Cherry-pick:** `git cherry-pick --no-commit 2ac802f67`, then restored `work/T-1198-server-unread.md` and `work/BOARD.md` to HEAD (task files are lead-owned; the migration and `rows.ts` were already on main, so those parts were no-ops as the spec said). Net code diff vs main = the T-1198 code plus the T-1205 fixes.
- **`apps/server/src/chats/unread.ts`** (327 lines): `ChatThreshold.after` is now a **decimal string**; the floor and stored marks are stringified (`parsed.toString()` after `BigInt` validation) and bound as a `string[]`, so the `::bigint[]` cast still compares numerically and **no `BigInt` reaches postgres.js**. The `LIMIT` cap value is also bound as a string.
- **`apps/server/src/chats/api.ts`** (322 lines): the `unreadForChats` call is wrapped in `.catch`: on any error it logs one warning with only `{ errorClass, message }` (no user data) and answers the list **without** `unread`/`lastMessage`.
- **`apps/server/src/chats/reads.test.ts`** (361 lines): the fake archive pool now **throws on a `bigint` value or a `bigint` inside an array** ("like postgres.js") instead of stringifying; text-array literal binding kept.
- **New test:** archive `query` throws → `GET /api/chats` answers 200, the chats are present, and no entry carries `unread` or `lastMessage`.
- `packages/api-contract/src/chats.ts` unchanged vs the cherry-pick; `app.ts` still 583 lines (one-line change at `:358`).

### Checks (real results)
- `pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --maxWorkers=2 --reporter=dot`: **7 passed** (the 6 from T-1198 against the stricter fake + the new 200-without-unread test).
- `pnpm gate`: `GATE PASS` — PASS install/format/lint/typecheck/effect, PASS tests @zilar/server, SKIP tests @zilar/api-contract (no nearby test files), `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`. (First gate run failed on prettier formatting of `api.ts`; fixed the object-wrap, prettier check clean, second gate run passed.)
- Line counts: `app.ts` 583 (unchanged in size), `api.ts` 322, `reads.ts` 84, `unread.ts` 327, `reads.test.ts` 361, contract `chats.ts` 116 — all within the 400-line acceptance bar.

### Security checklist
- Warning log carries only error class + message, no user ids, jids, marks or message text.
- No new routes; `PUT .../read` scoping/rate-limit unchanged from T-1198; unknown/invisible chats still share one 404.
- Forward-only mark rule unchanged (SQL-atomic `WHERE`); no new audit entries.

### Deviations / open questions
- None from the spec. The search/push `ANY($n)` text-array binding observation above is for the lead to triage separately; I changed nothing there (outside Allowed files).

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 3 nits.**
- **The cause, confirmed:** postgres.js has no serializer for a JavaScript `BigInt` array, so it sent `10,20`. The worker showed this from the source and with PGlite.
- **The lead's probe** ran the same `sql.unsafe` shape against the local dev Postgres through postgres.js: string marks give correct counts; a `BigInt` array fails ("cannot cast type bigint to bigint[]"), which matches the production 500.
- **The fix:**
  - marks are decimal strings, so the `::bigint[]` cast still compares numerically;
  - `unreadForChats` failing leaves `/api/chats` answering 200 without the fields, with one warning that carries no user data;
  - the fake archive pool rejects `BigInt` the way the real driver does.
- **The re-applied T-1198 code** is otherwise unchanged. `app.ts` didn't grow.
- **Tests:** `reads.test.ts` 7 of 7, run by the lead.
- **Live check after deploy:** below in NOW.md.
