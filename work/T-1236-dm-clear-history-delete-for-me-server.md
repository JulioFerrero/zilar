---
id: T-1236
title: "TG-7 DMs, server: DELETE /api/chats/:jid/history clears the caller's own copy of a DM (their archive rows with that peer), and DELETE /api/chats/:jid/messages/:archiveId deletes one message from the caller's own copy — the other person's history is untouched"
status: merged
milestone: M5
branch: task/T-1236-dm-clear-history-delete-for-me-server
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1236: Clear history and delete for me (server)

## Spec (written by Claude, do not edit)

### Why
It's item 7 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): there's no "delete for me", "clear history" or "delete chat". A DM is archived **per user** in ejabberd's `archive` table: the caller's copy is the rows with `username = <caller localpart>` and `bare_peer = <peer bare JID>`, the same scope the unread query reads (`apps/server/src/chats/unread.ts:138-147`, `ownLocalpart`). Deleting those rows changes only the caller's history. The chats API already holds the archive pool (`apps/server/src/chats/api.ts:88`, `archive: ArchivePool | undefined`).

This task is the server half; the web and mobile menus come next.

### What to build
1. **Contract** (`packages/api-contract/src/chats.ts`, next to `markRead` at `:111`): two DELETE endpoints, `clearHistory` on the history path and `deleteForMe` on the single-message path given in the title, both answering 204.
2. **Server:** a new `apps/server/src/chats/delete-own.ts` with the handlers, wired in `apps/server/src/chats/api.ts` (keep it at most 400 lines).
   - **DMs only.** Use `requireChatAccess` (as `apps/server/src/chats/reads.ts:18-23`), so an unknown or invisible chat answers 404. A group or room answers 400 `invalid_request` ("Only direct chats").
   - **`clearHistory`:** `DELETE FROM archive WHERE username = <caller localpart> AND bare_peer = <peer bare JID>`. Also drop the caller's `chat_reads` row for that chat; after T-1229 merges, drop the caller's `chat_deliveries` row too, or note it if T-1229 isn't on main yet.
   - **`deleteForMe`:** the archive id must be digits only; anything else answers 400. Delete exactly one row, with `username = caller`, `bare_peer = peer` and `timestamp = <archiveId>`. If nothing matched, answer 404.
   - **Bind the timestamp as a string, never as `BigInt`** (the T-1198 incident; see `work/T-1205-server-unread-again.md`).
   - **A missing archive pool** answers 503 with the existing "unavailable" error shape (cite it).
   - **Write-rate-limit** both routes the way the chat prefs writes are (cite it), and write one audit entry each, with ids only (chat JID and the count deleted), never text.
3. **Tests** (permissions), in a new `apps/server/src/chats/delete-own.test.ts` following `apps/server/src/chats/reads.test.ts`, up to 3:
   - clearing A's copy of the A–B DM removes A's rows and **keeps B's**;
   - `deleteForMe` with another user's or another chat's archive id answers 404 and deletes nothing;
   - a group answers 400.

### Read first
`AGENTS.md`, `apps/server/src/chats/reads.ts`, `apps/server/src/chats/reads.test.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/chats/unread.ts:100-160,230-260`, `work/T-1205-server-unread-again.md` and `packages/api-contract/src/chats.ts`.

