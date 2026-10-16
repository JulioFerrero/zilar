---
id: T-1674
title: "Size split of the phone message-bubble.tsx (392 lines): move the live-reveal block (smooth text, generating, the swap animation) into a use-bubble-reveal hook; and wrap the sticker bubble in MessageMenuProvider so a long hold on a sticker's reply quote opens the menu (T-1667 follow-up)"
status: merged
milestone: M5
branch: task/T-1674-split-message-bubble
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1674: Split the phone message bubble, and fix the sticker quote's long hold

## Spec (written by Claude, do not edit)

### Why
- **`apps/mobile/src/components/chat/message-bubble.tsx` is 392 of 400 lines.** The live-reveal block is self-contained and can move into a hook.
- **T-1667's pre-review found a corner case.** A reply quote inside a **sticker** bubble sits outside the bubble's `MessageMenuProvider`, so a long hold on that quote doesn't open the menu: T-1667 made the quote a `Pressable` that forwards its long hold through `useOpenMessageMenu()`.

### Facts (the lead read them on 2026-10-16, main after T-1669)
- **`message-bubble.tsx`:** `function MessageBubbleImpl({…})` (`:40-391`) and `export const MessageBubble = memo(MessageBubbleImpl)` (`:392`).
  - **The reveal block** (`:113-143`): `beyondDraft`, `animate`, `const { text, done } = useSmoothText(message.text ?? '', { animate, initial: 'full', reducedMotion: reduceMotion, active: appActiveSource })`, `generating`, `everLive` (with its comment), `textColor`, `const [swap] = useState(() => new Animated.Value(…))`, `wasGenerating` and the `useEffect` that animates `swap` with `SWAP_MS`.
  - **The bubble body** is wrapped in `<MessageMenuProvider openMenu={generating ? undefined : openMenu}>` (`:190-213`).
  - **The sticker branch** `<StickerBubble … onLongPress={openMenu} />` (`:225-233`) is not inside any `MessageMenuProvider`.
- **`MessageMenuProvider`** is in `apps/mobile/src/components/chat/message-menu-context.tsx`.
- **The folder `apps/mobile/src/components/chat/`** has `message-bubble-actions.tsx`, `message-bubble-content.tsx`, `message-bubble-decor.tsx` and `message-bubble-tombstone.tsx`. There's no `use-bubble-reveal.ts`.

### Steps
1. **Create `apps/mobile/src/components/chat/use-bubble-reveal.ts`:** `export function useBubbleReveal(input: { message: UiMessage; outgoing: boolean; draft: boolean; revealTurnId: string | undefined; reduceMotion: boolean; appActiveSource: … })` returning `{ text, generating, everLive, textColor, swap }`.
   - Move the block word for word, with its comments.
   - Take the exact parameter types and constants (`SWAP_MS`, `GENERATING_FOREGROUND`, `appActiveSource`'s type) from the current file and its imports; `beyondDraft` and `animate` stay internal to the hook.
   - `hasText` stays in the bubble if the bubble still uses it.
2. **In `message-bubble.tsx`:** call the hook in place of the block, and drop imports that are no longer used. **No behaviour change.**
3. **Wrap the sticker branch's `<StickerBubble … />` in `<MessageMenuProvider openMenu={openMenu}>`**, the same as the body path.
4. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/use-bubble-reveal.ts`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `work/T-1674-split-message-bubble.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`message-bubble.tsx` is 370 lines or fewer;** the AI reveal looks and animates as before.
- **A long hold on a sticker's reply quote opens the message menu.**

---

## Report (written by the worker when done)

### What I did

- **Created `apps/mobile/src/components/chat/use-bubble-reveal.ts`** (56 lines) with `useBubbleReveal(input)` returning `{ text, generating, everLive, textColor, swap }`. Moved the live-reveal block (`beyondDraft`, `animate`, `useSmoothText`, `generating`, `everLive` with its comment, `textColor`, the `swap` `Animated.Value`, `wasGenerating` + its `useEffect`) word for word, comments included. `beyondDraft` and `animate` stay internal to the hook; it imports only the `ActiveSource` type plus `SWAP_MS` and `GENERATING_FOREGROUND`.
- **`message-bubble.tsx`** (365 lines, was 392): replaced the block with a `useBubbleReveal({ message, outgoing, draft, revealTurnId, reduceMotion, appActiveSource })` call. Dropped the imports that became unused: `useEffect`, `useRef`, `SWAP_MS`, `GENERATING_FOREGROUND`, `useSmoothText`. Kept `appActiveSource` (now passed to the hook), `Animated`, `StyleSheet`, `LONG_PRESS_MS` and `hasText` in the bubble. No behaviour change.
- **Sticker long hold:** wrapped the sticker branch's `<StickerBubble … />` in `<MessageMenuProvider openMenu={openMenu}>`, the same as the body path, so the sticker's `ReplyQuote` (which forwards its long hold through `useOpenMessageMenu()`) now reaches the menu.

Changed files: `apps/mobile/src/components/chat/use-bubble-reveal.ts` (new), `apps/mobile/src/components/chat/message-bubble.tsx`, `work/T-1674-split-message-bubble.md`.

### Checks run

- `pnpm install`: `Done in 14.9s using pnpm v10.32.1`.
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.0s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file was run: the change is UI only and the task says "No tests (UI)". The gate ran the `@zilar/mobile` tests.
- Line counts: `message-bubble.tsx` 365 lines (acceptance was ≤ 370), `use-bubble-reveal.ts` 56 lines.

### Notes for the lead

- The hook takes `appActiveSource` as an input (type `ActiveSource`) exactly as the spec signature asked, so the bubble still imports that constant from `message-bubble-decor`.
- The sticker provider uses `openMenu={openMenu}` (not `generating ? undefined : openMenu`) exactly as step 3 says; stickers never generate, so this matches the body path's behaviour.
- I could not exercise the long hold or the swap animation by hand (UI); the gate and typecheck are green and the logic is unchanged apart from the provider wrap.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the reveal block in `use-bubble-reveal.ts` matches the removed lines word for word (diff after stripping indentation and imports); only the hook signature and its `return` are new.
- **Result:** `message-bubble.tsx` drops from 392 to 365 lines. The sticker branch is now inside `MessageMenuProvider`, which closes T-1667's follow-up.
- **Still to check:** the emulator check (the AI reveal and the long hold on a sticker's quote) is in the next phone QA pass.
