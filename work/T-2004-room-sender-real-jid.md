---
id: T-2004
title: "Message pipeline: the server names a room message's sender from the archived real JID (display name from the database), never from the free-text nick — pushes, unread previews, search snippets, own-message checks — and a blocked person's group messages never reach your pushes — with tests"
status: merged
milestone: M5
branch: task/T-2004-room-sender-real-jid
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2004: Room senders from the real JID

## Spec (written by Claude, do not edit)

### Why
The lead's private security review of 2026-10-18 (T-1987) found that the server trusts a room message's **nick**, which is free text the sender picks, for several decisions:
- who sent it, in push notifications ("Julio in Acme: …"), chat-list previews and search hits;
- whether it is my own message, which is skipped in unread counts and pushes.

A member can join with someone else's name, or with their user id as nick. Group pushes also ignore blocks, so a person you blocked still reaches your lock screen through a shared group.

ejabberd archives room messages with the sender's real JID: rooms are non-anonymous, and the archived copy carries `<x xmlns='http://jabber.org/protocol/muc#user'><item jid='…'/></x>`.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Push candidates.** `push/candidates.ts` (238 lines), `resolveRoomCandidate` (`:71-134`):
  - it skips when `row.nick !== '' && row.nick === localpartFor(userId)` (`:115-117`);
  - it sets `senderName: row.nick === '' ? 'Someone' : row.nick` (`:128`);
  - it has no `user_blocks` check.
- **Unread counts.** `chats/unread.ts` (262 lines) decides own messages by `row.nick === ownLocalpart` (`:83-85`) and the preview name by `row.nick` (`:90-92`).
- **Deliveries.** `chats/deliveries.ts` (357 lines) compares `row.nick.toLowerCase() === ownLocalpart.toLowerCase()` (`:44-45`).
- **Search snippets.** `search/snippet.ts` (95 lines) names room senders `row.nick` (`:49-51`).
- **Blocks.** The table is `user_blocks`. `blocks/service.ts` has the helpers; find the existing "pair has a block" check.
- **Markup helpers.** T-1988, running in parallel, adds linear helpers in `apps/server/src/markup/scan.ts`. Read the `item jid` with them if they are on main, otherwise with `indexOf`. Never use a backtracking regex over the whole stanza.
- **Tests.** `push/candidates.test.ts` and `chats/unread.test.ts` exist.

### Steps
1. **Read the real JID.** Add a helper `roomSenderJid(xml)` (for example in `search/snippet.ts`, or a new `xmpp/archive-sender.ts`). It returns the archived real bare JID from the `muc#user` `item jid`, or `null`.
2. **Use it for "is it mine".** Every "is it mine" check above compares that JID with the user's own JID. Use the nick only when the row has no item JID, which happens only with old rows.
3. **Use it for names.** Every room sender name above is the user's (or AI's) display name from the database, looked up by that JID. Batch the lookups per request. Fall back to the nick only when there is no JID.
4. **Blocks.** In `resolveRoomCandidate`, return `{ status: 'skip' }` when the recipient and the sender have a block in either direction.
5. **Tests:**
   - A row whose nick equals the recipient's localpart but whose item JID is someone else is **not** skipped.
   - It notifies with the real sender's display name.
   - A blocked sender's group message is skipped.
   - The unread own-message check uses the JID.
6. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/xmpp/archive-sender.ts`
- `apps/server/src/push/candidates.ts`
- `apps/server/src/push/candidates.test.ts`
- `apps/server/src/push/group-notifier.ts`
- `apps/server/src/push/group-notifier.test.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chats/unread-queries.ts`
- `apps/server/src/chats/unread.test.ts`
- `apps/server/src/chats/deliveries.ts`
- `apps/server/src/search/snippet.ts`
- `work/T-2004-room-sender-real-jid.md`

(`search/routes.ts` belongs to T-2003, running in parallel. Keep the search change inside `snippet.ts`.)

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/candidates.test.ts src/chats --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

Correction applied after the lead checked the live archive (2026-10-18): stored
room XML has no `muc#user` item; ejabberd stores the real sender in
`bare_peer`. The earlier XML reader was removed.

- `apps/server/src/xmpp/archive-sender.ts` is now names-only:
  `senderNamesByJid(db, jids)` resolves display names in one batched query
  (`xmpp_accounts` + `"user".name`, and `ais.name`). No stanza parsing.
- `push/candidates.ts`: own-message check compares `bareJid(row.barePeer)` with
  the caller's JID; a block in either direction skips the candidate
  (`isDmBlocked`); `senderName` comes from the batched name lookup by
  `barePeer`, then the nick, then `'Someone'`.
- `chats/unread.ts`: own-row check uses `bare_peer`; preview names come from
  one batched lookup per archive read; the resend dedupe key uses `bare_peer`.
- `chats/deliveries.ts`: the caller-row check uses `bare_peer`, and the query
  now selects `bare_peer AS "barePeer"`. A row with an empty `bare_peer`
  (legacy/malformed) falls back to the case-insensitive nick.
