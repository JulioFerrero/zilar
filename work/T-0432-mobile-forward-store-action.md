---
id: T-0432
title: "Forwarding (mobile store): forwardMessages(targets, messages, { comment }) sends copies with a <forward> origin, mirroring web T-0414"
status: todo
milestone: M5
branch: task/T-0432-mobile-forward-store-action
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0432: `forwardMessages` in the mobile store

## Spec (written by Claude, do not edit)

### Why
This is task T-F part 1 in `docs/audit/forwarding-plan.md` §4. Julio accepted every §5 recommendation on 2026-10-06. Web has had the action since T-0414. Mobile needs the same store action before the forward sheet UI (the next task). Mobile already shows received forwards (T-0427).

### Reference implementation (web, merged): port it
`apps/web/src/store/realStore.ts`:
- **`forwardPublicRoomFor`** (~3305-3311): only a public group or topic exposes `chat_id`/`chat_name`.
- **`forwardOriginFor`** (~3318-3337):
  - reuse a message's own `forward` after `ForwardOriginSchema.safeParse`;
  - otherwise build `{ sender_id, sender_name, chat_id?, chat_name?, original_id?, original_at }` and safeParse it;
  - skip the message on failure.
- **`forwardedPayloadFor`** (~3343-3358):
  - a card → `PayloadSchema`;
  - an attachment → `AttachmentSchema`;
  - voice without its `transcript` → `VoiceMetaSchema`.
- **`forwardedUiFieldsFor`** (~3362-3372).
- **`runForwardSend`** (~3378-3414).
- **`forwardMessages`** (~4282-4345):
  - dedup the targets;
  - skip unknown targets;
  - skip deleted, failed and sending messages;
  - one optimistic copy per message per target, with the echo signature exactly like the matching normal send;
  - `rememberAuthor`;
  - the comment is sent through `sendText` only when at least one copy was queued for that target.
- **Tests to mirror:** `apps/web/src/store/realStore.forward.test.tsx`.

### Verified facts about mobile (do not re-derive)
- **`apps/mobile/src/store/real-store.ts`:**
  - imports `StickerSchema` from `@zilar/protocol` at line 38; `ForwardOriginSchema`, `PayloadSchema`, `AttachmentSchema` and `VoiceMetaSchema` are all exported by `@zilar/protocol`;
  - `coreKind` line 200, `pendingOutgoing` 411, `signatureFor` 511, `stickerSignatureFor` 518, `linkLocalToServer` 560, `rememberAuthor` 592, `authorFor` 602, `correctionTargetFor` 917, `runStickerSend` 1512, `myJid` 1540;
  - `markStickerFailed` (1168) sets `failed: true` on any message; it is the mobile failure style;
  - `sendText` at 3161, `sendSticker` at 3225.
- **Differences from web:**
  - mobile has **no** send-timeout machinery (`armSendTimeout`, `isCurrentSendRun` and `settleSendTimeout` do not exist) and **no** `rememberBaseText` or `sendFailureReasonFor`;
  - on mobile, `runForwardSend` = the `runStickerSend` shape: `sendMessage(target.id, coreKind(target), body, { ...(payload ? { payload } : {}), forward: origin })`, then `.then` to link the ids (`linkMessageIds`, `linkLocalToServer`, `rememberOriginId`) and `updateMessageStatus(…, 'sent')`; on `.catch` (or no core), mark the copy `failed: true` the way `markStickerFailed` does.
- **The `ChatStore` interface** is `apps/mobile/src/store/types.ts`, with `sendSticker` at line 262. Add `forwardMessages: (targets: string[], messages: UiMessage[], options?: { comment?: string }) => void;` with a one-line doc comment.
- **The mock store** `apps/mobile/src/store/chat-store.ts` (with `sendSticker` at 1118) must implement it too. Mobile mock mode is the QA mode, so make the mock really insert copies: for each known target and each non-deleted message, add a `UiMessage` with `forward: { sender_id: message.senderId, sender_name: message.senderName, original_at: message.createdAt.toISOString() }`, the same text, card, attachment and voice, `status: 'sending'`, then `sent` with the same timers `sendText` uses (lines 1085-1116). After the copies, send the comment through the mock `sendText`.
- **Tests:** `apps/mobile/src/store/real-store.test.ts` has `setup()` (line 245) with a `fakeXmpp`. Write the new tests in a new file `apps/mobile/src/store/real-store.forward.test.ts`, copying the setup it needs.

### What to build
1. **`types.ts`:** the `forwardMessages` member.
2. **`real-store.ts`:** port the web helpers and the action, with the differences above.
3. **`chat-store.ts`:** the mock action.
4. **Tests in `real-store.forward.test.ts`:**
   - a text forward to two targets makes two `sendMessage` calls, each with a `forward` origin and no `replyTo` or `mentions`;
   - a sticker forward keeps the payload;
   - a deleted message is skipped, and with a comment nothing is sent to that target;
   - the comment is sent after the copies;
   - a private-topic source omits `chat_id` and `chat_name`;
   - a rejected send marks only that copy `failed: true`;
   - the echo of a copy replaces its bubble, with no duplicate.

   In `apps/mobile/src/store/chat-store.test.ts`, add one test that the mock inserts a copy with `forward` in the target chat.

### Read first
`AGENTS.md`, `docs/audit/forwarding-plan.md` §3.1-§3.6, `apps/web/src/store/realStore.ts:3300-3415` and `:4282-4345`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/mobile/src/store/real-store.ts:500-610` and `:1160-1180` and `:1505-1545` and `:3161-3290`, `apps/mobile/src/store/types.ts:240-270`, `apps/mobile/src/store/chat-store.ts:1080-1170`, `apps/mobile/src/store/real-store.test.ts:1-60` and `:240-300`.

### Allowed files
`apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/real-store.forward.test.ts`, `apps/mobile/src/store/chat-store.test.ts`, `work/T-0432-mobile-forward-store-action.md`.

If a test or a fake store elsewhere fails typecheck because it builds a full `ChatStore`, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot real-store.forward chat-store.test
pnpm gate
```

### Acceptance
- `forwardMessages` exists in the mobile real store and the mock store, with web's rules: a validated origin, payloads reused, skips, a comment only after a queued copy, and per-copy failure.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
