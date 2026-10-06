---
id: T-0415
title: "Mobile kit: Delete folder, New folder, the Integrations show-secret toggle and the Revoked machines disclosure use the kit Button"
status: todo
milestone: M5
branch: task/T-0415-mobile-settings-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0415: settings buttons on the kit (mobile)

## Spec (written by Claude, do not edit)

### Why
These are rows from batches 13 and 15 of `docs/audit/ui-kit-leftovers.md`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `outline`, `ghost` and `link`; sizes `default`, `sm` and `icon`;
  - `cn` merges `className`, and `disabled` dims the button;
  - labels MUST be inside `<Text>`, because a bare string renders a blank button (the T-0349 bug);
  - all four files below already import `Button` from `@/components/ui/button`, except `apps/mobile/src/app/settings/folders.tsx` (check it, and add the import if missing).
- **The four `Pressable`s:**
  1. **`apps/mobile/src/app/settings/folder/[id].tsx:266-273`:** label "Delete folder", `onPress={() => setConfirmingDelete(true)}`, class `items-center py-1`, child `<Text className="text-[15px] font-medium text-danger">Delete folder</Text>`.
  2. **`apps/mobile/src/app/settings/folders.tsx:104-113`:**
     - label "New folder", `disabled={atLimit || busy}`, `onPress={() => openFolder('new')}`;
     - class `mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-3 …`;
     - children `<Plus size={18} …/>` and `<Text className="text-[15px] font-medium text-foreground">New folder</Text>`.
  3. **`apps/mobile/src/app/settings/integrations.tsx:192-203`:** label `show ? `Hide ${showLabel}` : `Show ${showLabel}``, `onPress={onToggleShow}`, class `rounded-full p-2 …`, with an `Eye`/`EyeOff` icon `size={16}`.
  4. **`apps/mobile/src/app/settings/machines.tsx:426-435`:** label `showRevoked ? 'Hide revoked machines' : 'Show revoked machines'`, a toggle `onPress`, class `flex-row items-center gap-1 self-start active:opacity-70`, child `<Text className="text-[15px] font-semibold text-foreground">Revoked ({revoked.length})</Text>`.
- **Tests:**
  - `apps/mobile/src/components/integrations/integrations-screen.test.tsx`;
  - `apps/mobile/src/components/machines/machines-screen.test.tsx`;
  - the audit found no test for the two folder screens.

  The gate runs every mobile test. If a test you cannot edit fails through a transitive import, stop and report BLOCKED with the file name.

### What to build
1. **Delete folder:** `<Button variant="ghost" accessibilityLabel="Delete folder" onPress=…>` with the same danger `<Text>`.
2. **New folder:** `<Button variant="outline" className="mt-3 rounded-xl border-dashed" accessibilityLabel="New folder" disabled={atLimit || busy} onPress=…>` with the same `Plus` and `<Text>` children.
3. **Integrations toggle:** `<Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" accessibilityLabel={…} onPress={onToggleShow}>` with the same icons, the same as T-0412 did on Connections.
4. **Revoked disclosure:** `<Button variant="ghost" size="sm" className="self-start px-0" accessibilityLabel={…} onPress=…>` with the same `<Text>`.
5. Drop `Pressable` from an import only when it becomes unused. Change no assertion. Add mocks only if needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, each file around its lines, and the two tests.

### Allowed files
`apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0415-mobile-settings-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations-screen machines-screen
pnpm gate
```

### Acceptance
- The four controls are kit Buttons, with their labels inside `<Text>`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
