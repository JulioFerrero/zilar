---
id: T-0427
title: "Forwarding receive side (mobile): keep the forward origin on incoming messages and show 'Forwarded from X [in Y]' in the bubble"
status: todo
milestone: M5
branch: task/T-0427-mobile-forwarded-header
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0427: forwarded header (mobile)

## Spec (written by Claude, do not edit)

### Why
Web shows a "Forwarded from" header since T-0409. Mobile gets the origin from xmpp-core but drops it, so a forwarded message looks like a normal one. This is the receive half of T-F in `docs/audit/forwarding-plan.md` §4.

### Verified facts (do not re-derive)
- **chat-core:** `UiMessage.forward?: ForwardOrigin` exists (`packages/chat-core/src/types.ts:64-65`). Mobile imports `UiMessage` from `@zilar/chat-core`.
- **xmpp-core:** `ChatMessage.forward?: ForwardOrigin` (`packages/xmpp-core/src/types.ts:62-65`). A bad `<forward>` is already dropped there.
- **`ForwardOrigin`** comes from `@zilar/protocol` (`packages/protocol/src/forward.ts`). Its fields include `sender_name` and an optional `chat_name`. `@zilar/protocol` is already a mobile dependency (`apps/mobile/package.json:21`).
- **Web reference:**
  - `apps/web/src/store/realStore.ts:2292-2293` copies `message.forward` into the UI message;
  - `apps/web/src/components/ForwardedHeader.tsx` builds the label as `Forwarded from ${sender_name}`, plus ` in ${chat_name}` when `chat_name` is defined, with the `Forward` icon, `text-[12px] italic text-muted-foreground`, truncated;
  - `apps/web/src/components/MessageBubble.tsx:355-359` and `:479-483` render it after the sender name and before the reply quote.
- **Mobile store:**
  - `apps/mobile/src/store/real-store.ts:2034` `toUiMessage(message, meId)` copies body, attachment, sticker, voice and replyTo, but not `forward`;
  - the voice copy ends at about line 2073, just before the `replyTo` block.
- **Mobile bubble `apps/mobile/src/components/chat/message-bubble.tsx`:**
  - `scheme` at line 257;
  - `ReplyQuote` imported at line 24;
  - the sticker branch shows the sender name at about lines 399-406, then `{message.replyTo ? <ReplyQuote … /> : null}` at about line 407;
  - the text bubble branch does the same at about lines 456-464.
- **Colours:** `MUTED_FOREGROUND` is a `Record<ColorScheme, string>` in `apps/mobile/src/lib/colors.ts:42`.
- **Tests:**
  - `apps/mobile/src/components/chat/message-bubble-layout.test.tsx:84-94` mocks `lucide-react-native` with string names; add `Forward: 'Forward'` there.
  - `apps/mobile/src/store/real-store.test.ts:16` has the `message(overrides)` helper; tests emit with `xmpp.emit('message', message({...}))` (e.g. line 872) and read `store.getState().messages(CHAT)`.
- **Mock data:** `apps/mobile/src/mock/messages.ts`. The `message(chatId, id, sender, createdAt, content)` helper at about line 25 takes `Content`, a `Pick` of `UiMessage` keys (line 23) that does not include `forward` yet. The `ana` chat is at about lines 80-101.

### What to build
1. **Store:** in `toUiMessage` (`real-store.ts`), after the voice copy, add `if (message.forward !== undefined) { ui.forward = message.forward; }`.
2. **New `apps/mobile/src/components/chat/forwarded-header.tsx`:**
   - export `ForwardedHeader({ origin }: { origin: ForwardOrigin })`;
   - render a row `<View className="mb-1 flex-row items-center gap-1">` with `<Forward size={13} color={MUTED_FOREGROUND[scheme]} />` (scheme from `asColorScheme(useColorScheme().colorScheme)` as in message-bubble) and `<Text numberOfLines={1} className="shrink text-[12px] italic text-muted-foreground">`;
   - use the same label rule as web.
3. **Bubble:** in both branches, render `{message.forward !== undefined ? <ForwardedHeader origin={message.forward} /> : null}` right before the `ReplyQuote` line.
4. **Mock:**
   - add `'forward'` to the `Content` Pick;
   - give `ana-12` (Ana, "I found that other place with the terrace") a forward: `{ sender_id: 'luis@zilar.test', sender_name: 'Luis', chat_id: 'viernes@conference.zilar.test', chat_name: 'Friday plans', original_at: '2026-08-30T18:00:00.000Z' }`;
   - parse the forward with `ForwardOriginSchema.parse(...)`, the same way `payload()` parses payloads.
5. **Tests:**
   - New `apps/mobile/src/components/chat/forwarded-header.test.tsx`: the label without `chat_name` is "Forwarded from Luis"; with it, the label is "Forwarded from Luis in Friday plans". Copy the mocks it needs from `message-bubble-layout.test.tsx`.
   - In `real-store.test.ts`: an incoming message with a `forward` keeps it on the UI message, and one without has no `forward` key.
   - In `message-bubble-layout.test.tsx`: add the `Forward` mock, and add one test that a message with a forward shows the header text.

### Read first
`AGENTS.md`, `apps/web/src/components/ForwardedHeader.tsx`, `apps/mobile/src/store/real-store.ts:2034-2092`, `apps/mobile/src/components/chat/message-bubble.tsx:250-260` and `:395-470`, `apps/mobile/src/mock/messages.ts:1-60`, and the two tests named above.

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.test.ts`, `apps/mobile/src/components/chat/forwarded-header.tsx`, `apps/mobile/src/components/chat/forwarded-header.test.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `apps/mobile/src/mock/messages.ts`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx` (the `Forward` mock only), `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx` (the `Forward` mock only), `work/T-0427-mobile-forwarded-header.md`.

`ForwardOriginSchema` is exported from `@zilar/protocol` (`packages/protocol/src/index.ts:9`). If any other test breaks through an import, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot forwarded-header message-bubble-layout real-store.test
pnpm gate
```

### Acceptance
- An incoming forwarded message on mobile shows "Forwarded from X" or "Forwarded from X in Y" with the Forward icon, above the reply quote, in text bubbles and stickers.
- The mock `ana` chat shows one forwarded message.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
