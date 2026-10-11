---
id: T-1149
title: "Typing: a received message clears that chat's typing line at once, and the sender sends 'paused' on send or when the composer empties (web + mobile); web chat list: the unread badge and ticks sit flush right (the hidden ⋯ button no longer takes space)"
status: merged
milestone: M5
branch: task/T-1149-typing-stop-and-badge
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1149: Typing stops on time; badge flush right

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11:
- "I just sent a message, the other person received it and I still see typing when it's not true."
- "The number counter of unread messages is not aligned all the way to the right." His screenshot shows the badge about 30 px left of the time above it.

**What the lead read:**
- **The receiver:** `handleTyping` (`packages/client-core/src/store/incoming.ts:175-205`) sets `typing[chatId]` on `composing` and clears it after `TYPING_CLEAR_MS = 5000` (`:21-22`). It clears at once on `paused` or `active`. `handleMessage` (`:100-172`) **never clears** the chat's typing line when that person's message arrives, so the line outlives the message by up to 5 s, or more when another composing arrives.
- **The sender:**
  - The web composer sends `composing` at most every 2 s while there's text (`apps/web/src/components/composer/useMentions.ts:95-99`) and **never sends `paused`**.
  - Mobile calls `onTyping`, then `sendTyping(chat.id)` (`apps/mobile/src/components/chat/chat-composer-dock.tsx:158`, `:173`).
  - Core `sendTyping` sends only `'composing'` (`packages/client-core/src/store/actions.ts:174-179`).
  - xmpp-core already accepts `'paused'` (`packages/xmpp-core/src/core-effect/operations.ts:92`).
- **The badge:** in `apps/web/src/components/ChatListItem.tsx:127-174` the second row is `preview · Badge (ml-auto) · ⋯ Button`. The ⋯ button (`:157-172`, `size-6 … opacity-0 group-hover:opacity-100`) is invisible but still takes 24 px plus the gap, so the badge (`:144-150`) and the ticks (`:154`) never reach the right edge, while the time above (`:116-125`) does.

### What to build
1. **The core receiver:** in `handleMessage`, for a non-outgoing message (after the reaction-only return, `:112-117`), cancel the chat's typing fiber (`ctx.rt.cancel(typingKey(chatId))`) and call `clearTyping(ctx, chatId)`. Do this before the state update, so the message and the cleared line land together. `incoming.ts` stays at most 400 lines.
2. **The core sender:** add `stopTyping(ctx, chatId)` to `actions.ts`, next to `sendTyping`. It sends `'paused'` through `ctx.core.sendTyping`.
3. **Web:**
   - add `stopTyping: (chatId: string) => void` to the store interface (`apps/web/src/store/store.ts`, next to `sendTyping` at `:317`), and wire it in `apps/web/src/store/effects/chatActions.ts` like `sendTyping` (`:162-163`);
   - in `useMentions.ts`, call it when the text becomes empty (`next.trim().length === 0`, only when a composing was sent since the last stop) and right after a send. Find where the composer clears after a send, list it in the Report, and reset `lastTypingRef` there so the next keystroke sends composing at once.
4. **Mobile:** the same. Add `stopTyping` to `apps/mobile/src/store/types.ts` (next to `sendTyping`, `:148`), wire it in `apps/mobile/src/store/effects/send.ts` (next to `:109`), and call it from `chat-composer-dock.tsx` on send and when the text becomes empty. If the composer component (`apps/mobile/src/components/chat/composer.tsx`) has to report "text became empty", add an optional `onStopTyping` prop to it.
5. **The badge** (`ChatListItem.tsx`):
   - take the ⋯ button out of the flow: position it absolutely at the right of the row's second line (`absolute right-… `, with the row wrapper `relative`);
   - it shows only on hover or focus, as today;
   - on hover it covers the badge or ticks, with the row's hover background behind it, so the two never overlap visibly;
   - at rest the badge and ticks end exactly at the same right edge as the time above;
   - keep the keyboard focus behaviour (focus-visible shows it). The file stays at most 400 lines.
6. **Test** (the message pipeline), one test in `packages/client-core/src/store/incoming.test.ts`, following the existing `handleTyping (core)` tests (`:130`): a composing event from ANA, then an incoming message from ANA in the same chat, gives `typing[chat]` undefined immediately, with no timer advance.

### Read first
`AGENTS.md`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/actions.ts:160-180`, `packages/client-core/src/store/incoming.test.ts:120-170`, `apps/web/src/components/composer/useMentions.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/mobile/src/components/chat/chat-composer-dock.tsx` and `apps/mobile/src/components/chat/composer.tsx`.

### Allowed files
`packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/actions.ts`, `packages/client-core/src/store/incoming.test.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/components/composer/useMentions.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/components/chat/chat-composer-dock.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `work/T-1149-typing-stop-and-badge.md`.

If the send-clear point is in another composer file, stop and say which; don't edit it.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on the live web:**
  - while one account types and sends, the other account's "typing…" disappears the moment the message shows;
  - deleting all typed text clears it within a second;
  - in the chat list, the unread badge ends at the same right edge as the time.

---

## Report (written by the worker when done)

### What I did

**Core receiver (item 1).** In `handleMessage` (`packages/client-core/src/store/incoming.ts`), after the reaction-only return and the outgoing-echo branch, a non-outgoing message now cancels the chat's typing fiber (`ctx.rt.cancel(typingKey(chatId))`) and calls `clearTyping(ctx, chatId)` before the state update, so the message and the cleared line land in the same update. `incoming.ts` is 255 lines.

