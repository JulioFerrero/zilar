---
id: T-1158
title: "SG-1 (P0): blocking really blocks — block deletes the contact pair and both roster items, and contacts/chat list/archive scope (push + search) exclude a blocked peer in either direction"
status: merged
milestone: M5
branch: task/T-1158-block-really-blocks
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1158: Block really blocks

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md` SG-1 (P0), verified by the lead. Fix-plan task 1.
- **Today a block is only a row:** `blockUser` inserts `user_blocks` and cancels pending requests (`apps/server/src/blocks/service.ts:117-134`). It never touches `contacts` or the rosters.
- **So the blocked person:**
  - stays in `listContacts` (`apps/server/src/contacts/service.ts:69-85`, no block filter) and in `/api/chats`;
  - keeps the `both` roster subscription, so they still see you online;
  - their DMs are delivered and **pushed**, because the archive scope is every contact (`apps/server/src/search/service.ts:88-95`).
- **The helpers exist:** `adminClient.deleteRosterItem` (`apps/server/src/xmpp/admin/client.ts:331`) and `syncRoster` (`contacts/service.ts:135`).
- **Julio decided on 2026-10-11:** DMs are contacts only. Dropping strangers' stanzas at ejabberd is a later task (T-1159). This task is the server side.

### What to build
1. **In `blockUser`**, inside the same transaction as the insert, delete both `contacts` rows for the pair. After the commit, remove both roster items with `deleteRosterItem` in both directions. That's best effort: log a `warn` on failure, never fail the block. Put the roster helper in a new `apps/server/src/blocks/roster.ts`, so `service.ts` stays at most 400 lines.
2. **`unblockUser`** leaves the pair gone. Re-adding goes through a contact request, as the audit says.
3. **Belt and braces**, until old rows are gone: add an either-direction block predicate (`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user_id = me AND b.blocked_user_id = them) OR (b.user_id = them AND b.blocked_user_id = me))`) to:
   - `listContacts` (`contacts/service.ts:78-85`);
   - the contacts archive scope in `search/service.ts:88-95`, which push and search use (`allowedArchives`).
4. **No client change:** the chat list refreshes from `/api/chats`, and the roster push from removing an item already triggers a chat-list refresh (`packages/client-core/src/store/lifecycle.ts`, `current.on('roster', …)`).
5. **Tests** (permissions), in a new `apps/server/src/blocks/blocks.test.ts`, following the setup of a nearby server test such as `apps/server/src/contact-requests/contact-requests.test.ts`, at most 2:
   - after a block, neither side lists the other in `listContacts`, and both `deleteRosterItem` calls fire (with a fake admin client);
   - `allowedArchives` for the blocker no longer includes the blocked peer.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (SG-1), `apps/server/src/blocks/service.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/contacts/service.ts`, `apps/server/src/search/service.ts:80-120`, `apps/server/src/xmpp/admin/client.ts:320-356` and `apps/server/src/contact-requests/contact-requests.test.ts:1-60`.

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/blocks/roster.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/server/src/contacts/service.ts`, `apps/server/src/search/service.ts`, `apps/server/src/app.ts` (added by the lead in the fix round, one line only), `work/T-1158-block-really-blocks.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/blocks/blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on the live web with two accounts:** A blocks B. B disappears from A's list, A from B's list, and B no longer sees A online.

---

## Report (written by the worker when done)

### What I did (per Spec steps)
1. **`blockUser` deletes the pair + removes both roster items.** The `DELETE FROM contacts` for both directions of the pair runs inside the same transaction as the `user_blocks` insert and the request cancels (`apps/server/src/blocks/service.ts`). After the commit, `removeBlockRosterItems` (new `apps/server/src/blocks/roster.ts`, 62 lines, so `service.ts` stays at 235 lines) calls `deleteRosterItem` in both directions; every failure is a `warn` with ids only, never a throw, so the block always succeeds.
2. **`unblockUser` unchanged in behavior** (it only deletes the block row, never recreates contacts); added a comment stating the pair stays gone and re-adding goes through a contact request.
3. **Either-direction block predicate** (`NOT EXISTS ... user_blocks ...` in both directions) added to `listContacts` (`apps/server/src/contacts/service.ts`) and to the contacts scope of `allowedArchives` (`apps/server/src/search/service.ts`), which push and search share. Since `/api/chats` builds from `listContacts`, the chat list is covered with no client change.
4. **No client change.** None made.
5. **Tests** (`apps/server/src/blocks/blocks.test.ts`, 2 tests, following `contact-requests.test.ts` setup): (a) after a block neither side lists the other and both `deleteRosterItem` calls fire on the fake admin client; (b) `allowedArchives` for the blocker no longer includes the blocked peer.

### Files changed (all inside Allowed files)
- `apps/server/src/blocks/service.ts` (235 lines): pair delete in-tx, optional post-commit roster removal via new `adminClient`/`domain`/`logger` deps.
- `apps/server/src/blocks/roster.ts` (new, 62 lines): `removeBlockRosterItems` helper.
- `apps/server/src/blocks/api.ts` (117 lines): threads optional `config`/`adminClient` into the service deps and the request logger for the roster warn.
- `apps/server/src/contacts/service.ts` (302 lines): block filter in `listContacts`.
- `apps/server/src/search/service.ts` (156 lines): block filter in `allowedArchives` contacts scope.
- `apps/server/src/blocks/blocks.test.ts` (new, 54 lines): the 2 spec tests.

### Commands and real results
- `pnpm install`: exit 0, "Done in 16.2s" (one pre-existing peer-dep warning in `apps/mobile`, unrelated).
- `pnpm --filter @zilar/server exec vitest run src/blocks/blocks.test.ts --reporter=dot --maxWorkers=2`: 2 passed.
- `pnpm --filter @zilar/server exec vitest run src/contact-requests/contact-requests.test.ts --reporter=dot --maxWorkers=2`: 8 passed (only other test file touching `user_blocks`).
- `pnpm gate`: `gate: 7 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. (First gate run failed on format for the new `roster.ts`; fixed with `pnpm exec prettier --write` on that file only, re-ran the block tests, then gate passed.)

