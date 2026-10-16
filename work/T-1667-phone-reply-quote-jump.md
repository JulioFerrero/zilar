---
id: T-1667
title: "Phone: tapping a reply quote jumps to the quoted message, like web (parity audit gap 3, second half) — a small chat-jump context from chat-thread, a Pressable quote that forwards long-press to the bubble menu, off in select mode"
status: merged
milestone: M5
branch: task/T-1667-phone-reply-quote-jump
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1667: Tap a reply quote to jump on the phone

## Spec (written by Claude, do not edit)

### Why
On web, clicking a reply quote scrolls to the quoted message. On the phone, the quote is plain text (`docs/audit/parity-2026-10-16.md`, gap 3). The phone already has an in-chat jump (`screen.jumpTo`), used by pins.

### Facts (the lead read them on 2026-10-16, main after T-1664)
- **Web:** `apps/web/src/components/ReplyQuote.tsx:47-54`. With `onOpen`, the quote is a `<button>` with `aria-label={`Go to the message from ${content.senderName}`}` that jumps to the quoted message.
- **`apps/mobile/src/components/chat/reply-quote.tsx`** (42 lines): `ReplyQuote({ message })`; `message.replyTo.id` is the quoted id. It renders a `View` (`:29-40`).
  - It's used in `apps/mobile/src/components/chat/message-bubble-content.tsx:167` and `:284`.
- **`apps/mobile/src/components/chat/use-chat-screen.ts`:**
  - `jumpTo(messageId)` (`:181-189`) sets `jumpToMessageId` when the message is loaded, else `jumpError` "Message not found";
  - it's returned as `screen.jumpTo` (`:275`);
  - `screen.selectedIds` is non-empty in select mode.
- **`apps/mobile/src/components/chat/chat-thread.tsx`:** `ChatThread({ screen, chat })` renders `<MessageList chat={chat} …>` (`:161-…`).
- **The pattern to copy** is `apps/mobile/src/components/chat/message-menu-context.tsx` (28 lines):
  - a `createContext` plus a provider plus a hook;
  - inner `Pressable`s read `useOpenMessageMenu()` and pass it as their `onLongPress`, so a long hold on them still opens the bubble menu (T-1275).
- **`apps/mobile/src/components/chat/message-bubble.tsx`** is 392 lines; **don't touch it.**

### Steps
1. **Add `apps/mobile/src/components/chat/chat-jump-context.tsx`,** in the same shape as `message-menu-context.tsx`: `ChatJumpProvider({ jumpTo, children })` (with `jumpTo: ((messageId: string) => void) | undefined`) and `useChatJump()`.
2. **In `chat-thread.tsx`:** wrap the `MessageList` in `<ChatJumpProvider jumpTo={screen.selectedIds.length > 0 ? undefined : screen.jumpTo}>`, so select mode keeps taps for selecting.
3. **In `reply-quote.tsx`:** when `useChatJump()` is defined, render the quote as a `Pressable`:
   - `accessibilityRole="button"`;
   - `accessibilityLabel={`Go to the message from ${content.senderName}`}` (web's label);
   - `onPress={() => jump(reply.id)}`;
   - `onLongPress={useOpenMessageMenu()}`.

   Otherwise render the plain `View` as today. Keep the look identical.
4. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/chat-jump-context.tsx`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/reply-quote.tsx`
- `work/T-1667-phone-reply-quote-jump.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Tapping a reply quote scrolls to the quoted message** (or shows "Message not found" when it isn't loaded).
- **A long hold on the quote still opens the message menu;** select mode is unchanged.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/components/chat/chat-jump-context.tsx`: a `createContext`/provider/hook trio in the same shape as `message-menu-context.tsx` — `ChatJumpProvider({ jumpTo, children })` (`jumpTo: ((messageId: string) => void) | undefined`) and `useChatJump()`.
- In `chat-thread.tsx`: wrapped the `MessageList` in `<ChatJumpProvider jumpTo={screen.selectedIds.length > 0 ? undefined : screen.jumpTo}>`, so select mode keeps taps for selecting.
- In `reply-quote.tsx`: read `useChatJump()` and `useOpenMessageMenu()`. When a jump is in scope the quote renders as a `Pressable` with `accessibilityRole="button"`, `accessibilityLabel={`Go to the message from ${content.senderName}`}` (web's label), `onPress={() => jump(reply.id)}` and `onLongPress={openMenu}`. When no jump is in scope it renders the plain `View` exactly as before. The inner bar/name/excerpt markup is unchanged and shared between both branches, so the look is identical.

### Checks run
- `pnpm install` — done (15.2s), no changes to lockfile.
- No single test files: the spec says "No tests (UI)", so I ran none in isolation.
- `pnpm gate` from the repo root — full output summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (1.4s)
  PASS  lint  (1.4s)
  PASS  typecheck  (7.4s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/mobile  (3.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- `ReplyQuote` is rendered inside the bubble's `MessageMenuProvider` (`message-bubble.tsx:191-213`), so `useOpenMessageMenu()` resolves to the enclosing bubble's open-menu function and a long hold on the quote opens the menu, matching the photo-tile pattern.
- I did not touch `message-bubble.tsx`, `message-bubble-content.tsx`, `use-chat-screen.ts` or anything else outside Allowed files.
- UI only, so no automated test was added per the spec; the tap/long-hold behaviour needs the lead's phone smoke to confirm on device.
- Pre-review nit 2: the quote's `Pressable` now sets `delayLongPress={LONG_PRESS_MS}` (imported from `message-bubble-decor`), matching the sibling inner Pressables in `media-bubble.tsx`, `album-grid.tsx` and `attachment-message.tsx`.

### Files changed
- `apps/mobile/src/components/chat/chat-jump-context.tsx` (new)
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/reply-quote.tsx`
- `work/T-1667-phone-reply-quote-jump.md`

## Review (written by Claude)

**Approved and merged.** This is parity gap 3, second half.

- **Pre-review:** clean; 1 nit, fixed in one round.
- **The change:**
  - `ChatJumpProvider` from `chat-thread` gives the quote `screen.jumpTo`, or nothing in select mode;
  - the quote is a `Pressable` with web's label, and it forwards a long hold to the bubble menu with the shared `LONG_PRESS_MS`.
  - The nit fixed: the shared `LONG_PRESS_MS` delay (`delayLongPress`).
- **Emulator QA** (mock build of main, 2026-10-16): with the quoted message off-screen, a tap on the quote scrolled to it, and a long hold on the quote opened the message menu.
- **Follow-up, recorded:** a reply quote inside a **sticker** bubble sits outside `MessageMenuProvider` (`message-bubble.tsx:224-233`), so a long hold there doesn't open the menu. It's a corner case for `message-bubble.tsx`'s next split.
- **Lead slip:** this Review missed T-1667's own commit (the edit failed on a changed file), so it rides T-1668's review commit.