### Allowed files
`deploy/postgres/init/20-search-reader.sql`, `infra/postgres/init/20-search-reader.sql`, `deploy/baremetal/setup-postgres.sql`, `docs/SERVER_CONFIG.md`, `docs/INSTALL_BARE_METAL.md` (fix round 2, lead), `packages/api-contract/src/chats.ts`, `apps/server/src/chats/delete-own.ts`, `apps/server/src/chats/delete-own.test.ts`, `apps/server/src/chats/api.ts`, `work/T-1236-dm-clear-history-delete-for-me-server.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/delete-own.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check after deploy:** a fetch of the history route for an unknown chat answers 404 (read-only; nothing is deleted).

---

## Report (written by the worker when done)

Done. Two DM-only DELETE routes, contract + server + 3 permission tests. `pnpm gate` is green and every changed file is inside the Allowed files.

### What I built
- **Contract** (`packages/api-contract/src/chats.ts`, next to `markRead`): `DELETE /chats/:jid/history` (`clearHistory`) and `DELETE /chats/:jid/messages/:archiveId` (`deleteForMe`), both `HttpApiSchema.NoContent`.
- **New `apps/server/src/chats/delete-own.ts`** (135 lines):
  - `requireDmAccess` calls `requireChatAccess` (the same rule the read mark uses, `chat-prefs/access.ts`), so an unknown/invisible chat answers the same 404; if the visible JID's host is the MUC domain it throws 400 `invalid_request` "Only direct chats".
  - `clearOwnHistory` runs `DELETE FROM archive WHERE username = $1 AND bare_peer = $2 RETURNING timestamp` on the archive pool (username = `localpartFor(userId)`, the caller's `ownLocalpart`, `unread.ts:144-145`), then drops the caller's `chat_reads` row through `deps.db`, then records one audit entry. Returns the deleted count.
  - `deleteOwnArchiveRow` rejects a non-digit id with 400 (also bounds it to int8, mirroring `reads.ts:29`, so a huge id is 400 not 500), then `DELETE ... WHERE username = $1 AND bare_peer = $2 AND timestamp = $3 RETURNING timestamp`; binds the id **as a string, never a `BigInt`** (T-1198/T-1205). Nothing matched → `false` → the route answers 404. Deletes exactly one row.
  - A missing archive pool throws `xmppUnavailable()` (503 `xmpp_unavailable`, `errors.ts:25-27`), the existing shape the push preview route uses (`push/api-handlers.ts:161`).
  - Each successful delete writes one audit entry with ids only: `action` `chat.history_cleared` / `chat.message_deleted`, `detail: { chatJid, deleted }`, `subjectId: null` (a JID can exceed the audit `subjectId` 128-char bound, `audit/schema.ts:19-22`), never any text.
- **`apps/server/src/chats/api.ts`** (394 lines, still under 400): builds `createAuditRecorder({ db, logger })` locally so `app.ts` (not an Allowed file) does not change — same default app.ts uses at `:253`; adds one write limiter shared by both routes (60 / 60 s), the way the chat-prefs writes do (`chat-prefs/api.ts:35-36,76-80`), charged **after** the access check so a probe of an invisible chat costs nothing. Wires the two handlers. I also extracted the existing inline JID decode into `decodeChatJid` and reused it in `markRead` (behaviour identical; a malformed escape is still 404).
- **New `apps/server/src/chats/delete-own.test.ts`** (3 tests, following `reads.test.ts`): (1) clearing Alice's copy of the Alice–Bob DM removes her rows and her `chat_reads` row, keeps Bob's, and writes one audit entry with `deleted: 2`; (2) `deleteForMe` deletes one row, then Bob's row id (another user's copy) and a row under another chat both answer 404 and delete nothing; (3) a group answers 400 on both routes.

### Notes / deviations
- **`chat_deliveries` now dropped (rebased onto T-1229).** T-1229 is on `main` after the rebase, so `clearOwnHistory` deletes the caller's delivery row in the same `runSql` block as the read mark. The predicate is `user_id = <caller> AND chat_jid = <bare>` — the caller's own row (keyed by the author's JID); the peer's row (keyed by the caller's JID) is untouched. The clear test seeds both and asserts only the caller's is gone. (Before the rebase this was only noted; T-1229 wasn't on `main`.)
- No spec deviations otherwise. I did not touch `app.ts` and added no dependency.

### Checks (real results)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/delete-own.test.ts`: **3 passed** (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts`: **8 passed** (guards the `decodeChatJid` refactor in `markRead`).
- `pnpm install`: Done (no new deps).
- `pnpm gate` (run from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (11.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First gate run failed on prettier for `delete-own.test.ts`; fixed with prettier, second run is the one above.)

### Security checklist
- Deletes are scoped by **username (caller localpart) + bare_peer**, and for `deleteForMe` also `timestamp`; the peer's rows (a different `username`) are untouched and the tests assert it.
- Unknown and invisible chats share one 404 (`requireChatAccess`); a group/room is a visible chat and answers 400.
- Both routes are session-guarded and picked up automatically by the 401 sweep (`authz-sweep.test.ts` enumerates `app.routes`); both are write-rate-limited.
- Audit entries carry ids only (`chatJid`, `deleted`), never message text.
- No secrets, no request-body logging added.

### Open question for the lead
- The archive pool is opened from `XMPP_ARCHIVE_DATABASE_URL` for reads (`search/service.ts:37-48`). This task issues **DM** deletes through it, so that database user now needs `DELETE` on `archive`. If the ejabberd DB role is read-only, the deletes will fail at runtime (tests use a fake and cannot catch it). Worth a one-line check at deploy.

### Rebase onto T-1229
The lead's `git rebase main` stopped on conflicts in `apps/server/src/chats/api.ts` and `packages/api-contract/src/chats.ts`. I resolved both keeping both sides (T-1229's `markDelivered` / `deliveredUntil` and my two DELETE routes), then `git add`ed them. No `rebase --continue` run.

To hold the 400-line bar with both sides, the two delete-for-me handler bodies moved into `apps/server/src/chats/delete-own.ts` as `deleteOwnHandlers(deps)` (it builds its own write limiter and audit recorder and reads the same fields `ChatsApiDependencies` carries, so `api.ts` passes its deps straight through). `api.ts` now wires them in two lines (`.handle('clearHistory', deleteOwn.clearHistory)` / `.handle('deleteForMe', deleteOwn.deleteForMe)`) and is **394 lines** (was 419 with both bodies inline, 387 before my task). `delete-own.ts` is 239 lines. `markRead` keeps T-1229's `chatAccessForMark` (so my earlier `decodeChatJid` refactor there was dropped).

`clearHistory` also deletes the caller's `chat_deliveries` row in the same `runSql` block as the read mark: `DELETE FROM chat_deliveries WHERE user_id = <caller> AND chat_jid = <bare>`. That is the caller's own row (keyed by the author/peer's JID, its mark an id in the author's archive); the peer's row (keyed by the caller's JID) is left alone. The clear test seeds both rows and asserts only the caller's is gone.

Checks (real results, run after the resolution; files not committed by me — the lead runs `rebase --continue`):
- `pnpm --filter @zilar/server exec vitest run src/chats/delete-own.test.ts src/chats/deliveries.test.ts --reporter=dot` — **2 files, 7 passed** (3 delete-own + 4 deliveries); `Duration 15.54s`.
- `pnpm --filter @zilar/server exec tsc --noEmit -p tsconfig.json` — **exit 0, no output**.
- Prettier `--check` on the four touched files — all formatted (no changes).

### Fix round 2
Granted `zilar_archive` DELETE on `archive` for the clear-history / delete-for-me writes (Julio approved; the lead runs the production GRANT separately). Updated every setup file and the docs, and re-ran the gate.

- `deploy/postgres/init/20-search-reader.sql`: header now says the role can SELECT and DELETE on `archive` only; added `GRANT DELETE ON public.archive TO zilar_archive;` next to the SELECT grant.
- `infra/postgres/init/20-search-reader.sql`: same header change and DELETE grant. The comment notes DELETE is a direct grant only — the `ALTER DEFAULT PRIVILEGES … GRANT SELECT` line is left as SELECT, so the role never gains DELETE on ejabberd's other tables.
- `deploy/baremetal/setup-postgres.sql`: header and role comment updated; added the DELETE grant next to the SELECT grant.
- `docs/SERVER_CONFIG.md`: the `XMPP_ARCHIVE_DATABASE_URL` row, the "Message search" intro, the init-script step and the manual line now say SELECT **and** DELETE on `archive` only; the manual line is now `GRANT SELECT ON archive TO zilar_archive;` + `GRANT DELETE ON archive TO zilar_archive;`.
- `docs/INSTALL_BARE_METAL.md`: the `zilar_archive` description now says it can SELECT and DELETE on `archive` only.
- Left `docs/audit/security-audit.md` untouched (dated audit).

`pnpm gate` (from the repo root):
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (0.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/server  (14.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

Note for the lead: on a **fresh** data volume `archive` is created by ejabberd after these init scripts run, so the direct DELETE grant is skipped there. SELECT is covered on a fresh volume by the `ALTER DEFAULT PRIVILEGES` line in `infra/postgres/init/20-search-reader.sql` (and by the manual GRANT from `SERVER_CONFIG` for the deploy/baremetal files, which grant nothing by default). To keep "a new install matches" without granting DELETE on every future table, DELETE needs either the same manual GRANT after ejabberd's first start or a targeted follow-up; I did not widen the default privileges because that would give the role DELETE on ejabberd's other tables.

### Round (fix round 3, findings from PREREVIEW)

Findings fixed: **1** (should-fix) — fresh data volumes never get the `DELETE` grant. Finding 2 is a nit with "no change required", so it was left as is.

- `docs/SERVER_CONFIG.md` step 3: now says the manual grants apply on an existing volume **and on a fresh install after ejabberd's first start**, names both `GRANT`s, and gives the reason (`archive` is created by ejabberd after the init scripts run) and the consequence (clear history / delete for me fail with permission denied).
- `docs/INSTALL_BARE_METAL.md` §2: added the missing manual-grant pointer — the command (`psql -d ejabberd -c 'GRANT SELECT … ; GRANT DELETE …'`) to run once after ejabberd's first start, pointing at `SERVER_CONFIG.md` "Message search".
- `infra/postgres/init/20-search-reader.sql` and `deploy/baremetal/setup-postgres.sql`: matching one-line comment pointing operators at the fresh-volume manual grant (comment only, no behaviour change; keeps the four setup files consistent).
- Tests added: none — the fix is documentation/comments; no code behaviour changed.

Checks:
- `pnpm --filter @zilar/server exec vitest run src/chats/delete-own.test.ts --reporter=dot`: **3 passed** (1 file).
- `pnpm gate` (from the repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.9s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (16.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after the lead's rebase round and fix round 2 (1 nit).**
- **The change:** clear history and delete for me, both on the caller's own archive copy only (`username = caller AND bare_peer = peer`).
  - Clear history also drops the caller's `chat_reads` and `chat_deliveries` rows.
  - The archive id is bound as a string, with `BigInt` used only for the range check.
  - A group answers 400 and an unknown chat 404; the routes are write-rate-limited and audited with ids only.
  - The handlers live in `delete-own.ts`, so `api.ts` is 394 lines.
- **The archive role:** `zilar_archive` was SELECT-only by design. Julio approved DELETE ("Allow DELETE") and ran `GRANT DELETE ON public.archive TO zilar_archive;` on production at about 16:40 (answer: `GRANT`). The setup SQL files in `deploy/` and `infra/`, the baremetal setup and the docs now grant it too.
- **After rebasing onto main:** the delete-own, deliveries and reads tests pass (15), and server tsc gives 0 errors.
- **After deploy:** read-only check that the clear-history route answers 404 for an unknown chat. The web and mobile menus are the next task.
