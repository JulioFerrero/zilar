---
id: T-2000
title: "Message pipeline security: an origin id that names someone else's message never links to it — first author wins, so nobody can take over another person's message and edit or delete it — with tests"
status: merged
milestone: M5
branch: task/T-2000-ledger-first-author
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2000: First author wins in the id ledger

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1987) found a way for a group member to take over another member's message.
- **The setup.** Mallory posts a message whose `<origin-id>` is the room stanza id of Ana's message M.
- **The takeover.** The client links the two ids and copies **Mallory** onto M's author entry. It then drops Mallory's message as a "resend".
- **The result.** Mallory's later correction or retraction of M passes the same-author check, so M shows her text, or disappears, for everyone. The same works on an AI's card.

This is the message pipeline, so a test is required.

### Facts (read by the lead on 2026-10-18; paths under `packages/client-core/src/store/`)
- **`ledger-ids.ts`** (307 lines):
  - `linkMessageIds(left, right)` (`:46-61`) aliases the right root onto the left. It migrates reactions, edits, card entries, origin ids, `messageAuthors` and base texts with `migrateIdMap`, which overwrites (`:58-59`).
  - `rememberOriginId(chatId, messageId, originId, sender)` (`:195-…`) handles the first message of an origin id in a chat this way: `if (claim === undefined) { if (originId !== messageId) linkMessageIds(originId, messageId); }` (`:203-209`). It never checks whether `originId` is already another message's id with a different author.
- **`ledger-edits.ts`** (399 lines) allows an edit or retraction when `isSameAuthor(authorFor(target), entry.author)` (`:92`, `:187`).
- **`ledger-incoming.ts:137-140`** calls `rememberOriginId`.
- **The duplicate drop** is in `incoming.ts:144-147`.
- **Tests.** `ledger.test.ts` exists.

### Steps
1. **No cross-author link.** In `rememberOriginId`, when `claim === undefined` and `originId !== messageId`, look up the author recorded for `originId`'s root. If an author is recorded and it isn't the same as `sender` (`isSameAuthor`), don't link the ids, and record nothing for `originId`. The new message stays a separate message with its own id, and it isn't dropped as a resend.
2. **First author wins in `linkMessageIds`.** Never let `migrateIdMap(messageAuthors, ...)` overwrite a root that already has a different author: keep the existing author.
3. **Test** in `ledger.test.ts`:
   - Ana's message M is known with stanza id S.
   - Mallory's message arrives with origin id S. It stays a separate message, it isn't dropped, and M's author is still Ana.
   - Mallory's retraction of S is ignored.
4. **Size.** `ledger-edits.ts` is at 399 lines, so don't add lines to it. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/ledger-ids.ts`
- `packages/client-core/src/store/ledger.test.ts`
- `work/T-2000-ledger-first-author.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The new test passes, the existing ledger and incoming tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- `ledger-ids.ts`:
  - `rememberOriginId`: when an origin id has no claim yet and names another id, it now looks up the author recorded for that id's root (`authorFor(originId)`). If an author is recorded and `isSameAuthor` says it is not `sender`, it returns before linking, so Mallory's message stays a separate bubble with its own id and no claim is recorded for that origin id.
  - `linkMessageIds`: replaced `migrateIdMap(messageAuthors, ...)` with `migrateAuthor`, which copies the author onto the surviving root only when the root has no author yet or the existing author is the same (`isSameAuthor`). A root that already has a different author keeps it, so a link can never overwrite Ana's entry with Mallory's.
- `ledger.test.ts`: added the regression test under the "first author wins in the id ledger (T-2000)" block. It drives the real `handleMessage` path in a group: Ana's message `S` (origin `ana-origin`), then Mallory's message `S2` with `originId: 'S'`. Asserts both bubbles are shown with their own text, `sameMessage('S', 'S2')` is false, `authorFor('S')` is still Ana, and Mallory's retraction naming `S` leaves both messages alive. I also checked that the test fails (1 failed, 27 passed) with the `ledger-ids.ts` change stashed, so it does catch the takeover.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts` — 28 passed (1 file).
- Same command with `ledger-ids.ts` stashed — 1 failed, 27 passed, as expected for the regression test.
- `pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts src/store/incoming.test.ts --reporter=dot` — 55 passed (2 files).
- `pnpm gate` — GATE PASS. Summary:
  - 3 changed files against main
  - PASS install (frozen), format, lint, typecheck, effect, tests @zilar/client-core
  - scope: every changed file is inside the Allowed files
  - migration / images / size checks passed

### Notes for the lead

- Step 2 is implemented as a dedicated `migrateAuthor` helper rather than a flag on `migrateIdMap`, because only the author map needs the "keep the existing value" rule; origin ids and base texts still overwrite as before.
- The author comparison in step 1 is `isSameAuthor(originAuthor, { jid: sender, resolved: true })`, as the spec says. In an anonymous group where the recorded author is unresolved, a resend that reuses a stanza id as its origin id will not be linked (it stays a separate bubble); a resend that reuses its own origin id still goes through the existing claim path, so the dedupe tests are unaffected.
- Test file is 890 lines; the spec's "every file at or under 400 lines" was already broken for `ledger.test.ts` (846 before my change) and it is a test file. `ledger-ids.ts` is 333 lines and `ledger-edits.ts` was not touched (399).


## Review (written by Claude)

Approved, and the pre-review was clean.
- **First message of an origin id.** If the id already names a message with a different author, it is no longer linked to that message. The new message stays separate and is not dropped.
- **Merged aliases.** When two ids merge, `migrateAuthor` keeps the first author.
- **Test.** It covers the takeover attempt: the original keeps Ana as its author, and Mallory's retraction is ignored.
