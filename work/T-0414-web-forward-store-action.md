---
id: T-0414
title: "Forwarding step 3 (web store): forwardMessages(targets, messages, { comment }) sends copies with a <forward> origin"
status: merged
milestone: M5
branch: task/T-0414-web-forward-store-action
model: auto
effort: low
depends_on: [T-0409]
estimate: 0.4 day
---

# T-0414: forwardMessages store action

## Spec (written by Claude, do not edit)

### Why
This is task T-D of `docs/audit/forwarding-plan.md` §4, approved by Julio on 2026-10-06. T-0409 (merged) gives `UiMessage.forward` and shows the header. This task adds the store action that sends the forwards. The picker UI comes next and calls it. There is no UI in this task.

### Julio's decisions (§5, all recommendations)
- The optional comment is a **separate text message per target**, sent after that target's forwards.
- Attachments, voice notes and stickers **reuse the source URL**: copy the payload as it is, with no re-upload.
- The original sender's name is always shown, as `sender_name`.
- **Drop** the reply and the mentions. Do not copy the transcript.
- Skip deleted messages.
- From a **private topic**, omit `chat_id`/`chat_name` from the origin. Only a public origin carries them: `packages/protocol/src/forward.ts:8-9` and the refine at lines 26-28.

### Verified facts (do not re-derive)
- **`packages/protocol/src/forward.ts`:** `ForwardOrigin` = `{ sender_id, sender_name, chat_id?, chat_name?, original_id?, original_at }`.
- **`packages/xmpp-core/src/types.ts:200-208`:** `SendMessageOptions` has `payload?`, `forward?: ForwardOrigin`, `replyTo?` and `mentions?`.
- **`packages/chat-core/src/types.ts:55-95`:** `UiMessage` has `text?`, `voice?: VoiceMeta`, `attachment?: Attachment`, `card?: Payload` (stickers and other cards), `forward?`, `deleted?`, `failed?` and `status`.
- **`apps/web/src/store/store.ts:~301-305`:** the store interface declares `sendText`, `sendVoice`, `sendAttachment` and `sendSticker`.
- **`apps/web/src/store/realStore.ts`:**
  - `sendText` (line 3931) shows the optimistic flow: `sequence` → `local-N` id → a `UiMessage` with `status: 'sending'`, `signatureFor(chatId, body, replyTo)` (line 932) queued in `pendingOutgoing` (line 802), then `setChatMessage`, `rememberAuthor`, `rememberBaseText`, then `core.sendMessage(chatId, coreKind(chat), body, opts).then(sent => { linkMessageIds; linkLocalToServer; rememberOriginId; updateMessageStatus(…, 'sent') })`;
  - `sendSticker` (line 4105) validates the payload before the optimistic insert, because `encodePayload` throws on an invalid payload, and it keys its echo queue with `stickerSignatureFor` (line ~940);
  - `runStickerSend` (line 1649) and `runVoiceSend` (line 3240) are the payload send paths;
  - `coreKind(chat)` is at line 430;
  - the echo of my own send is matched back to the optimistic bubble through the `pendingOutgoing` signatures.
- **Which chats are targets:** `get().chats` (each with `id`); `chat.isPrivate`/visibility fields show whether a topic is private. Read `ChatSummary` in `packages/chat-core/src/types.ts` to find the exact field.

### What to build
1. **`apps/web/src/store/store.ts`:** declare `forwardMessages: (targets: string[], messages: UiMessage[], options?: { comment?: string }) => void`, with a doc comment.
2. **`apps/web/src/store/realStore.ts`:** implement it.
   - **Order:** for each target chat (skip unknown ids), for each message in the given order:
     - skip it when it is `deleted`, `failed` or still `sending`;
     - build `origin: ForwardOrigin`:
       - when the message already has a `forward`, reuse that origin, so a forward of a forward keeps the first author;
       - otherwise build it from the message: `sender_id` = its author JID (use the same author lookup the store uses for replies, `rememberAuthor` and its reader) or `senderId`; `sender_name`; `original_id` = its origin id when known; `original_at` = `createdAt.toISOString()`; plus `chat_id`/`chat_name` only when the source chat is not a private topic;
       - validate it with `ForwardOriginSchema.safeParse`, and skip the message if that fails, which caps over-long names.
   - **Body and payload:** send `text` as the body and copy the payload from `card`, from `attachment` (rebuilt as `{ v: 0, type: 'attachment', data: attachment }`) or from `voice` (the same for voice). Validate the payload with the protocol schemas before the optimistic insert, as `sendSticker` does. Send with `core.sendMessage(target, coreKind(chat), body, { payload?, forward: origin })`, with no `replyTo` and no `mentions`.
   - **Optimistic bubble:** insert it with `forward: origin` and the copied `text`, `card`, `attachment` and `voice`. Key the echo queue so the server echo links to this bubble and does not duplicate it. Use the same signature function the matching normal send uses for that kind, plus a suffix only if the echo path computes the same suffix. Read how incoming echoes compute the signature before choosing.
   - **On a send failure:** mark the bubble failed with the same fixed-reason machinery the voice and attachment sends use (`failureReason`), never with raw error text.
   - **Comment:** after a target's forwards, when `options.comment?.trim()` is not empty, call the existing `sendText(target, comment)`.
