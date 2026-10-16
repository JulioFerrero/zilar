---
id: T-1669
title: "Phone emoji sheet lifts above the keyboard: while the Emoji or GIFs search field is focused the keyboard covers the results grid (found in the lead's emulator QA on 2026-10-16); wrap the sheet's content in a keyboard-avoiding view so results stay visible while typing"
status: merged
milestone: M5
branch: task/T-1669-emoji-sheet-keyboard
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1669: The emoji sheet avoids the keyboard

## Spec (written by Claude, do not edit)

### Why
The lead's emulator QA on 2026-10-16 (mock build of main, Pixel 7, Android 16) found this. In the emoji sheet, tapping "Search emoji" (T-1660) or "Search GIFs" opens the keyboard over the bottom of the sheet. The results grid sits under the keyboard, so you can't see what you're searching until you close the keyboard. The sheet stays at its fixed half height behind the keyboard.

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/emoji-sheet.tsx`** (162 lines):
  - `<Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>` (`:102`);
  - a full-screen backdrop `Pressable` (`className="flex-1 justify-end bg-black/40"`, `:103-107`) holds the panel `Pressable` (`className="h-[50%] rounded-t-2xl …"` with `paddingBottom: Math.max(insets.bottom, 8)`, `:108-114`).
- **The app already uses `react-native-keyboard-controller`** (`apps/mobile/package.json:65`, version 1.22.6): `KeyboardProvider` in `apps/mobile/src/app/_layout.tsx:117`, and `<KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">` in `apps/mobile/src/app/chat/[id].tsx:103`.
- **The search fields** are in `apps/mobile/src/components/chat/emoji-tab.tsx` (Emoji) and `apps/mobile/src/components/chat/gif-panel.tsx` (GIFs).

### Steps
1. **In `emoji-sheet.tsx`,** inside the `Modal`, wrap the backdrop in a keyboard-avoiding view so that when the keyboard opens, the panel sits directly above it with its results visible:
   - use `KeyboardAvoidingView` from `react-native-keyboard-controller` with `behavior="padding"` and `style={{ flex: 1 }}`, as the chat screen does;
   - **if it doesn't react inside an RN `Modal`** (it's a separate window on Android), use React Native's own `KeyboardAvoidingView` there instead, and say which one you used in the Report.
2. **While the keyboard is open,** let the panel keep at least the search field, the tab row and about two rows of results above the keyboard: reduce the panel height when needed rather than pushing the tabs off the top. With the keyboard closed, the panel keeps its current half height.
3. **No other change, no tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `work/T-1669-emoji-sheet-keyboard.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **With the Emoji or GIFs search field focused,** the results grid shows above the keyboard.
- **With the keyboard closed,** the sheet looks as before.
- **The lead checks this on the emulator.**

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/chat/emoji-sheet.tsx`: inside the existing `<Modal>` I
  wrapped the sheet's backdrop `Pressable` in
  `<KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">`, and added one
  sentence to the component's doc comment. Nothing else changed: the panel markup,
  its `h-[50%]` height and its look with the keyboard closed are identical to before.
- Which view: `KeyboardAvoidingView` from `react-native-keyboard-controller`, not
  React Native's own. It is what the chat screen (`app/chat/[id].tsx`) and the other
  modal sheet (`components/ais/tool-detail-sheet.tsx`) already use, and
  `KeyboardProvider` is already mounted in `app/_layout.tsx`. I have no emulator, so I
  could not verify the spec's caveat that the controller's view may not react inside a
  transparent RN `Modal` on Android — see Notes.
- Step 2 came from the wrapper, with no extra height math: with `behavior="padding"`
  the view adds a bottom inset equal to the keyboard height, the `flex-1` backdrop
  then fills only the space above the keyboard, and the panel's `h-[50%]` resolves
  against that space. So while typing the panel sits directly above the keyboard and
  drops below half height (handle, tab row, search field and several result rows stay
  visible); with the keyboard closed the inset is 0 and the panel keeps its half
  height. No fixed pixel height and no keyboard-height hook were needed.
- No tests: this is UI code (AGENTS.md — UI gets no tests) and no existing test
  imports the sheet.

### Checks run

- `pnpm install` — Done, 17 workspace projects, exit 0.
- `pnpm gate` (from the repo root) — summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (5.4s)
PASS  effect  (0.9s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single test files: none run — no test file covers `emoji-sheet.tsx`; the only tests
  are the gate's `@zilar/mobile` run above.
- `git status --short` — only the two Allowed files modified.

### Notes for the lead

- KeyboardAvoidingView used: the `react-native-keyboard-controller` one (the spec's
  default and the project's standard).
- Unverified here: with no emulator I could not confirm the sheet reacts inside the
  transparent Android `Modal`. If your QA shows it does not, switch the import to React
  Native's own `KeyboardAvoidingView` (same props): that is a one-line change at the
  top of the file, everything else stays.
- Deviations from the spec: none. I updated the doc comment to mention the new wrapper.
- Open questions: none.

## Review (written by Claude)

**Approved and merged.** This fixes the lead's QA finding.

- **Pre-review:** clean, 1 nit: whether the controller view reacts inside an RN `Modal` is unverified.
- **The change:** the sheet's backdrop and panel sit inside `react-native-keyboard-controller`'s `KeyboardAvoidingView` (`behavior="padding"`). The 50% panel then measures against the space above the keyboard. Nothing changes with the keyboard closed.
- **Still to check:** the emulator check is in the next phone QA pass on main. If the panel doesn't rise, a one-line fix task swaps in React Native's own `KeyboardAvoidingView`.
