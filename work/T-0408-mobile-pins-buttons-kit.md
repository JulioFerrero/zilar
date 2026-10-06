---
id: T-0408
title: "Mobile kit: the pinned banner's Dismiss, Cycle and Show pills and the pins sheet's Unpin use the kit Button"
status: merged
milestone: M5
branch: task/T-0408-mobile-pins-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0408: pins buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is batch 18 of `docs/audit/ui-kit-leftovers.md`. The jump row ("Jump to pinned message from …") is a content row and stays raw.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/pinned-banner.tsx`:**
  - lines 59-66 and 88-95: `Pressable` "Dismiss pins error" (`rounded-full px-2 py-0.5 active:bg-surface-raised`) with `<Text className="text-[12px] text-muted-foreground">Dismiss</Text>`;
  - lines 112-122: `Pressable` with label `` `Cycle pins, ${index + 1} of ${pins.length}` `` (`shrink-0 rounded-full px-2 py-1 active:bg-surface-raised`) with `Text` `{index + 1} of {pins.length}` (`text-[12px] font-medium text-muted-foreground`);
  - lines 123-134: `Pressable` with label `pins.length === 1 ? 'Show pinned message' : `Show all pins, ${pins.length}`` and `Text` `'Pin'` or `` `${pins.length} pins` ``, in the same style.
- **`apps/mobile/src/components/chat/pins-sheet.tsx:70-79`:** `Pressable` with label `` `Unpin message from ${pin.senderName}` ``, `disabled={unpinning}`, `rounded-full px-3 py-1.5 active:bg-surface-raised disabled:opacity-50`, and `Text` `{unpinning ? '…' : 'Unpin'}` (`text-[13px] font-medium text-danger`).
- **Imports:** both files import `Text` from `../ui/text` and do not import the kit `Button` (`../ui/button`).
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variant `ghost` is `active:bg-surface-raised`;
  - size `sm` is `h-9 gap-1.5 rounded-md px-3`;
  - `cn` merges `className`;
  - it dims itself when `disabled`.
  - Labels MUST be inside `<Text>`: a bare string renders a blank button. That was the T-0349 bug.
- **Tests:**
  - `apps/mobile/src/components/chat/pinned-banner.test.tsx`;
  - `apps/mobile/src/components/chat/pins-sheet.test.tsx`.

  The kit Button needs the mocks listed in other kit tests (for example `apps/mobile/src/components/ui/switch.test.tsx` and `apps/mobile/src/components/contacts/blocked-screen.test.tsx`): `Platform.select`, reanimated `useReducedMotion`, `@/lib/depth` keys and `use-key-press`. Before editing, grep for other tests that import these two files one level up, and add mocks there too if needed. If such a test is outside the Allowed files, stop and report BLOCKED.

### What to build
1. **Banner pills.** Replace each of the four `Pressable`s with `<Button variant="ghost" size="sm" className="h-7 rounded-full px-2" accessibilityLabel={<same>} onPress={<same>}>`, keeping the same `<Text>` children and classes. Keep `shrink-0` where it was.
2. **Unpin.** Use `<Button variant="ghost" size="sm" className="shrink-0 rounded-full" disabled={unpinning} accessibilityLabel={<same>} onPress={<same>}>`, keeping the danger `Text` child.
3. Leave the jump `Pressable` unchanged.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, both files, and their tests.

### Allowed files
`apps/mobile/src/components/chat/pinned-banner.tsx`, `apps/mobile/src/components/chat/pins-sheet.tsx`, `apps/mobile/src/components/chat/pinned-banner.test.tsx`, `apps/mobile/src/components/chat/pins-sheet.test.tsx`, `work/T-0408-mobile-pins-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot pinned-banner pins-sheet
pnpm gate
```

### Acceptance
- The five controls are kit `Button`s with their labels inside `<Text>`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/pinned-banner.tsx`: replaced the four `Pressable`s with the kit `Button` (`variant="ghost" size="sm"`). The two "Dismiss pins error" pills and both the cycle ("n of N") and list ("Pin"/"N pins") pills use `className="h-7 rounded-full px-2"`, keeping `shrink-0` on the cycle and list pills. Children `<Text>` elements and their classes are unchanged. The jump row `Pressable` is untouched.
- `apps/mobile/src/components/chat/pins-sheet.tsx`: replaced the Unpin `Pressable` with `<Button variant="ghost" size="sm" className="shrink-0 rounded-full" disabled={unpinning} …>`, keeping the danger `Text` child and label. The jump row `Pressable` is untouched.
- Added the kit-Button mocks the spec names to both tests: `Platform.select` in the `react-native` mock, `react-native-reanimated` `useReducedMotion`, `@/components/ui/use-key-press`, `@/lib/depth` keys, and `TextClassContext` in the `../ui/text` mock.
- Grepped one level up for tests importing these two files: only `pinned-banner.test.tsx` and `pins-sheet.test.tsx` do (other hits are comments referencing the file). No out-of-scope test needed mocks, so no BLOCKED.

### Files changed
- `apps/mobile/src/components/chat/pinned-banner.tsx`
- `apps/mobile/src/components/chat/pins-sheet.tsx`
- `apps/mobile/src/components/chat/pinned-banner.test.tsx`
- `apps/mobile/src/components/chat/pins-sheet.test.tsx`
- `work/T-0408-mobile-pins-buttons-kit.md`

### Commands and results
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot pinned-banner pins-sheet` → `Test Files 2 passed (2)`, `Tests 7 passed (7)`.
- `pnpm gate` (repo root) → summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (20.9s)
  PASS  lint  (1.6s)
  PASS  typecheck  (10.4s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- `pnpm install` printed a peer-dependency warning for `@types/react-dom` wanting `@types/react@^19.3.0` (found 19.2.18) on `apps/mobile`; it is pre-existing and gate lint/typecheck pass.
- No open questions.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review had one nit, accepted: the tests do not assert component identity, which matches repo practice.
- All five controls are ghost `sm` kit Buttons, with labels inside `<Text>` and the banner pills kept compact (`h-7`).
- The jump rows are untouched.