3. **New file `apps/web/src/store/realStore.forward.test.tsx`.** Copy the fake-core setup from `apps/web/src/store/realStore.test.tsx`. It checks that:
   - a text forward to two targets makes two `core.sendMessage` calls, each with `forward` and no `replyTo`/`mentions`;
   - an attachment forward keeps the same URL in its payload;
   - a deleted message is skipped;
   - a forward of a forward keeps the original `sender_name`;
   - a private-topic source has no `chat_id`/`chat_name`;
   - the comment is sent as a separate text after the forwards;
   - the server echo replaces the optimistic bubble, with no duplicate;
   - a rejected send marks the bubble failed with a fixed reason.

### Read first
`AGENTS.md`, `docs/audit/forwarding-plan.md` §3 and the T-D section of §4, `packages/protocol/src/forward.ts`, `apps/web/src/store/realStore.ts:800-960`, `:1640-1700`, `:3231-3300` and `:3931-4175`, and `apps/web/src/store/realStore.test.tsx` (setup and one send test).

### Allowed files
`apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.forward.test.tsx`, `work/T-0414-web-forward-store-action.md`. If the mock store or another store implementation must declare the new action for typecheck, add it there as a no-op and list it in the Report. If that file is outside the Allowed files, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot realStore.forward
pnpm gate
```

### Acceptance
- `forwardMessages` sends one copy per message per target, with the `<forward>` origin, the reused payloads and no reply or mentions.
- The comment is sent separately.
- Echoes do not duplicate.
- Failures are marked.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/store/store.ts`: declared `forwardMessages(targets, messages, options?)` on `ChatStore` with a doc comment, and added a no-op implementation to the in-memory mock store (the mock store lives in this file, so no file outside the Allowed set was needed).
- `apps/web/src/store/realStore.ts`: implemented `forwardMessages` and four closure helpers (`forwardPublicRoomFor`, `forwardOriginFor`, `forwardedPayloadFor`, `forwardedUiFieldsFor`, plus `runForwardSend`).
  - For each target (unknown ids skipped, duplicates ignored), for each message in order:
    - skips `deleted`, `failed` and still-`sending` messages (and, defensively, any with no body and no payload);
    - reuses the message's own `forward` origin (so a forward of a forward keeps the first author), otherwise builds `sender_id` from `authorFor(id)?.jid ?? senderId`, `sender_name`, `original_id` from `correctionTargetFor(id)` when known, `original_at` from `createdAt.toISOString()`, and `chat_id`/`chat_name` only for a public group/topic source; validates with `ForwardOriginSchema.safeParse` and skips on failure;
    - copies the payload from `card` (validated with `PayloadSchema`), `attachment` (rebuilt `{ v: 0, type: 'attachment', data }`, validated with `AttachmentSchema`) or `voice` (rebuilt `{ v: 0, type: 'voice', data }`, `transcript` dropped, validated with `VoiceMetaSchema`); sends with no `replyTo`/`mentions`;
    - inserts an optimistic `UiMessage` with `forward`, the copied `text`/`card`/`attachment`/`voice` and `status: 'sending'`, keyed in `pendingOutgoing` with `signatureFor` (or `stickerSignatureFor` for a sticker payload) so the echo links instead of duplicating;
    - sends via `core.sendMessage(target.id, coreKind(target), body, { payload?, forward })` using the `armSendTimeout`/`settleSendTimeout` machinery; a rejection calls `markSendFailed(..., sendFailureReasonFor(error, false))` (fixed reason, never raw text);
  - after a target's copies, calls the existing `sendText(target, comment)` when `options.comment?.trim()` is non-empty.
- `apps/web/src/store/realStore.forward.test.tsx`: new test file (copied fake-core/fake-api setup from `realStore.test.tsx`) with the eight required cases plus a public-origin case.

### Commands and results
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot realStore.forward` → `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
- `pnpm gate` (repo root) → `gate: 4 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Deviations / problems
- **Origin room fields:** the spec's "What to build" says add `chat_id`/`chat_name` "only when the source chat is not a private topic". I followed the stricter, plan-aligned rule from the task's *Julio's decisions* ("Only a public origin carries them", `forwarding-plan.md` §3.1/§3.6) and include them only for a **public** group/topic room: a DM/AI chat has no room JID, and a private topic (or private group) omits both. The required private-topic test passes; a public group carries both. If a private *non-topic* group should also carry them, that is a one-line change — say so in review and I will adjust.
- Only messages with a body or a copied payload are sent; a message with neither is skipped rather than sending an empty forward.
- Duplicate target ids are deduplicated (one copy per target) to avoid a double send.
- The echo queue uses the same signature function the matching normal send uses and no extra suffix: the echo path only computes the sticker-scoped suffix, matching `sendSticker`.

### Open questions
- None blocking. The only interpretation call is the private-group room fields noted above.

## Review (written by Claude)

Approved (lead, 2026-10-06). forwardMessages queues one copy per message per target with a validated <forward> origin, marks only its own bubble failed on a send error, and dedups the echo by signature. The fix round added two things: the comment is sent only when at least one copy was queued, and author and base-text bookkeeping on each copy. Public-origin-only chat_id/chat_name follows Julio's decision. Nits accepted: the Report says 9 tests (there are 10), and it describes the comment gate as in the spec. 3 commits.
