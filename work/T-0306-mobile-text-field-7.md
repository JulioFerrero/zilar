---
id: T-0306
title: "Mobile kit migration: machine rename and sticker pack name fields use the kit TextField"
status: todo
milestone: M5
branch: task/T-0306-mobile-text-field-7
model: auto
effort: low
depends_on: [T-0300]
estimate: 0.1 day
---

# T-0306: mobile TextField, batch 7

## Spec (written by Claude, do not edit)

### Why
This is batch 7 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`): two plain fields in Settings. Read `work/T-0300-mobile-text-field-3.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`, and it passes `style` through.
- **`apps/mobile/src/app/settings/machines.tsx`:**
  - line 365: the rename `TextInput` (`accessibilityLabel={`Name for ${machine.name}`}`, `maxLength={64}`, `autoFocus`);
  - its class is `rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground`, with no placeholder colour;
  - line 5 imports `TextInput` from `react-native`.
- **`apps/mobile/src/app/settings/sticker-pack.tsx`:**
  - lines 502-517: "Pack name". A wrapper `View className="h-11 flex-row items-center rounded-xl px-3"` with `style={[well, saving ? { opacity: 0.6 } : undefined]}` holds a `TextInput` (line 506);
  - that `TextInput` has `placeholderTextColor={MUTED_FOREGROUND[scheme]}`, `editable={!saving}` and `className="flex-1 text-[15px] text-foreground"`;
  - the file uses `scheme`, `MUTED_FOREGROUND`, `well` and `TextInput` elsewhere too, e.g. the emoji cell at line 707. **Leave those imports and the emoji cell alone.**
- **Tests** (both already mock `nativewind`):
  - `apps/mobile/src/components/machines/machines-screen.test.tsx`;
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`.

### What to build
1. **machines:** the rename field becomes `TextField`.
   - Keep its props and use no className.
   - Remove `TextInput` from the import if it is no longer used.
2. **sticker-pack:** the Pack name wrapper `View` and its `TextInput` become one `TextField` with `className="h-11"` and `style={saving ? { opacity: 0.6 } : undefined}`.
   - Keep `value`, `onChangeText`, `maxLength`, `placeholder`, `accessibilityLabel`, `returnKeyType` and `editable`.
   - Drop `placeholderTextColor`.
3. **Tests:** existing tests keep passing; change them only if a mock is needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0300-mobile-text-field-3.md` (Report), the two screens and their tests.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx` (mocks only), `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (mocks only), `work/T-0306-mobile-text-field-7.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen sticker-pack-screen
pnpm gate
```

### Acceptance
- Both fields render through `TextField`. The sticker-pack emoji cell is unchanged.
- Labels, saving state and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