**Core sender (item 2).** Added `stopTyping(ctx, chatId)` to `packages/client-core/src/store/actions.ts`, next to `sendTyping`, sending `'paused'` through `ctx.core.sendTyping(chatId, coreKind(chat), 'paused')`.

**Web (item 3).** Added `stopTyping: (chatId: string) => void` to the `ChatStore` interface (`apps/web/src/store/store.ts`), wired it in `apps/web/src/store/effects/chatActions.ts` (import, `ChatActions` Pick, method) exactly like `sendTyping`. In `apps/web/src/components/composer/useMentions.ts` I added a `typingChatRef` (the chat a composing was last sent for) and a `stopTypingNow` callback that sends one `paused` for that chat and resets `lastTypingRef` to 0. `onChange` now calls it when the text becomes empty (only when a composing was sent), and a new effect on `value` calls it when the text empties.

**Web send-clear point (reported, not edited).** The composer's send-clear point is `apps/web/src/components/Composer.tsx` — `send()` (`setValue('')` at `:267`, `:280`, and `:291` for the edit-leave path) and `useComposerAttachments`. That file is **not in my Allowed files**, so I did not edit it. `useMentions` receives that same `value` state as a prop, so the value-watching effect covers the send case: when a send clears the composer the text goes empty, the effect sends `paused` and resets `lastTypingRef`, so the next keystroke composes at once. No change to `Composer.tsx` was needed.

**Mobile (item 4).** Added `stopTyping` to `apps/mobile/src/store/types.ts` next to `sendTyping`, wired it in `apps/mobile/src/store/effects/send.ts` (import from `@zilar/client-core/store`, `Send` Pick, `stopTyping: (chatId) => stopTyping(ctx.coreCtx, chatId)`). `chat-composer-dock.tsx` selects `stopTyping`, calls it in `sendTextNow` (so text, sticker, attachment and voice sends stop the line) and passes `onStopTyping={() => stopTyping(chat.id)}` to `Composer`. In `composer.tsx` I added the optional `onStopTyping` prop, a `typingActiveRef` set by a wrapped `onTyping`, and an effect on `text` that calls `onStopTyping` when the text empties; `handleSend` clears the flag before `setText('')` so the dock's paused stanza is not doubled.

**Badge (item 5).** In `apps/web/src/components/ChatListItem.tsx` the second line is now `relative`, the `⋯` button is absolutely positioned (`absolute top-1/2 right-0 -translate-y-1/2`) with `bg-surface-raised` so on hover it covers the badge/ticks over the row's hover background, and it keeps `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`. Removed from flow, the badge (`ml-auto`) and the ticks now end at the same right edge as the time above. The file is 181 lines.

**Test (item 6).** Added to `packages/client-core/src/store/incoming.test.ts`, in the `handleTyping (core)` block: a `composing` from ANA in `ANA`'s chat, then an incoming `message({ id: 'ana-1' })` from ANA; asserts `typing[ANA]` is undefined and `rt.has('typing:ana@zilar.test')` is false, with no timer advance.

### Files changed
- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/actions.ts`
- `packages/client-core/src/store/incoming.test.ts`
- `apps/web/src/store/store.ts`
- `apps/web/src/store/effects/chatActions.ts`
- `apps/web/src/components/composer/useMentions.ts`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/mobile/src/store/types.ts`
- `apps/mobile/src/store/effects/send.ts`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `work/T-1149-typing-stop-and-badge.md`

### Commands run (real results)
- `pnpm install` → Done (9.7s).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` → Test Files 1 passed (1), Tests 16 passed (16) (includes the new test; the file had 15 before).
- `pnpm gate` (repo root) →
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/client-core  (1.3s)
  PASS  tests @zilar/mobile  (2.9s)
  PASS  tests @zilar/web  (4.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The web send-clear point is in `apps/web/src/components/Composer.tsx`, which is outside the Allowed files; I did not edit it (see the Web send-clear point section above). The spec's "reset `lastTypingRef` there" is instead done inside `useMentions.ts`, which owns `lastTypingRef`, via the `value` effect.
- The mobile channel feed bar (`channel-composer-bar.tsx`, not in the Allowed files) gets stop-on-send through the shared `sendTextNow`, but it does not report "text became empty", so emptying a channel draft clears the line only after the receiver's `TYPING_CLEAR_MS` (5 s). The main chat composer is fully covered.
- No dependency added; no `any` / `@ts-ignore`.
- All touched files are at most 400 lines (largest: `apps/web/src/store/store.ts` at 394).

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 3 nits and 1 follow-up.**
- **Receiving:** `handleMessage` cancels the chat's typing fiber and clears the line when a peer's message arrives. The new test passes in the branch (16 of 16, run by the lead).
- **Sending:** core `stopTyping` sends `paused`. Web and mobile call it on send and when the text empties.
- **The badge:** the ⋯ button is absolute at the right, with the row's hover colour (`surface-raised`) behind it, so the badge and ticks end at the time's edge.
- **Accepted nits:**
  - in a group, any message clears the single typer line (the store keeps one typer per chat);
  - mobile's `typingActiveRef` isn't chat-scoped, which can give a stray `paused`. Harmless.
- **Still to do:** the live check after the deploy.