### Problems / deviations
- None in the spec steps. One deliberate interface choice: `BlocksDeps.adminClient`/`domain`/`logger` are optional so existing callers and tests keep compiling; the API layer passes them only when `config`+`adminClient` are provided.

### Blocked / needs a decision
- **Production roster removal is not yet live.** The spec's step 1 says "After the commit, remove both roster items", and the only caller, `createBlocksApi({ auth, db, audit, logger })` in `apps/server/src/app.ts:305`, does not pass `config`/`adminClient` — and `app.ts` is outside my Allowed files, so I could not add the one-line wiring (`config, adminClient`). The DB pair delete and both read filters work without it; only the live roster/presence removal needs that line. Please either add `apps/server/src/app.ts` to a follow-up (one line: pass `config` and `adminClient` into `createBlocksApi`) or confirm and I will do it. Until then, on a live server a block deletes the pair and hides both sides from lists/search/push, but the `both` roster subscription lingers until the follow-up.

### Security checklist
- Roster-failure warn logs `err` + `userId` + `targetId` (ids only, matching the audit convention); no message text, tokens, or URLs.
- Both deletes are pair-scoped (`(user_id, contact_user_id)` in both directions); `unblockUser` still deletes only its own row.
- Pair delete is inside the same transaction as the insert/cancel; the re-block path also deletes (a contact accepted between blocks does not survive).
- No effect precedes the permission checks (404 unknown / 400 self still fire first; locks are not effects). No new routes; the block write keeps its existing 30/10-min rate limit.

