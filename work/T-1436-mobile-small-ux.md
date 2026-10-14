---
id: T-1436
title: "Mobile small UX fixes from the findings sweep: search clear hit target (MUX-17), font scaling caps and flexible rows (MUX-18), keyboard-safe auth screens (MUX-20), haptics on send and quick reactions (MUX-22), plain copy (MUX-26)"
status: merged
milestone: M5
branch: task/T-1436-mobile-small-ux
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1436: Mobile small UX fixes

## Spec (written by Claude, do not edit)

### Why
The findings sweep (T-1433, `docs/audit/findings-sweep-client.md` on branch `task/T-1433-sweep-client-findings`) left these partly or fully open on main. Each finding's full text is in `docs/audit/mobile-ux-audit.md`. Recheck each item before changing it, and report any you find already done.

### Facts (the lead read them on main, 2026-10-15)
- **MUX-17:** the clear button of `apps/mobile/src/components/ui/search-field.tsx` (56 lines) is a bare 16 px `Pressable` with no `hitSlop`. The other targets are done: send `hitSlop={8}`, quick reactions 44 dp.
- **MUX-18:**
  - `apps/mobile/src/components/ui/text.tsx` sets no `maxFontSizeMultiplier` (no hit anywhere in `apps/mobile/src`);
  - fixed heights cut scaled text: chat rows `h-[76px]` (`apps/mobile/src/components/chat/chat-list-item.tsx`, about `:91`) and the header `h-16` (`apps/mobile/src/components/chat/chat-header.tsx`, about `:145`).
- **MUX-20:** `apps/mobile/src/auth/AuthFlow.tsx:151`, `apps/mobile/src/auth/NameForm.tsx:62` and `apps/mobile/src/app/welcome/handle.tsx:138` each center a card in `SafeAreaView className="flex-1 items-center justify-center p-4"` with no keyboard avoidance, so the keyboard covers the field and the button on small phones.
- **MUX-22:** `apps/mobile/src/components/chat/haptics.ts` exports `tap()`, a light impact used on long-presses. Send (`apps/mobile/src/components/chat/composer-input-row.tsx`, `onSend`) and the quick-reaction buttons (`apps/mobile/src/components/chat/message-actions-sheet.tsx`) have none.
- **MUX-26:** the leftover copy is "Muted: change" (`apps/mobile/src/components/chat/chat-actions-sheet.tsx`, about `:148`) and a bare "Chat not found" (`apps/mobile/src/app/chat/[id].tsx`, about `:45`).

### What to build
1. **MUX-17:** give the search clear button `hitSlop={12}` and an `accessibilityLabel="Clear search"`.
2. **MUX-18:**
   - the kit `Text` passes `maxFontSizeMultiplier={1.4}` by default (overridable);
   - chat rows use `min-h-[76px]` with vertical padding instead of a fixed height;
   - the chat header uses `min-h-16`.
   - Nothing changes at the default font size.
3. **MUX-20:** on the three auth screens, wrap the card in a `KeyboardAvoidingView` (`behavior` `padding` on iOS and `height` on Android) plus a `ScrollView` with `keyboardShouldPersistTaps="handled"` and centered content, so the focused field and its button stay visible.
4. **MUX-22:** call `tap()` when a message is sent from the composer and when a quick reaction is pressed.
5. **MUX-26:**
   - "Muted: change" becomes "Muted · Change";
   - the bare "Chat not found" becomes `StateMessage` kind `empty`, title "Chat not found", with the hint "It may have been deleted or you left it." and a "Back to chats" action.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/ui/search-field.tsx`, `apps/mobile/src/components/ui/text.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/composer-input-row.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/NameForm.tsx`
- `apps/mobile/src/app/welcome/handle.tsx`, `apps/mobile/src/app/chat/[id].tsx`
- `work/T-1436-mobile-small-ux.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every file stays at 400 lines or fewer.
- The lead runs a phone smoke of the chat list, a chat and the login screen.

---

## Report (written by the worker when done)

### What I did

Rechecked each finding against the code first; all were still open except the part
of MUX-17 noted below.

