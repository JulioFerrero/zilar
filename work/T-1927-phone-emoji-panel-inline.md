---
id: T-1927
title: "Phone emoji/sticker/GIF panel docks under the composer like Telegram (no modal, no backdrop): the input stays visible while you pick, the emoji key toggles to a keyboard key, and focusing the field or Back closes it"
status: merged
milestone: M5
branch: task/T-1927-phone-emoji-panel-inline
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1927: The emoji panel sits under the input, not over it

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on the iPhone:**

> the emoji drawer, like i press an emoji but i cant see the input at all!!! we need to fix this

The panel is a full-screen modal with a dark backdrop, so the composer, where each picked emoji lands, is hidden. Telegram docks the panel where the keyboard was, under the input.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/emoji-sheet.tsx`** (180 lines):
  - `EmojiSheet` returns `<Modal visible={open} transparent animationType="fade" onRequestClose={close}>`, then `KeyboardAvoidingView`, then a backdrop `Pressable` (`bg-black/40`, `onPress={close}`), then `Animated.View className="h-[50%]"` with `useSheetMotion(onClose)` (`:106`), then the panel (`rounded-t-2xl … bg-surface px-4 pt-3`, `paddingBottom` from insets), a grabber, the tab row and the tab body (`:116-178`).
- **`apps/mobile/src/components/chat/composer.tsx`** (311 lines): the root `<View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>` (`:237`) holds `ComposerInputRow` (`:258`, `onOpenSheet={sheet.openSheet}` at `:271`), then `<EmojiSheet open={sheet.sheetOpen} … onClose={sheet.closeSheet} />` (`:279-297`), then `AttachSheet`.
- **`apps/mobile/src/components/chat/composer-sheet.ts`:**
  - `sheetOpen` state (`:96`);
  - `openSheet` calls `Keyboard.dismiss()`, then `setSheetOpen(true)`, loads the panel and hydrates it (`:130-137`);
  - `closeSheet` (`:139`).
- **`apps/mobile/src/components/chat/composer-input-row.tsx`** (197 lines): the `TextInput` (`:140`, `ref={inputRef}`) and the emoji key `<IconButton label="Emoji" … onPress={onOpenSheet}><Smile …/></IconButton>` (`:161-163`). The lucide imports are at `:2`.

### Steps
1. **`emoji-sheet.tsx`:** turn it into an inline panel.
   - When `!open`, return `null`.
   - When open, render the `View` directly, with no `Modal`, `KeyboardAvoidingView`, backdrop, grabber or `useSheetMotion`. Use `className="mt-1.5 border-t border-border bg-surface"` and a fixed height `PANEL_HEIGHT = 300`.
   - Keep the tab row and the tab body (`EmojiTab`, `StickerGrid`, `GifPanel`) exactly as they are.
   - Drop the panel's own bottom inset padding; the composer root already pads for the home bar.
   - Remove the now-unused imports (`Modal`, `KeyboardAvoidingView`, `Animated`, `useSheetMotion`, `useSafeAreaInsets` if unused).
   - Update the doc comment.
2. **`composer-input-row.tsx`:**
   - Add props `sheetOpen: boolean` and `onCloseSheet: () => void`.
   - While `sheetOpen`, the emoji key shows lucide `Keyboard` with label "Keyboard". Pressing it calls `onCloseSheet()`, then `inputRef?.current?.focus()`.
   - The `TextInput` gets `onFocus={() => { if (sheetOpen) onCloseSheet(); }}`, so tapping the field brings the keyboard back and closes the panel.
3. **`composer.tsx`:** pass `sheetOpen={sheet.sheetOpen}` and `onCloseSheet={sheet.closeSheet}` to `ComposerInputRow`. `EmojiSheet` stays right after the input row, so it now renders under it.
4. **`composer-sheet.ts`:** while `sheetOpen`, Android Back closes the panel. Use a `BackHandler.addEventListener('hardwareBackPress', …)` in a `useEffect` keyed on `sheetOpen` that returns `true` after closing; remove the listener on cleanup.
5. **Unchanged:** picking a sticker or a GIF still closes the panel and sends, and picking an emoji inserts it at the caret, now visible in the field above.
6. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/composer-input-row.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `work/T-1927-phone-emoji-panel-inline.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Tapping the emoji key** hides the keyboard and shows a 300-high panel under the input. The message list stays visible above, and the input with each picked emoji is visible.
- **The key becomes a keyboard key.** Tapping it, or the field, brings the keyboard back and closes the panel. Back (Android) closes the panel.
- **Stickers and GIFs** still send and close the panel.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/components/chat/emoji-sheet.tsx`**: `EmojiSheet` returns
  `null` when closed; when open it renders an inline `View`
  (`mt-1.5 border-t border-border bg-surface px-4 pt-3`, height
  `PANEL_HEIGHT = 300`) directly under the composer input. Removed the `Modal`,
  `KeyboardAvoidingView`, backdrop `Pressable`, grabber, `useSheetMotion`,
  `useSafeAreaInsets` and the panel's own bottom inset padding. The tab row and
  the tab bodies (`EmojiTab`, `StickerGrid`, `GifPanel`) are unchanged. The
  doc comment now describes the docked panel.
- **`apps/mobile/src/components/chat/composer-input-row.tsx`**: added the
  `sheetOpen: boolean` and `onCloseSheet: () => void` props. While the panel is
  open the emoji key shows lucide `Keyboard` with label "Keyboard"; pressing it
  calls `onCloseSheet()` then focuses the input. The `TextInput`'s `onFocus`
  closes the panel when it is open, so tapping the field brings the keyboard
  back.
- **`apps/mobile/src/components/chat/composer.tsx`**: passes
  `sheetOpen={sheet.sheetOpen}` and `onCloseSheet={sheet.closeSheet}` to
  `ComposerInputRow`. `EmojiSheet` stays immediately after the row, so it now
  renders below it.
- **`apps/mobile/src/components/chat/composer-sheet.ts`**: a `useEffect` keyed
  on `sheetOpen` registers `BackHandler.addEventListener('hardwareBackPress',
  …)`; it closes the panel and returns `true`, and removes the subscription on
  cleanup (same pattern as `use-back-cancel.ts`). Updated the open/pick
  comments to match.
- No dependencies added. Every changed source file is within 400 lines.

### Checks run

- `pnpm install`: succeeded (15.2 s).
- `pnpm gate`: **GATE PASS** (run twice: once after the code changes, once
  after filling in this Report — both green). Final run's summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.3s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests (UI), and no existing
  unit test covers this panel.

### Notes for the lead

- **Deviation:** I removed the `onClose` prop from `EmojiSheet`, which the spec
  did not explicitly list. Nothing inside the panel closes it any more (the
  keyboard key, field focus and Android Back are handled in
  `composer-input-row.tsx` / `composer-sheet.ts`), so keeping it would have
  left a dead prop. I also removed the now-unused `onClose={sheet.closeSheet}`
  in `composer.tsx`. Say if you want it kept.
- I did not test on a device: the acceptance items (panel under the input,
  keyboard key, tap-to-focus, Android Back, sticker/GIF send) are visual and
  gesture behaviour. I only ran the gate; please cover them in the phone smoke.
- Android Back is intercepted only while the panel is open (`useEffect`
  subscribes only then), so the chat screen's own Back handling is unchanged
  otherwise.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `94d36b5b7`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Checked on screen:**
  - the emoji key docks the panel under the input; the message list stays visible above and the key turns into a keyboard key;
  - a tapped emoji appears in the visible field and Send shows;
  - with the panel open the composer sits higher, so the attach key opened the attach sheet from its new spot.
- **Code:** as specified, including Back handling while open, and focusing the field closes the panel.