### Round 2 (fix round, PREREVIEW.md findings)
- Finding 1 (follow-up, needs `apps/server/src/app.ts:305` which is outside Allowed files): not fixed here. `createBlocksApi` still receives no `config`/`adminClient` in production, so live blocks delete the pair and filter lists/search/push but do not remove the `both` roster items; the lead's two-account presence check still needs that one-line wiring follow-up. Left untouched per scope rules.
- Finding 2 (should-fix): fixed. `apps/server/src/blocks/blocks.test.ts` now asserts the exact two `(localpart, contactJid)` pairs on `removedRosterItems` (`{ localpartFor(a), expectedJid(b) }` and `{ localpartFor(b), expectedJid(a) }`) instead of only `toHaveLength(2)`, so a same-direction-twice copy-paste bug would fail. Commit `c934c07ae` ("T-1158: fix finding 2 - assert exact roster removal pairs").
- Finding 3 (nit in `roster.ts:47-50`, lines untouched): not touched, as instructed.
- Tests added/adjusted: strengthened the 1 existing assertion; no new test files.
- Gate: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS` (7 changed files against main).

### Round 3 (fix round, PREREVIEW.md findings)
- Finding 1 (follow-up, needs `apps/server/src/app.ts:305` which is outside Allowed files): still not fixed here. `createBlocksApi` still receives no `config`/`adminClient` in production, so live blocks delete the pair and filter lists/search/push but do not remove the `both` roster items; the lead's two-account presence check still needs that one-line wiring follow-up. Left untouched per scope rules.
- Finding 2 (should-fix, `roster.ts:47-50` unguarded JID lookups): fixed. `removeBlockRosterItems` now wraps the two `rosterJidFor` lookups in try/catch: on failure it warns (ids only) and falls back to the derived JIDs, so both `deleteRosterItem` calls are still attempted and the block never fails. Commit `45716a692` ("T-1158: fix finding 2 - roster JID lookups never fail the block"). Finding 3's nit angle (concurrent re-provision resolving a stale JID) is moot on this path: the fallback uses the derived JID only when the DB read itself failed.
- Finding 3 (nit): not touched except where the fixed lines overlap.
- Tests added/adjusted: new test "still removes both roster items when the JID lookups fail" (unregistered `ServerDatabase` handle so `runSql` throws, asserting both removal pairs still fire on derived JIDs plus one warn); the exact-pair assertion from round 2 stands.
- Gate: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS` (7 changed files against main; `pnpm --filter @zilar/server exec vitest run src/blocks/blocks.test.ts --reporter=dot --maxWorkers=2`: 3 passed).

### Fix round 1 (lead: wire the roster removal in production)
- `apps/server/src/app.ts:305` now passes `config` and `adminClient` into `createBlocksApi`, so `removeBlockRosterItems` runs live and a block removes both `both` roster items (prettier expanded the call to multi-line).
- Gate: `gate: 8 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Fix round 2 (lead: test the block filters with a legacy contact row)
- `apps/server/src/blocks/blocks.test.ts`: the old "drops the blocked peer from the blocker archive scope" test is replaced by "still filters a legacy contact row written after the block": block, then re-insert both `contacts` rows directly with SQL, then assert `listContacts` (both sides) and `allowedArchives` still exclude the peer.
- Verified the test tests the filters: with the `NOT EXISTS (user_blocks …)` predicate temporarily removed from `contacts/service.ts`, the new test fails on the `listContacts(a)` assertion (1 failed, 2 passed); with the predicate removed from `search/service.ts`, it fails on the `dmPeers` assertion (1 failed, 2 passed). Both predicates restored after.
- `pnpm --filter @zilar/server exec vitest run src/blocks/blocks.test.ts --reporter=dot --maxWorkers=2`: 3 passed.
- Gate: `gate: 8 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Disagreements
- None. Finding 1 is correctly scoped as a follow-up (fix file outside Allowed files); findings 2-3 agree with the code as read.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 2 auto rounds and 2 lead fix rounds; 2 nits and 1 follow-up.**
- **The block:** `blockUser` deletes both contact rows in the transaction, then removes both roster items (best effort, `blocks/roster.ts`).
- **The wiring:** `app.ts` now passes `config` and `adminClient`, so this runs live. That was lead fix round 1.
- **Filters:** either-direction block predicates in `listContacts` and the archive scope (push and search). Lead fix round 2: the tests now insert a legacy contact row, so they really exercise the filters.
- **Tests:** 3 of 3 in the branch, run by the lead.
- **Follow-up:** the accept race in `contact-requests/service.ts`.
- **Still to do:** the live check with two accounts.