- **MUX-17:** `search-field.tsx` clear button now has `hitSlop={12}`. The
  `accessibilityLabel` was already present and defaults to `"Clear search"` (the
  `clearLabel` prop, default `'Clear search'`), so I left it as the prop rather
  than hard-coding a second string.
- **MUX-18:**
  - `text.tsx`: the kit `Text` now takes `maxFontSizeMultiplier = 1.4` by default
    and forwards it, so a caller can still override it. At the default system
    font scale (1×) nothing changes.
  - `chat-list-item.tsx`: `h-[76px]` → `min-h-[76px]`; the inner content wrapper
    that carries the divider now uses `self-stretch` + `py-3` instead of `h-full`,
    so the divider still reaches the row edges at the default size (76 px) and the
    row grows with scaled text instead of clipping it. The avatar stays centred.
  - `chat-header.tsx`: `h-16` → `min-h-16` (nativewind resolves it to 64 px at
    the default size).
- **MUX-20:** `AuthFlow.tsx`, `NameForm.tsx` and `welcome/handle.tsx` now wrap the
  card in a `KeyboardAvoidingView` (`behavior` `padding` on iOS, `height` on
  Android; imported from `react-native-keyboard-controller`, as the rest of the app
  does) with a `ScrollView` (`keyboardShouldPersistTaps="handled"`, content
  `flexGrow: 1` + centred + `padding: 16`). Centring moved from the `SafeAreaView`
  onto the scroll content so the focused field and its button stay reachable.
- **MUX-22:** `composer-input-row.tsx` calls `tap()` in the send button's `onPress`
  before `onSend()`; `message-actions-sheet.tsx` calls `tap()` before `onReact(emoji)`
  on a quick-reaction press.
- **MUX-26:** `chat-actions-sheet.tsx` label `'Muted: change'` → `'Muted · Change'`;
  `chat/[id].tsx`'s bare "Chat not found" is now a `StateMessage` `kind="empty"`
  with the given hint and a "Back to chats" action (`goBackOrHome(screen.router)`).

### Files changed

`apps/mobile/src/components/ui/search-field.tsx`, `apps/mobile/src/components/ui/text.tsx`,
`apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`,
`apps/mobile/src/components/chat/composer-input-row.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`,
`apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/auth/AuthFlow.tsx`,
`apps/mobile/src/auth/NameForm.tsx`, `apps/mobile/src/app/welcome/handle.tsx`,
`apps/mobile/src/app/chat/[id].tsx`, `work/T-1436-mobile-small-ux.md`.

### Commands and real results

- `pnpm install`: done in 12.3s (one pre-existing peer warning:
  `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm exec prettier --write <changed files>`: reformatted `AuthFlow.tsx`,
  `NameForm.tsx` and `handle.tsx` (the JSX I added); the other eight were already
  formatted. Run once to match the repo style, not as the format check.
- Tests: no test file imports any of these view files, so there was no single test
  to run; the gate's `@zilar/mobile` test step covered the package.
- `pnpm gate` (from the repo root), run twice: once after the code changes and
  again after this Report was written, so the last run covers the final tree. Both
  ended `GATE PASS`; the second run:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations / notes

- MUX-17: the spec asks to add `accessibilityLabel="Clear search"`; the button
  already had `accessibilityLabel={clearLabel}` whose default is exactly that
  string, so only `hitSlop` was missing and I added it. No behaviour change for
  callers that pass a custom `clearLabel`.
- MUX-18 row: the vertical padding sits on the inner divider wrapper (with
  `self-stretch`) rather than on the outer `Pressable`; putting it on the outer row
  would have shrunk the divider or left it floating, so this keeps the row visually
  identical at the default font size while letting it grow when text is scaled.
- No UI tests per the spec; the lead's phone smoke covers the chat list, a chat and
  the login screen.

### Open questions

None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- Phone smoke PASS on `/`, a chat, `/chat/missing-chat` and `/login`; the lead looked at every screenshot.
- The login card stays above the keyboard.
- "Chat not found" is now a StateMessage with "Back to chats".
- The chat and the list are unchanged at the default font size.
