---
id: T-1825
title: "DM interactive cards, clients: messages carry their origin id; in a direct chat web and phone answer a card with that id and send the decision reply as plain text (no @mention), rooms unchanged (plan docs/plan/dm-interactive-cards.md tasks 4 and 6)"
status: merged
milestone: M5
branch: task/T-1825-dm-cards-clients
model: auto
effort: default
depends_on: [T-1809]
estimate: 35 min
---

# T-1825: DM cards, client side

## Spec (written by Claude, do not edit)

### Why
Plan `docs/plan/dm-interactive-cards.md` (T-1809), Option A, tasks 4 and 6.
- **The id:** a DM card is recorded under the **origin id** it was sent with (T-1824), but a client keys an incoming DM message by its archive id. In a direct chat the card must send `originId`.
- **The reply:** a DM turn needs no mention, since every owner message in the AI's DM is queued (`apps/server/src/agents/gateway.ts:262-296`). So the decision reply there is plain text.
- Old servers simply 404, as today.

### Facts (read by the lead on 2026-10-17, main `f380f4762`)
- **`UiMessage`** is at `packages/chat-core/src/types.ts:68-100` and has no `originId`. `ChatKind = 'dm' | 'group' | 'ai'` (`:3`); a DM with an AI is a direct chat, so "direct" means `kind !== 'group'`.
- **`toUiMessage`** (`packages/client-core/src/store/ledger-incoming.ts:126-160`) reads `message.originId` (`:138-140`), but never puts it on the returned `ui`.
- **Web:** `apps/web/src/components/message/AttachmentBody.tsx` (350 lines).
  - It has `chat: ChatSummary` (`:39`).
  - `blockRespond` (`:78-100`) sends `messageId: message.id`, and `reply` sends `@${message.senderName} ${text}` with `mentions` and `replyTo`.
- **Phone:**
  - `apps/mobile/src/components/chat/message-bubble.tsx` has `isGroup: boolean` in `MessageBubbleProps` (`:30-32`) and renders `MessageBubbleContent`.
  - `apps/mobile/src/components/chat/message-bubble-content.tsx` (359 lines) builds the `respond` target `{ messageId: message.id, chatId, aiName, aiJid }` at `:198-207`, and has no `isGroup`.
  - `BlockRespondTarget` is at `apps/mobile/src/components/chat/blocks/block-respond.tsx:12-17`.
  - `apps/mobile/src/components/chat/blocks/block-card.tsx` `submit` sends `@${aiName} ${reply}` with `mentions` (around `:163-176`).

### Steps
1. **`types.ts`:** add `originId?: string` to `UiMessage`, documented as the XEP-0359 origin id when the stanza had one.
   - Set it in `toUiMessage` when `message.originId !== undefined`.
   - **One test** in `packages/client-core/src/store/ledger.test.ts`: a message with an origin id carries it on the UI message.
2. **Web `AttachmentBody`:**
   - When `chat.kind !== 'group'`, `blockRespond.messageId` is `message.originId ?? message.id`.
   - In a direct chat, `reply` sends `text` alone with the same `replyTo` and no `mentions`.
   - Rooms are unchanged. Add `message.originId` and `chat.kind` to the memo deps.
3. **Phone:**
   - Pass `isGroup` from `MessageBubble` into `MessageBubbleContent`.
   - Add `direct?: boolean` to `BlockRespondTarget`. The target sets `direct: !isGroup` and `messageId: !isGroup ? (message.originId ?? message.id) : message.id`.
   - In `block-card.tsx` `submit`, when `respond.direct === true`, send the reply as plain `request.reply` with `replyTo` and no `mentions`.
4. Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/ledger-incoming.ts`
- `packages/client-core/src/store/ledger.test.ts`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/blocks/block-respond.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `work/T-1825-dm-cards-clients.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In a direct chat, a card answer names the origin id and the decision reply has no `@` prefix or mention.
- Group cards are unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Shared types:** added `originId?: string | undefined` to `UiMessage`
  (`packages/chat-core/src/types.ts`), documented as the XEP-0359 origin id.
  The `| undefined` is needed by `exactOptionalPropertyTypes`: web's
  `InTabMessage` (`apps/web/src/lib/push/inTab.ts:21`) intersects `UiMessage`
  with `{ originId?: string | undefined }`, and a plain `originId?: string`
  made the intersection reject the explicit `undefined` at
  `storeContext.ts:117`. It matches the existing `handle?: string | undefined`
  precedent in the same file.
- **Ledger:** `toUiMessage` copies `message.originId` onto the returned UI
  message when present (`packages/client-core/src/store/ledger-incoming.ts`).
- **Test:** one test in `packages/client-core/src/store/ledger.test.ts`: an
  incoming stanza with an origin id carries it on the UI message.
- **Web:** in `AttachmentBody.tsx`, a card in a direct chat
  (`chat.kind !== 'group'`) answers with `message.originId ?? message.id`; the
  decision reply sends `text` alone with the same `replyTo` and no `mentions`.
  Group chats keep the `@name` prefix and mention. `message.originId` and
  `chat.kind` joined the memo deps.
- **Phone:** `MessageBubble` passes `isGroup` into `MessageBubbleContent`,
  which sets `direct: !isGroup` on the `respond` target and uses the origin id
  for `messageId` in a direct chat. `BlockRespondTarget` gained
  `direct?: boolean`. In `block-card.tsx`, `submit` sends `request.reply` as
  plain text with `replyTo` and no `mentions` when `respond.direct === true`;
  groups keep the `@name` reply and mention.
- Every changed source file stays under 400 lines (largest: 367).

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts`
  → 1 file, 27 tests passed.
- `pnpm gate` → exit 0:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (1.3s)
  PASS  tests @zilar/client-core  (5.2s)
  PASS  tests @zilar/mobile  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed only at `@zilar/web#typecheck` with the
  `originId` exact-optional error described above; the fix is the
  `| undefined` in the type. No files outside the Allowed files were touched.

### Notes for the lead

- No UI tests were added, per AGENTS.md (UI is covered by the phone smoke and
  live checks). The card behaviour itself was not exercised on a device.
- On phone the DM decision reply's `replyTo` names `respond.messageId`, which
  in a direct chat is the origin id; on web it names `message.id` as the spec
  says ("the same `replyTo`"). Both are alias-resolved by the ledger, but the
  two clients name the target differently in a DM.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `5322f758a`.
- **`UiMessage.originId`** is set from the stanza's origin id, with one ledger test.
- **In a direct chat** (`kind !== 'group'`), web and phone send `originId ?? id` as the card's `messageId`, and the decision reply is plain text with `replyTo` and no mention. Rooms are unchanged.
- **The worker's note** (web quotes `message.id` while the phone quotes the origin id in a DM reply) is harmless: the ledger and the AI resolve both.
- **Interactive DM cards stay refused** by the server (T-1803) until the DM path is tried live.
