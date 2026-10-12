---
id: T-1221
title: "Clients show a resent message once: two archived rows of one chat with the same sender and origin id (a by-design resend after a lost ack, T-1216) become one bubble in history and live, by aliasing the second message id to the first in the ledger"
status: merged
milestone: M5
branch: task/T-1221-history-dedupe-origin-id
model: auto
effort: default
depends_on: [T-1216, T-1217]
estimate: 0.3 day
---

# T-1221: One bubble per origin id

## Spec (written by Claude, do not edit)

### Why
A text whose delivery is unknown is resent with the **same origin id** (T-1216, by design), and the server can archive it twice. The server's unread already counts it once (T-1217). The apps don't dedupe it:
- On the emulator (APK `745be24c`, after a cold start), the Claude Test ↔ Julio DM history shows **"Offline two" twice** (05:42 and 05:46). Both rows carry the same origin id.
- An archived message's id is its **stanza-id**, the archive id (`packages/xmpp-core/src/stanza/resolve-sender.ts:116-132`), so the two rows get two different ids.
- History dedupes only by id or alias: `k.sameMessage(item.id, message.id)` (`packages/client-core/src/store/history.ts:137`, and the same pattern at the other page merges in that file).
- The ledger records origin ids (`packages/client-core/src/store/ledger-ids.ts:162-165` `rememberOriginId`), but never uses one to link two ids.

### What to build
1. **Ledger** (`ledger-ids.ts`): when an incoming or history message's origin id is recorded and **another** message id of the **same chat and same sender** already has that origin id, alias the new id to the existing message's root. Use the existing alias mechanism (`aliasRoot` and the alias map, `:20-60`).
   - Then `sameMessage(new, old)` is true, and the existing filters in `history.ts` and the live path drop the second copy without changes there.
   - If the ledger has no chat or sender scope for origin ids today, add the smallest key that gives it (for example `chatId` and `sender` plus `originId`), and cite where incoming messages are recorded (`ledger-incoming.ts`).
   - **Never alias across chats or across senders.** Origin ids are client-generated, so another sender can reuse one.
   - Corrections and retractions name their target by origin id (`correctionTargetFor`, `:180-185`); they must keep working, so don't treat a correction stanza as a second copy. Check `isEditStanza` and the retraction path, and cite them.
2. **Within one history page:** if a single page holds both rows, the second must also be dropped. Check whether the page filter (`history.ts:130-140`) dedupes within the page, and if it doesn't, make the smallest change so it does. `history.ts` is 374 lines; keep it at most 400.
3. **Tests** (the message pipeline), plus 2, in `packages/client-core/src/store/ledger.test.ts`:
   - two history messages in one DM from the same sender, with the same origin id and different stanza-ids, give **one** bubble;
   - the same origin id from **two different senders** gives two bubbles.

### Read first
`AGENTS.md`, `work/T-1216-delivered-but-stuck-sending.md` (the Review), `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/history.ts:110-160` and `packages/xmpp-core/src/stanza/resolve-sender.ts:110-135`.

