---
id: T-1195
title: "WUX-9/13/15: web asks before Sign out and 'Archive topic for everyone'; a reply quote is clickable and jumps to (and flashes) the quoted message, loading it if needed; the sign-in email field and the first code box get focus"
status: merged
milestone: M5
branch: task/T-1195-web-confirm-quote-focus
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1195: Confirmations, clickable quotes, sign-in focus

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-9, WUX-13 and WUX-15 (P2, confirmed).
- **WUX-9, no confirmation:** Sign out runs on click (`apps/web/src/components/chatList/ChatListMenu.tsx:160`), and so does "Archive topic for everyone" (`apps/web/src/components/ChatHeader.tsx:246-253,327-334`). `ConfirmDialog` exists: `apps/web/src/components/ConfirmDialog.tsx`.
- **WUX-13, the quote isn't clickable:** `apps/web/src/components/ReplyQuote.tsx` (17 lines) has no click handler. It's used at `apps/web/src/components/MessageBubble.tsx:241,315`.
  - `scrollToMessage(messageId)` is in `apps/web/src/lib/scrollToMessage.ts:4` and returns a boolean;
  - the store has `openAtMessage(chatId, messageId)` (`apps/web/src/store/store.ts:257`) to load around a message;
  - the existing jump users: `MessageSearchResults.tsx:25`, `PinnedBanner.tsx:46`.
- **WUX-15, no sign-in focus:** there's no autofocus on the email field (`apps/web/src/components/auth/AuthFlow.tsx:198-206`) nor on the first code box after the step change (`apps/web/src/components/auth/OtpInput.tsx:76-98`).

### What to build
1. **WUX-9:** show a `ConfirmDialog` before Sign out ("Sign out of Zilar in this browser?") and before "Archive topic for everyone" ("Archive this topic for everyone? Members can't post until it's restored.", or the wording the restore flow supports; check it). Cancel does nothing.
2. **WUX-13:**
   - `ReplyQuote` takes an optional `onOpen`, and renders as a `button` (keyboard reachable) when it's given;
   - `MessageBubble` passes `onOpen`, which calls `scrollToMessage(quote.id)`. If that returns false, call `openAtMessage(chatId, quote.id)`, then scroll. Copy the pinned banner's flow (`PinnedBanner.tsx:40-55`) and cite it;
   - flash the target the same way search hits do, if they flash.
3. **WUX-15:** `autoFocus` on the email `TextInput` in `AuthFlow.tsx`; in `OtpInput.tsx`, focus `refs.current[0]` in a mount effect.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-9, WUX-13, WUX-15), `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/ChatHeader.tsx:230-336`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ReplyQuote.tsx`, `apps/web/src/components/MessageBubble.tsx:230-320`, `apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/lib/scrollToMessage.ts`, `apps/web/src/components/auth/AuthFlow.tsx:190-210` and `apps/web/src/components/auth/OtpInput.tsx`.

### Allowed files
`apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/chatList/ChatList.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ReplyQuote.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/OtpInput.tsx`, `work/T-1195-web-confirm-quote-focus.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web:**
  - Sign out asks first (cancelling keeps you signed in);
  - clicking a reply quote jumps to the original.

---

## Report (written by the worker when done)

**What I did**

- **WUX-9, confirmations**
  - `apps/web/src/components/ChatList.tsx`: Sign out from the main menu now opens a `ConfirmDialog` ("Sign out of Zilar in this browser?" / "You'll need to sign in again to chat.", confirm "Sign out"). Only the confirm calls `signOut()`; Cancel just closes it.
  - `apps/web/src/components/ChatHeader.tsx`: "Archive topic for everyone" now opens a `ConfirmDialog`. Confirm runs the existing `runArchive()`; Cancel does nothing.
- **WUX-13, clickable quote**
  - `apps/web/src/components/ReplyQuote.tsx` takes an optional `onOpen`. With it, the quote renders as a `<button>` (keyboard reachable, focus ring, `aria-label`); without it, the old `<div>`.
  - `apps/web/src/components/MessageBubble.tsx` passes `onOpen` at both quote sites (sticker and normal bubble). The handler is a `useAction` over `fromApi(() => openAtMessage(chatId, messageId))` with `Effect.tap(... Effect.sync(() => requestAnimationFrame(...)))`, the pinned banner's flow (`PinnedBanner.tsx:40-55`, cited in the comment): `scrollToMessage` first, and only when it returns false, load around the message and scroll once it lands.
- **WUX-15, sign-in focus**
  - `apps/web/src/components/auth/AuthFlow.tsx`: `autoFocus` on the email `TextInput`.
  - `apps/web/src/components/auth/OtpInput.tsx`: a mount effect focuses `refs.current[0]`.

**Files changed** (all inside Allowed files): `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ReplyQuote.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/OtpInput.tsx`, and this task file.

**Deviations from the spec**

- **Archive wording.** The spec suggested "Members can't post until it's restored." There is no restore flow to check: the web `PatchTopicInput.archived` is `true` only (`apps/web/src/lib/api/topics.ts:64`), the server only sets `archivedAt` and then rejects further changes (`apps/server/src/topics/service.ts:206,263`), and no web/mobile/server restore exists. I used the existing, accurate wording from `TopicPanel.tsx:232-240`: title ``Archive “<topic>” for everyone?``, body "The topic disappears from the list for everyone. Its history stays on the server."
- **Flash.** The spec said to flash the target "if they flash". Neither search hits (`MessageSearchResults.tsx:25`) nor the pinned banner (`PinnedBanner.tsx:46`) flash, so nothing was added.

**Commands and their results**

- `pnpm install` — done, 11.6 s, "Done". (Pre-existing peer warning only: `apps/mobile` `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18.)
- I ran `pnpm exec prettier --write` on the touched source files so the gate's format check passes (all reported "unchanged").
- `pnpm gate` — **GATE PASS** (7 changed files against main; all inside the Allowed files):

```text
PASS  install (frozen)  (1.2s)
PASS  format  (1.7s)
PASS  lint  (1.1s)
PASS  typecheck  (5.0s)
PASS  effect  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Tests**: none written, per the spec ("No tests (UI)"). `apps/web` has no test files next to the changed components, so the gate's nearest-tests step skips it.

**Open questions**: none.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **WUX-9:** a `ConfirmDialog` before Sign out and before "Archive topic for everyone".
- **WUX-13:**
  - `ReplyQuote` is a button when it has `onOpen`;
  - the bubble scrolls to the quoted message, or loads around it with `openAtMessage` and then scrolls.
- **WUX-15:** autofocus on the email field and on the first code box.
- **Nits, accepted:**
  - in select mode, a quote click also toggles the selection;
  - a failed quote load is silent.
- **Still to do:** the lead's check on the mock build. Sign out isn't tested on Julio's real session.
