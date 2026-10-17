---
id: T-1894
title: "Share into Zilar, task 5: extract the forward sheet's search field + target rows into a shared ChatPickerList (multi-select with checkboxes for Forward, single-select for the coming /share screen); ForwardSheet behaves exactly as before"
status: merged
milestone: M5
branch: task/T-1894-chat-picker-list
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1894: One chat picker for Forward and Share (share plan task 5)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/share-into-zilar.md` §3 "Picker" and §6 task 5** (Julio approved the feature on 2026-10-17). The `/share` screen needs the same chat list as Forward: the same rules (no archived chats, no channels you can't post in) and the same search. So we extract it once, instead of copying it.

### Facts (read by the lead on 2026-10-17)
`apps/mobile/src/components/chat/forward-sheet.tsx` (149 lines):
- `targetLabel` (`:15-19`), `canPostTo` (`:25-30`) and the exported `forwardTargets(chats, query)` (`:37-51`) hold the rules;
- `forwardSendLabel` is at `:54-56`;
- the sheet renders `SearchField` (`:106-112`), then the rows (`:113-138`): a `Pressable` with `accessibilityRole="checkbox"`, a `Checkbox`, `EntityAvatar chat size 28` and the label; "No chats found" when empty;
- then the comment `TextField` and the Send `Button` footer.

### Steps
1. **New `apps/mobile/src/components/chat/chat-picker-list.tsx`:**
   - move `targetLabel`, `canPostTo` and `forwardTargets` here;
   - keep `forwardTargets` exported under the same name, and re-export it from `forward-sheet.tsx` so existing imports keep working;
   - add `export function ChatPickerList(props)` with props:
     - `chats: ChatSummary[]`;
     - `selected: readonly string[]`;
     - `onToggle: (chatId: string) => void`;
     - `mode: 'multi' | 'single'`.
   - It owns the `query` state and renders the `SearchField` plus the rows exactly as today.
   - In `multi` mode the rows are as today (checkbox role, `Checkbox`).
   - In `single` mode:
     - each row has `accessibilityRole="radio"` and `accessibilityState={{ selected }}`;
     - there's no `Checkbox`; the picked row shows a `Check` icon (lucide, 18, foreground) at the right;
     - `onToggle` still reports the tap, and the caller keeps one id.
2. **`forward-sheet.tsx`:** replace the search + rows with `<ChatPickerList chats={…} selected={selected} onToggle={toggle} mode="multi" />`. Everything else (the comment field, the Send label, sending) is unchanged, and the sheet looks and acts the same.
3. **No tests** (UI). Both files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/chat-picker-list.tsx`
- `apps/mobile/src/components/chat/forward-sheet.tsx`
- `work/T-1894-chat-picker-list.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`ChatPickerList` exists** with `multi` and `single` modes.
- **Forward** shows the same search and rows, and sends to the same chats as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/chat-picker-list.tsx` (113 lines, under the
  400-line cap). It now owns `targetLabel`, `canPostTo` and the exported
  `forwardTargets(chats, query)` with the exact same rules as before, plus the
  `query` state and the `SearchField` + rows (including "No chats found").
- `ChatPickerList({ chats, selected, onToggle, mode })` with props exactly as the
  spec lists them, `selected` typed `readonly string[]`.
  - `multi`: unchanged rows — `accessibilityRole="checkbox"`,
    `accessibilityState={{ checked }}`, the `Checkbox`, avatar and label.
  - `single`: `accessibilityRole="radio"`, `accessibilityState={{ selected }}`, no
    `Checkbox`, and a lucide `Check` at 18 px in `FOREGROUND` on the picked row's
    right. `onToggle` fires on every tap; the caller keeps one id.
- `apps/mobile/src/components/chat/forward-sheet.tsx` (75 lines): now renders
  `<ChatPickerList chats={chats} selected={selected} onToggle={toggle} mode="multi" />`
  in place of its own search + rows. The comment `TextField`, `forwardSendLabel`,
  footer `Button`, disabled state and `send()` are unchanged. `forwardTargets` is
  re-exported from this file (`export { forwardTargets } from '…/chat-picker-list'`),
  so existing imports keep working; `forwardSendLabel` stays here.
- No tests added (UI change, per the spec and AGENTS.md).

### Checks run

- `pnpm install --frozen-lockfile`: success ("Done in 13.6s").
- First `pnpm gate`: FAIL — `format` flagged
  `apps/mobile/src/components/chat/chat-picker-list.tsx` (Prettier). Fixed by
  `pnpm exec prettier --write` on the two allowed component files (forward-sheet
  reported unchanged).
- Second `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (2.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files were reported. I ran no single test files
  separately (UI change only); the gate ran the mobile package tests.

### Notes for the lead

- `single` mode has no consumer yet (the coming `/share` screen); it typechecks and
  passes lint but has not been exercised on a device.
- `forwardSendLabel` was left in `forward-sheet.tsx` because only Forward uses it;
  the spec only asked for the three picker helpers to move.
- Forward should look and behave identically: same search placeholder/labels, same
  row markup/classes, same send logic and label.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `e605c574a`.
- **`ChatPickerList`** (111 lines) carries the same `forwardTargets` rules and the same search and row markup.
- **`single` mode** gives a radio role and a trailing check, ready for `/share`.
- **`forward-sheet.tsx`** drops to 75 lines, with an unchanged comment field, send label and sending.
- **Code review only:** this is a straight extraction. The lead opens Forward on the emulator together with the `/share` screen check (share task 4).