### Allowed files
`packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger.ts`, `packages/client-core/src/store/ledger-types.ts`, `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/ledger.test.ts`, `work/T-1221-history-dedupe-origin-id.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/ledger.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on the emulator and the web:** the Claude Test ↔ Julio DM shows "Offline two" once.

---

## Report (written by the worker when done)

### What I did

One bubble per origin id, by aliasing the second archived row to the first and
dropping it within a history page.

- **`ledger-ids.ts`** — `rememberOriginId(messageId, originId, chatId?, sender?)`
  now takes the chat and sender (both optional, so the existing two-argument
  callers and mobile's `StoreHelpers.rememberOriginId(messageId, originId)`
  stay compatible). It keeps a new per-chat claim map, keyed
  `` `${chatId}|${originId}` ``, holding `{ sender, root }` (`OriginClaim`,
  `ledger-types.ts`):
  - the first message of an origin id in a chat links its two ids, exactly as
    `toUiMessage` did before (`linkMessageIds(originId, messageId)`);
  - a later message with the **same chat and same sender** aliases to the first
    copy's root, so `sameMessage` is true;
  - a **different sender** reusing the origin id is left alone (the branch
    returns) — never alias across senders. The claim is per chat, so never
    across chats either.
  `ledger.ts` creates and clears the new map (`reset`), and
  `messageOriginIds`/`correctionTargetFor`/`wireTargetFor` behave as before.
- **`ledger-incoming.ts`** — `toUiMessage` no longer links the origin id
  itself; it passes `message.chatJid` and the computed `senderId` to
  `rememberOriginId`, the one place that records the origin id for both
  incoming and history messages. The `senderId` is now computed once and reused
  on the stored message.
- **`history.ts`** — the page filter compared each row only against the store's
  already-loaded messages, so two alias-linked rows in one page both stayed.
  The new exported `dedupePage(sameMessage, messages)` keeps the first copy of
  each `sameMessage` group; both `openHistory` and `loadOlderPage` now map the
  page through `withEdits` and then `dedupePage` before writing it.
- **`ledger-types.ts`** — `OriginClaim` type and the `originClaims` field on
  `LedgerMaps`.

### Why corrections and retractions keep working

A correction/retraction names its target by origin id (`correctionTargetFor`,
`ledger-ids.ts:221`). `isEditStanza` (`ledger-signatures.ts:44-46`) marks a
XEP-0308/0424 stanza, and every render path filters it out before `toUiMessage`:
`incoming.ts:101-104` and `history.ts` (`loadOlderPage` and `openHistory`, the
`!k.isEditStanza(message)` filters) so an edit stanza never reaches
`rememberOriginId` and is never treated as a second copy. The first copy still
links `originId ↔ messageId`, so a correction naming the origin id resolves
against the id the message is stored under — the existing `ledger.test.ts`
tests (`correctionTargetFor`, the correction/retraction cases) still pass.

### Tests (the message pipeline; `ledger.test.ts`, +2)

Two new tests under "the message ledger: one bubble per origin id", both driving
the real `openHistory` over a MAM fake (`testCtx`):
- two archived DM rows from the **same sender**, same origin id, different
  stanza-ids (`stanza-a`, `stanza-b`) give one bubble, and `sameMessage` holds
  for both ids;
- the same origin id from **two different senders** gives two bubbles, and
  `sameMessage('stanza-a', 'stanza-b')` is false.

I checked each test fails without its half of the fix: with `dedupePage` made an
identity, test 1 fails (`expected [ 'stanza-a', 'stanza-b' ] to have a length of
1 but got 2`); with the cross-sender guard removed, test 2 fails (`expected 2,
got 1`). Both restored, both pass.

### Commands (real results)

- `pnpm install` — Done in 20.1s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts` — 11 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/history.test.ts src/store/incoming.test.ts` — 50 passed (3 files).
- `pnpm gate` — GATE PASS:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (1.5s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/client-core  (2.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  The first gate run was red on `typecheck`: the test's MAM fake set `first`
  explicitly to `string | undefined`, which `exactOptionalPropertyTypes` rejects;
  fixed by spreading `first` only when defined. No files outside the Allowed
  files.

### Files changed / line counts

`ledger-ids.ts` (254), `ledger-incoming.ts` (179), `ledger.ts` (132),
`ledger-types.ts` (89), `history.ts` (400), `ledger.test.ts` (439, test exempt),
`work/T-1221-history-dedupe-origin-id.md`. Every touched source is at most 400
lines.

### Deviations / open questions

- The spec says "the existing filters in `history.ts` **and the live path** drop
  the second copy without changes". The live incoming append in
  `incoming.ts:146-150` filters on `item.id !== ui.id` (a raw id, not
  `sameMessage`), so a duplicate that arrives **live in one batch** would not be
  dropped there — only the history path is fixed, as the Allowed files cover
  `history.ts` but not `incoming.ts`. For this bug both rows are archive rows
  loaded by `openHistory` on cold start, which the fix covers; the emulator
  showed history. If the lead wants the live path hardened too, it needs
  `incoming.ts` in scope (a one-line change to `!sameMessage(item.id, ui.id)`).
  I did not touch it.
- The emulator and web check ("Offline two" once in the Claude Test ↔ Julio DM)
  is the lead's, not run by me.

### Blocked / needs a decision

Nothing blocking.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:**
  - the ledger keys origin ids by chat and sender, and aliases a second message id with the same key to the first one's root. Never across chats or senders; corrections and retractions are kept out;
  - history pages also dedupe within a page.
- **Lead checks after the rebase onto main:** the full client-core suite 108 of 108, web 60 of 60 and the mobile store 40 of 40; `tsc` gives 0 errors for client-core, web and mobile.
- **The follow-up (next task, T-1222):** the live incoming append still compares ids exactly (`incoming.ts:149`), so a resend that arrives live shows twice for the receiver.
- **Still to do:** on the emulator and the web, the Claude Test ↔ Julio DM shows "Offline two" once.
