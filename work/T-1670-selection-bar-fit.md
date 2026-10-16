---
id: T-1670
title: "Phone select bar fits a phone: Cancel, Delete and Copy become icon keys (X, Trash2, Copy) with screen-reader labels so 'N selected' is no longer squeezed to 'N …' (found in the lead's emulator QA of T-1666); Forward keeps its label"
status: merged
milestone: M5
branch: task/T-1670-selection-bar-fit
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1670: The select bar fits a phone screen

## Spec (written by Claude, do not edit)

### Why
The lead's emulator QA of T-1666 (Pixel 7 width, 2026-10-16) found the problem. With two messages selected, the bar shows "2 …" instead of "2 selected": the four text buttons (Cancel, Delete, Copy, Forward) leave the count about 25 px.

### Facts (the lead read them on 2026-10-16, main after T-1667)
- **`apps/mobile/src/components/chat/selection-bar.tsx`:** after the count `Text` (`{count} selected`) come
  - `<Button variant="ghost" size="sm" onPress={onCancel}><Text>Cancel</Text></Button>`;
  - Delete (`variant="destructive"`, `size="sm"`, `accessibilityLabel="Delete selected messages"`, only when `deletable.length > 0`);
  - Copy (`variant="outline"`, `size="sm"`, `accessibilityLabel="Copy selected messages"`, disabled when `copyable` is empty);
  - Forward (`<Button …><Forward size={16} /><Text>Forward</Text></Button>`).
- **`IconButton`** (`apps/mobile/src/components/ui/icon-button.tsx`): a required `label` (the accessibility label), a 40×40 raised key, and Pressable props such as `onPress` and `disabled`.
- **Icon colours:** `ICON` and `DANGER` from `@/lib/colors`. Icons come from `lucide-react-native`.

### Steps
1. **In `selection-bar.tsx`:**
   - replace the Cancel button with `<IconButton label="Cancel" onPress={onCancel}><X size={20} color={ICON} /></IconButton>`;
   - Delete becomes `<IconButton label="Delete selected messages" …><Trash2 size={20} color={DANGER} /></IconButton>`, shown under the same condition;
   - Copy becomes `<IconButton label="Copy selected messages" disabled={copyable.length === 0} …><Copy size={20} color={ICON} /></IconButton>`, at half opacity when disabled;
   - order: Cancel (X) first, at the left before the count, then the count, then Delete, Copy and Forward on the right;
   - Forward stays a labelled button.
2. **The count keeps `numberOfLines={1}`.** It must read "2 selected" in full on a 360 dp-wide screen.
3. **No behaviour change, no tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `work/T-1670-selection-bar-fit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **On a phone-width screen,** the bar reads "[X] 2 selected … [trash] [copy] [Forward]" with the count in full.
- **Every icon has a screen-reader label.**
- **The lead checks this on the emulator.**

---

## Report (written by the worker when done)

### What I did
- In `apps/mobile/src/components/chat/selection-bar.tsx`, turned the three text keys into icon keys (per spec):
  - **Cancel** → `<IconButton label="Cancel">` with `<X size={20} color={ICON} />`, moved to the left, before the count.
  - **Delete** → `<IconButton label="Delete selected messages">` with `<Trash2 size={20} color={DANGER} />`, kept under the same `deletable.length > 0` condition.
  - **Copy** → `<IconButton label="Copy selected messages" disabled={copyable.length === 0}>` with `<Copy size={20} color={ICON} />` and `className="opacity-50"` when disabled.
  - **Forward** stays a labelled `Button` (unchanged).
- Order in the row is now: Cancel (X) | count | Delete | Copy | Forward.
- The count `Text` keeps `numberOfLines={1}` and `flex-1`, so "N selected" is no longer squeezed by text buttons.
- Added imports: `IconButton` from `@/components/ui/icon-button`; `Copy, Trash2, X` added to the existing `lucide-react-native` import; `DANGER, ICON` from `@/lib/colors`.
- No behaviour change, no tests (UI, per spec and AGENTS.md).
- Files changed: `apps/mobile/src/components/chat/selection-bar.tsx` and this task file only.

### Checks run
- `pnpm install` — done, 1137 packages, no errors.
- Single test runs: none — this is UI code and the spec says "no tests".
- `pnpm gate` (from repo root), final run:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.8s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/mobile  (2.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  - The first gate run failed on `format` (Prettier wanted to collapse the Delete `IconButton` onto one line); I ran `pnpm exec prettier --write apps/mobile/src/components/chat/selection-bar.tsx` and re-ran the gate, which passed.

### Notes for the lead
- Every icon key has a screen-reader label (`Cancel`, `Delete selected messages`, `Copy selected messages`); Forward keeps its visible "Forward" label.
- Acceptance requires emulator QA by the lead on a phone-width screen — I could not run an emulator here, so the visual "[X] 2 selected … [trash] [copy] [Forward]" check is not verified by me. Typecheck/lint/format/mobile tests pass.

## Review (written by Claude)

**Approved and merged.** This fixes the lead's QA finding on T-1666.

- **Pre-review:** clean, 0 nits.
- **The change:** Cancel (X), Delete (Trash2, danger colour) and Copy become `IconButton` keys with screen-reader labels; Copy is at half opacity when disabled; Forward keeps its label. This frees about 60 dp for "N selected".
- **Still to check:** the emulator check is in the next phone QA pass on main, with T-1668 and T-1669.

