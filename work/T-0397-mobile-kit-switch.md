---
id: T-0397
title: "Mobile kit: a themed Switch row (label plus RN Switch in kit colours) replaces the folder editor's SwitchRow"
status: todo
milestone: M5
branch: task/T-0397-mobile-kit-switch
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0397: mobile kit Switch

## Spec (written by Claude, do not edit)

### Why
- Web has a kit `Switch` (`apps/web/src/components/ui/switch.tsx`).
- On mobile, the only switch is a local `SwitchRow` in the folder editor that draws the raw RN `Switch` in platform default colours.
- The UI kit audit (`docs/audit/ui-kit-audit.md` §2b) lists Toggle as a P1 gap.

### Verified facts (do not re-derive)
- **Web API:** `Switch({ checked, onCheckedChange, label, disabled?, hideLabel? })`.
- **`apps/mobile/src/app/settings/folder/[id].tsx`:**
  - line 12 imports `Switch` from `react-native`;
  - `SwitchRow({ label, value, disabled, onValueChange })` (lines 281-302) renders `<View className="flex-row items-center gap-2"><Text className="min-w-0 flex-1 text-[15px] text-foreground">{label}</Text><Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onValueChange} /></View>`;
  - it is used at lines 211, 223 and 229.
- **Colours:**
  - `apps/mobile/src/lib/colors.ts` exports `ACCENT` and `ACCENT_FOREGROUND` (`Record<ColorScheme, string>`, lines 32 and 37);
  - `apps/mobile/src/lib/depth.ts` exports `BORDER_STRONG` (line 15);
  - the scheme comes from `asColorScheme(useColorScheme().colorScheme)` (see `apps/mobile/src/components/ui/search-field.tsx`).
- **Catalog and test:** `apps/mobile/src/app/dev/kit.tsx` and `apps/mobile/src/components/ui/kit.test.tsx`, where `react-native` is mocked as strings.
- **Tests:** no test renders the folder editor. `apps/mobile/src/lib/settings-items.test.ts` only lists the route.

### What to build
1. **New `apps/mobile/src/components/ui/switch.tsx`** exporting `Switch({ label, value, onValueChange, disabled?, hideLabel? })`. It renders the row above:
   - a label `Text`, omitted when `hideLabel`;
   - the RN `Switch` with `accessibilityLabel={label}`, `value`, `disabled` and `onValueChange`;
   - `trackColor={{ false: BORDER_STRONG, true: ACCENT[scheme] }}`, `ios_backgroundColor={BORDER_STRONG}` and `thumbColor={ACCENT_FOREGROUND[scheme]}` when on (leave the platform default when off).
2. **Folder editor:** delete the local `SwitchRow` and use the kit `Switch` at the three call sites with the same props. Drop the RN `Switch` import.
3. **Test:** add a new `apps/mobile/src/components/ui/switch.test.tsx` that copies the mock setup of `kit.test.tsx`, with `react-native` mocked as strings including `Switch: 'Switch'`. Check:
   - the label;
   - the `accessibilityLabel`;
   - `hideLabel`;
   - that `value` passes through.

   Do not edit `kit.test.tsx` or the catalog: T-0392 and T-0393 are editing them now. The catalog entry comes later.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/switch.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx:200-305`, `apps/mobile/src/components/ui/search-field.tsx`, `apps/mobile/src/app/dev/kit.tsx` and `apps/mobile/src/components/ui/kit.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/switch.tsx`, `apps/mobile/src/components/ui/switch.test.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx`, `work/T-0397-mobile-kit-switch.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot switch
pnpm gate
```

### Acceptance
- The kit `Switch` exists and is tested in `switch.test.tsx`.
- The folder editor has no local `SwitchRow` and no RN `Switch` import.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
