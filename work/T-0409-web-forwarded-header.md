---
id: T-0409
title: "Forwarding step 2 (web): received forwards keep their origin and the bubble shows a 'Forwarded from …' header"
status: todo
milestone: M5
branch: task/T-0409-web-forwarded-header
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0409: show forwarded messages on web

## Spec (written by Claude, do not edit)

### Why
Julio approved the forwarding plan on 2026-10-06 (`docs/audit/forwarding-plan.md` §5: every recommendation accepted). T-0261 put the `<forward>` element on the wire: xmpp-core already decodes it into `ChatMessage.forward`. Web drops that field today, so a forwarded message looks like a normal one. This task covers the receive side and the header only. The send action is the next task.

### Verified facts (do not re-derive)
- **`packages/protocol/src/forward.ts`:**
  - `ForwardOriginSchema` (line 11) has the fields `sender_id`, `sender_name` (max 120), optional `chat_id`/`chat_name` (both or neither; only for a public origin), optional `original_id`, and `original_at` (ISO datetime);
  - `ForwardOrigin` is the type (line 30).
- **`packages/xmpp-core/src/types.ts`:**
  - line 65: `ChatMessage.forward?: ForwardOrigin`;
  - lines 62-63: a malformed element is dropped, so the field is absent.
- **`packages/chat-core/src/types.ts:55`:** `export interface UiMessage` (the fields `id`, `chatId`, `senderId`, `senderName`, `text?`, `createdAt`, `status`, …). It has no forward field. `packages/chat-core/package.json` depends on `@zilar/protocol`.
- **`apps/web/src/store/realStore.ts:2257`:** `toUiMessage(message: ChatMessage, meId)` builds the `UiMessage` field by field (`text`, `replyTo`, `mentions`, `voice`, `attachment`, …). It does not read `forward`.
- **`apps/web/src/components/MessageBubble.tsx`:** the reply quote renders in two layouts:
  - lines 354-358: sticker layout, `<div className="mb-1 w-full max-w-[200px]"><ReplyQuote …/></div>`;
  - lines 473-477: text layout, `<div className="px-3 pt-2"><ReplyQuote …/></div>`;
  - in both, the sender name row (`showSender`) comes just before.
- **Mock data:** `apps/web/src/mock/messages.ts` holds the mock messages, some with `replyTo: {`.

### What to build
1. **chat-core:** add `forward?: ForwardOrigin` to `UiMessage`, importing the type from `@zilar/protocol`, with a one-line doc comment. Add a type test or a field case only if the package has a types test.
2. **realStore:** in `toUiMessage`, copy `message.forward` to `ui.forward` when present.
3. **New component `apps/web/src/components/ForwardedHeader.tsx`:**
   - it renders a muted line with a lucide `Forward` icon (`size-3.5`, `aria-hidden`) and the text `Forwarded from {sender_name}`;
   - when `chat_name` is present, it renders `Forwarded from {sender_name} in {chat_name}`;
   - classes: `flex items-center gap-1 text-[12px] italic text-muted-foreground`;
   - plain text only, with no link.
4. **MessageBubble:** render `<ForwardedHeader origin={message.forward} />` when `message.forward !== undefined`, just above the reply-quote position in both layouts:
   - text layout: wrapped in `px-3 pt-2`;
   - sticker layout: wrapped in `mb-1`.
5. **Mock:** add `forward` to one existing incoming text message in `apps/web/src/mock/messages.ts`, with a sender name and a public `chat_name`, so it can be seen in `?mock=1`.
6. **Tests:** create `apps/web/src/components/MessageBubble.forward.test.tsx`, using the render setup from `MessageList.test.tsx`. It checks that:
   - the header shows the sender name;
   - "in {chat}" appears only when `chat_name` is set;
   - a message without `forward` has no header.

   Add one case to `apps/web/src/store/realStore.test.tsx`, following its existing incoming-message cases, showing that an incoming `ChatMessage` with `forward` yields a `UiMessage` with the same `forward`.

### Read first
`AGENTS.md`, `packages/protocol/src/forward.ts`, `docs/audit/forwarding-plan.md` §3.3 ("What the receiver shows"), `packages/protocol/src/forward.ts`, `packages/chat-core/src/types.ts:55-100`, `apps/web/src/store/realStore.ts:2257-2330`, `apps/web/src/components/MessageBubble.tsx:330-480`, and `apps/web/src/components/MessageList.test.tsx`. There is no dedicated MessageBubble test; MessageList.test renders bubbles, so copy its setup for the new file. `ForwardOrigin` is exported from the protocol package (`packages/protocol/src/index.ts` has `export * from './forward'`).

### Allowed files
`packages/chat-core/src/types.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/ForwardedHeader.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageBubble.forward.test.tsx`, `apps/web/src/mock/messages.ts`, `work/T-0409-web-forwarded-header.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot MessageBubble.forward realStore.test
pnpm gate
```

### Acceptance
- An incoming forward shows "Forwarded from …" above its content on web.
- Normal messages are unchanged.
- The mock shows one forward.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
