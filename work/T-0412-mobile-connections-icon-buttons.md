---
id: T-0412
title: "Mobile kit: the Connections screen's Test, Remove, Close form and Show key icon buttons use the kit Button"
status: todo
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

## Review (written by Claude)
