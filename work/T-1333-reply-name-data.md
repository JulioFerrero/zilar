---
id: T-1333
title: "Reply quotes carry the right sender name in the data, not only at render: resolve replies within a history page (client-core), colour an unloaded quote by its 'to' JID, and drop the dead mobile senderColor (T-1326 follow-ups)"
status: merged
milestone: M5
branch: task/T-1333-reply-name-data
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1333: Reply name in the data

## Spec (written by Claude, do not edit)

### Why
T-1326 (merged 2026-10-13) found that a reply's `senderName` is `''` whenever the replied-to message isn't already in `messagesByChat`:
- `toUiMessage` resolves it in `packages/client-core/src/store/ledger-incoming.ts:116-131`;
- history maps a whole page **before** inserting it (`packages/client-core/src/store/history.ts:149-169`, `274-289`), so a reply to a message on the same page gets no name;
- `withReplyQuote` (`ledger-edits.ts:199-219`) fixes only the text.

T-1326 worked around it where the quote is drawn. Anything else that reads `replyTo.senderName` still sees `''`: notifications, previews, search, forwarding. This is the message pipeline, so tests are allowed.

### What to build
1. **History:** after mapping a page, resolve each `replyTo.senderName` (and keep the excerpt) from messages in the same page **or** already in the store, before inserting. Keep it in `history.ts`, or in a small helper in `ledger-incoming.ts`.
2. **The wire `to`:** when the target isn't loaded at all, fill `senderName` from the reply's `to` JID if a name is known for it (contacts or members, the same lookup `toUiMessage` uses for senders; cite it). Also keep the `to` JID on `ReplyRef` as an optional `senderId`, so T-1326's colour (`packages/chat-core/src/messages.ts:280`, now `referenced?.senderId ?? quote.id`) can use it instead of the reply id.
3. **Dead code:** delete the unused `senderColor` / `SENDER_COLORS` in `apps/mobile/src/lib/depth.ts` (T-1326 moved them to chat-core).
4. **Tests (pipeline):** one test in the nearest `client-core` history test: a page where message B replies to A, on the same page, gives B a `replyTo.senderName` equal to A's sender. Run only that file.
5. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `work/T-1326-sender-colors-reply-quotes.md` (Report), `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger-edits.ts`, `packages/chat-core/src/types.ts`, `packages/chat-core/src/messages.ts`.

### Allowed files
`packages/client-core/src/store/history.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger-edits.ts`, `packages/client-core/src/store/*.test.ts`, `packages/chat-core/src/types.ts`, `packages/chat-core/src/messages.ts`, `apps/mobile/src/lib/depth.ts`, `apps/web/src/components/ReplyQuote.tsx`, `apps/mobile/src/components/chat/reply-quote.tsx`, `work/T-1333-reply-name-data.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/<the history test you touch> --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the new test passes.
- **The lead's check:** on the web mock, quotes still show the right names (Viernes, Ana).

---

## Report (written by the worker when done)

### What I did

1. **History resolves reply names before inserting.** `replyReferenceFor` (new, `packages/client-core/src/store/ledger-incoming.ts`) looks a reply's target up in the loaded store **then in the page being mapped**. `toUiMessage` takes an optional third `page` argument; `loadOlderPage` and `openHistory` (`history.ts`) pass `page.messages`, so a reply to a message on the same history page now gets that target's `senderName` and excerpt (`text`) in the data, before `ctx.set` inserts the page. The alias-aware `sameMessage` lookup is kept, so origin/stanza-id aliases still match.
2. **The wire `to` names an unloaded target.** When neither the store nor the page has the target, `nameForReplyTo` fills `senderName` from the reply's wire `to` JID (XEP-0461 `{ id, to? }`), using the same sources `senderNameFor` reads for a sender — me → contact → group member, cited at `ledger-identity.ts:45`. `ReplyRef` gained an optional `senderId` (`packages/chat-core/src/types.ts`), set to the wire `to` JID. `replyQuoteContent` (`packages/chat-core/src/messages.ts`, was line 284) now colours by `referenced?.senderId ?? quote.senderId ?? quote.id`.
3. **Dead code removed.** Deleted the unused `SENDER_COLORS` / `senderColor` from `apps/mobile/src/lib/depth.ts` (no importers; T-1326 moved them to chat-core).
4. **Tests** in `packages/client-core/src/store/history.test.ts` (the nearest history test): a page where message B replies to A on the same page gives B `replyTo.senderName === 'Ana'` and `replyTo.text === 'msg 0'`; a second case names a reply to an unloaded target from its `to` JID and keeps `senderId`.
5. Every file stays ≤ 400 lines: `history.ts` 399, `history.test.ts` 400, `ledger-incoming.ts` 236, `types.ts` 263, `messages.ts` 334, `depth.ts` 130.

### Files changed (all inside Allowed files)

`packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/history.test.ts`, `packages/chat-core/src/types.ts`, `packages/chat-core/src/messages.ts`, `apps/mobile/src/lib/depth.ts`, `work/T-1333-reply-name-data.md`.

`apps/web/src/components/ReplyQuote.tsx` and `apps/mobile/src/components/chat/reply-quote.tsx` needed no change: both already render `replyQuoteContent`, which now reads `quote.senderId`.

### Commands run (real results)

- `pnpm install` → `Done in 12.3s using pnpm v10.32.1`.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts` → **21 passed (1 file)**.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/incoming.test.ts` → **39 passed (2 files)**.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/sender-color.test.ts src/messages.test.ts` → **30 passed (2 files)**.
- `pnpm gate` (from the repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (0.9s)
  PASS  tests @zilar/client-core  (4.4s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Notes / deviations

- The page resolution runs **inside** the `toUiMessage` mapping (via the optional `page` arg) rather than as a separate post-map pass. Same effect, and it kept `history.ts` at 399 lines (a separate helper plus wrapped call sites pushed it over 400).
- The mock seed needed no change: the wire reply carries no name, and its targets load on the same thread, so both the new data fill and T-1326's render resolution show the right name.
- Open question (not fixed, matches existing behaviour): in a MUC the wire `to` may be an occupant JID while a loaded message's `senderId` is its real JID, so an unloaded-target colour could differ from the loaded one. `senderColor` hashes whatever id it gets.

### Blocked / needs a decision

None.

### Security checklist

No new routes, deletes, updates or secrets; the change is data mapping in the message pipeline plus one optional type field.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `a32f5724`.**
- **What changed:** history now passes the page's messages to `toUiMessage`, so a reply to a message on the same page gets its name in the data. An unloaded quote is named and coloured from the reply's `to` JID (`ReplyRef.senderId`). The dead mobile `senderColor` is gone.
- **Lead's checks:**
  - `history.test.ts`: 21 pass; chat-core: 102 pass; web and mobile tsc: 0 errors;
  - the web mock (headless) still shows "Marta / Viernes.png" and "Luis / Who took that?" with coloured bars in Viernes.
