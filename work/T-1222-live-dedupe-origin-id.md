---
id: T-1222
title: "A resent message that arrives live shows once: the live incoming path drops a message the ledger links to one already in the chat (same sender + origin id, T-1221) — no second bubble, no unread bump, no preview move"
status: merged
milestone: M5
branch: task/T-1222-live-dedupe-origin-id
model: auto
effort: default
depends_on: [T-1221]
estimate: 0.1 day
---

# T-1222: Live resends show once

## Spec (written by Claude, do not edit)

### Why
T-1221 (merged) makes the ledger alias a second message id with the same chat, sender and origin id to the first, and history drops the copy. Its pre-review left a follow-up. The **live** incoming path still compares ids exactly: `packages/client-core/src/store/incoming.ts:146-149` filters `item.id !== ui.id`, then appends `ui` and bumps `unread` (`:150-156`).

A resend arrives live with a new stanza-id, so the receiver sees a second bubble and one more unread. Example: the sender's lost ack (T-1216) while the receiver is online.

### What to build
1. In `incoming.ts`, for a non-outgoing message (after `const ui = k.toUiMessage(…)` at `:117`), check whether the chat already holds a message `k.sameMessage(item.id, ui.id)` with a **different** id. If it does, the message is a resend copy: return without appending, without bumping `unread` and without moving the chat (no `moveChatToTop`).
   - **The order matters.** Confirm in the Report that the ledger has recorded this stanza's origin id and alias **before** this check, citing where (`ledger-incoming.ts` or `toUiMessage`). If it records after, move the check after the record, not the record before rendering.
   - Leave the outgoing echo path (`handleOutgoingEcho`, `:119-121`) and the edit and reaction paths (`:100-113`) unchanged.
2. `incoming.ts` is 263 lines; keep it at most 400.
3. **Test** (the message pipeline), plus 1, in `packages/client-core/src/store/incoming.test.ts`: two live messages in one DM from the peer, with the same origin id and different stanza-ids, give one bubble and `unread: 1`.

### Read first
`AGENTS.md`, `work/T-1221-history-dedupe-origin-id.md` (the Report and the Review), `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-incoming.ts` and `packages/client-core/src/store/incoming.test.ts`.

### Allowed files
`packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/incoming.test.ts`, `work/T-1222-live-dedupe-origin-id.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I did

Live resends show once: the live incoming path drops a message the ledger
links to one already in the chat.

- **`incoming.ts`** — in `handleMessage`, for a non-outgoing message right
  after `const ui = k.toUiMessage(…)` and the outgoing-echo early return, the
  chat's stored messages are checked for one with a **different** id that
  `k.sameMessage(item.id, ui.id)`. On a hit the handler returns before any
  side effect: no append, no `unread` bump, no `moveChatToTop`, no typing or
  draft changes. The outgoing echo path and the edit/reaction early returns
  are unchanged and still run first.
- **`incoming.test.ts`** — one new test: two live DM messages from the peer
  with the same origin id and different stanza-ids give one bubble and
  `unread: 1`, with the first copy kept as `lastMessage` and `syncBadge`
  called once.

### Order: the ledger records before the check

`handleMessage` calls `k.toUiMessage(message, meId)` at `incoming.ts:117`,
which is `createLedgerIncoming` (`ledger-incoming.ts:85-95`): when the stanza
carries an `originId` it calls `rememberOriginId(message.id, message.originId,
message.chatJid, senderId)`, which aliases the new id to the first copy's root
(`ledger-ids.ts:194-198`) for the same chat and sender. Only after that does
the new resend check consult `k.sameMessage`, so the alias exists by the time
it is read. No record was moved; the check was placed after the record.

### Commands (real results)

- `pnpm install` — Done in 11s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot
  src/store/incoming.test.ts` — 23 passed (22 existing + 1 new).
- Fix reverted temporarily (stash of `incoming.ts` only): the suite fails with
  exit status 1, so the new test is load-bearing. Fix restored, 23 passed
  again.
- `pnpm gate` — GATE PASS:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Files changed / line counts

`incoming.ts` (274, limit 400), `incoming.test.ts` (413, test file),
`work/T-1222-live-dedupe-origin-id.md`. No files outside the Allowed files.

### Deviations / open questions

None. Cross-sender and cross-chat safety comes from T-1221's
`rememberOriginId` scope (`chatId` + `sender`); the live check only reads
`sameMessage`, the same predicate the history path uses.

### Security checklist

- No secrets, tokens or message text reach logs or errors; the change adds no
  logging.
- No deletes/updates outside the chat's own message list; the drop is a
  no-op return, the only write path touched is the existing append.
- No permission, cap or audit surface touched; no new routes.

### Blocked / needs a decision

Nothing blocking.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 0 nits.**
- **The change:** the live path drops a message the ledger already linked (`sameMessage` with a different id), with no bubble, no unread bump and no preview move. It runs after `toUiMessage` records the alias (`ledger-incoming.ts`).
- **Lead checks:** the full client-core suite 109 of 109; `tsc` gives 0 errors for client-core, web and mobile.
