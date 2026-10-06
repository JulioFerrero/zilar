---
id: T-0412
title: "Mobile kit: the Connections screen's Test, Remove, Close form and Show key icon buttons use the kit Button"
status: merged
milestone: M5
branch: task/T-0412-mobile-connections-icon-buttons
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0412: Connections icon buttons on the kit (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 12 of `docs/audit/ui-kit-leftovers.md`. Web did the same in T-0396.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/settings/connections.tsx`.** Four raw `Pressable` icon buttons, each `accessibilityRole="button"` with a lucide icon `size={16} color={ICON[scheme]}`:
  - lines 281-288: label `` `Test ${providerLabel(connection.provider)} key` ``, `disabled={testingId === connection.id}`, `onPress={() => test(connection.id)}`, class `rounded-full p-2 active:bg-surface-raised disabled:opacity-50`, with a `Zap` icon;
  - lines 289-298: label `` `Remove ${providerLabel(connection.provider)} connection` ``, an `onPress` that runs `setConfirmingId(connection.id); setRemoveError('');`, class `rounded-full p-2 active:bg-surface-raised`, with a `Trash2` icon;
  - lines 381-388: label "Close the form", `onPress={onCancel}`, class `rounded-full p-1 …`, with an `X` icon;
  - lines 438-448: label `showKey ? 'Hide key' : 'Show key'`, an `onPress` that toggles `showKey`, with an `Eye`/`EyeOff` icon.
- **Imports** (lines 4, 16 and 18): the file already imports `Pressable`, the kit `Button` and `IconButton`.
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variant `ghost` (`active:bg-surface-raised`), size `icon` (`h-10 w-10`);
  - `cn` merges `className`;
  - `disabled` dims it.
- **Kept on purpose:** the raised `IconButton` stays for header keys only (Back, Add), so these in-card buttons use the ghost Button.
- **Test:** `apps/mobile/src/components/connections/connections-screen.test.tsx`. It already has the kit Button mocks.

### What to build
1. Replace each of the four `Pressable`s with `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" accessibilityLabel={<same>} disabled={<same, Test only>} onPress={<same>}>`, keeping the same icon child.
2. Drop `Pressable` from the `react-native` import only if nothing else in the file uses it.
3. Change no assertion. Add mocks only if needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/connections.tsx:270-300` and `:375-450`, and the test.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `work/T-0412-mobile-connections-icon-buttons.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen
pnpm gate
```

### Acceptance
- The four icon buttons are kit ghost Buttons with the same labels and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the four raw `Pressable` icon buttons in `apps/mobile/src/app/settings/connections.tsx` with the kit `Button`:

- Test key button (was lines 281-288): `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" accessibilityLabel={`Test ${providerLabel(connection.provider)} key`} disabled={testingId === connection.id} onPress={() => test(connection.id)}>`, `Zap` icon unchanged.
- Remove connection button (was 289-300): same Button shape, label `` `Remove ${providerLabel(connection.provider)} connection` ``, same handler that sets `confirmingId` and clears `removeError`, `Trash2` icon unchanged.
- Close-the-form button (was 381-388): same Button shape, label "Close the form", `onPress={onCancel}`, `X` icon unchanged.
- Show/hide key button (was 438-449): same Button shape, label `showKey ? 'Hide key' : 'Show key'`, same toggle handler, `Eye`/`EyeOff` unchanged.

I dropped `accessibilityRole="button"` on these four because the kit `Button` already sets `role="button"` on its inner `Pressable`. The `disabled` dim is preserved: the `Button` adds `opacity-50` when `disabled` (button.tsx:104).

I kept the `Pressable` import: the provider picker in `AddConnectionForm` (lines 399-421) still uses `Pressable` with `accessibilityRole="radio"`, which this task does not touch. No other file changed.

### Files changed
- `apps/mobile/src/app/settings/connections.tsx`
- `work/T-0412-mobile-connections-icon-buttons.md` (status + this report)

### Commands and results
- `pnpm install` → Done, exit 0.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot connections-screen` → Test Files 1 passed (1), Tests 5 passed (5), exit 0. (Only the pre-existing React "incorrect casing" stderr warnings from the static-markup harness; no failures.)
- `pnpm gate` → exit 0, ends with `GATE PASS`:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.5s)`
  - `PASS  format  (20.4s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (18.9s)`
  - `PASS  tests @zilar/mobile  (3.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Test mocks
No test change was needed. The spec said the kit Button mocks were already present; in fact the test relies on the real `Button` (its `react-native`, `nativewind`, `react-native-reanimated`, `lucide-react-native`, `@/components/ui/text` and `@/components/ui/icon-button` mocks are enough), and all 5 cases pass with the real Button rendering. Assertions are unchanged.

### Deviations
None. All four buttons now use `variant="ghost" size="icon" className="h-9 w-9 rounded-full"` as specified.

### Blocked / needs a decision
None. No open questions.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. All four in-card icon buttons are ghost `icon` kit Buttons (`h-9 w-9 rounded-full`) with the same labels, handlers and `disabled`.