- `search/snippet.ts`: room names resolve from `bare_peer` through an optional
  JID→name map plus `peerNames`, then the nick, then `'Unknown'`.
- `push/group-notifier.ts`: the own-message skip now takes the localpart of
  `bare_peer` instead of `row.nick`, so a member who picks another nick is
  still not pushed their own group message.
- Tests: a stolen nick does not hide someone else's message and the real
  sender's DB name is used; the caller's own row is skipped from `bare_peer`
  under another nick; a forged `muc#user` item naming the recipient is ignored;
  a blocked sender is skipped; unread own/count/name and the nick fallback; the
  group notifier does not push a member their own row under another nick.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/push/group-notifier.test.ts src/chats src/search`
  → 11 test files passed, 63 tests passed (20.1s). (The lead's command plus
  AGENTS.md's required `--maxWorkers=2`; `src/push/group-notifier.test.ts` is
  the addendum's file.)
- An intermediate run failed `src/chats/deliveries.test.ts` because its group
  fixture stores `bare_peer: ''`; the empty-`barePeer` nick fallback above
  fixed it and the suite went green.
- First `pnpm gate` → `FAIL format` on `apps/server/src/chats/unread.ts` and
  `unread.test.ts`; fixed with `pnpm exec prettier --write` on those two.
- Final `pnpm gate` after the group-notifier addendum:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Search display-name wiring is still missing.** `search/routes.ts` (T-2003's
  file) calls `senderNameFor(row, ownJid, allowed.peerNames)` with no room-name
  map, so group search hits fall back to the nick (or a contact's name). The
  helper and the optional fourth parameter are ready; the wiring is one line in
  `routes.ts`: load `senderNamesByJid(deps.db, rows.map((row) => row.barePeer))`
  and pass it. Add `search/routes.ts` to the Allowed files if you want me to do
  it.
- `chats/deliveries.ts` keeps the nick comparison only when `barePeer` is
  empty. The existing `deliveries.test.ts` group fixture stores
  `bare_peer: ''` and is outside the Allowed files; live rows always populate
  `bare_peer`, so the real path never reads the nick.
- `apps/server/src/push/candidates.test.ts` is now ~660 lines, over the
  400-line rule; it was 561 before this task and the Allowed files list has no
  second test file to split into. Every changed source file is under 400.
- `PREREVIEW.md` does not exist in this worktree, so there was nothing to
  delete.

### Round 1 (prereview fix)

**Finding 1 (must-fix) fixed — nick fallback for empty `bare_peer`.** A room
row with no real sender JID (a legacy or malformed row) now uses its nick for
the own-message check, exactly like `chats/deliveries.ts`:

- `push/candidates.ts`: when `bare_peer` is empty, the caller's localpart is
  compared with the row's nick (case-insensitive), so a legacy own row is
  skipped instead of pushed.
- `chats/unread.ts` (`isOwnRow`): same fallback, so a legacy own row above the
  read mark no longer bumps the badge.
- `push/group-notifier.ts`: the sender's localpart falls back to the nick when
  `bare_peer` is empty, so a legacy own row is not delivered to its sender.

Tests added (one per file):

- `push/candidates.test.ts`: "skips a legacy own room row with no bare_peer by
  its nick" (uppercase nick, asserts `skip`).
- `chats/unread.test.ts`: "treats a legacy room row with no bare_peer as the
  caller by its nick" (asserts `unread: 0`).
- `push/group-notifier.test.ts`: "does not push a legacy own row with no
  bare_peer when the nick is the sender" (asserts the sender's device gets
  nothing and the other member's does).

No should-fix findings. Findings 2 and 3 are follow-ups whose fixes need
`search/routes.ts` and `media/*`, outside the Allowed files, so they are
unchanged. Nit 2 (per-row name lookup) is perf-only and not on a line changed
this round; nit 1 (test file length) is pre-existing and unchanged.

**Checks:**

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/push/group-notifier.test.ts src/chats/unread.test.ts`
  → 3 test files passed, 37 tests passed (7.45s).
- `pnpm gate` → `GATE PASS`; 10 changed files, every changed file inside the
  Allowed files, size check passes.


## Review (written by Claude)

Approved after the lead's correction and one auto round. The pre-review found 1 nit and 4 follow-ups.
- **The correction.** The first version read the sender from a muc#user `<x>` in the stored XML. The lead found on live data that ejabberd strips that element before storing, so only a forged one could be there. The task then switched to the archive's `bare_peer` column.
- **What changed:**
  - own-message checks key on `bare_peer`: push candidates, the group notifier, unread and deliveries;
  - room senders are named from the database by JID;
  - a blocked sender's group messages are skipped in pushes.
- **Follow-ups go to T-2014.** These still show the nick as a name:
  - search hits (`search/routes.ts:181`);
  - the media gallery (`media/items.ts`);
  - the topic preview (`topics/preview.ts:123`);
  - the AI context and AI memory.
  
  T-2014 also needs the server's AI-card sender check by `bare_peer`.
