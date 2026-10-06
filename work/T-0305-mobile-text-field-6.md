---
id: T-0305
title: "Mobile kit migration: AI model, spend limit and tool run-input fields use the kit TextField"
status: todo
milestone: M5
branch: task/T-0305-mobile-text-field-6
model: auto
effort: low
depends_on: [T-0300]
estimate: 0.2 day
---

# T-0305: mobile TextField, batch 6

## Spec (written by Claude, do not edit)

### Why
This is batch 6 of moving mobile fields onto the kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`), this time on the AI screens. Read `work/T-0300-mobile-text-field-3.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`, so a caller's `py-2.5`, `w-32` or `font-mono text-[13px]` wins;
  - `textAlignVertical: 'top'` for `multiline`.
- **`apps/mobile/src/components/ais/model-picker.tsx`:**
  - line 27: "Model" `TextInput`, `placeholderTextColor={MUTED_FOREGROUND[scheme]}`;
  - its class is `rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground`;
  - lines 2, 5, 6 and 22 import and compute `scheme` only for that placeholder.
- **`apps/mobile/src/components/ais/limits-fields.tsx`:**
  - line 29: a dollar-amount `TextInput` (`keyboardType="decimal-pad"`) with the same placeholder colour;
  - its class is `w-32 rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-foreground`;
  - lines 2, 5, 6 and 23 exist only for `scheme`.
- **`apps/mobile/src/components/ais/tool-detail-sheet.tsx`:**
  - line 371: "Run input (JSON)", `multiline`, `numberOfLines={3}`;
  - it has `placeholderTextColor="#8a8a8a"` and `className="min-h-[60px] font-mono text-[13px] text-foreground"`;
  - it sits inside a wrapper `View className="rounded-[10px] border border-border-strong bg-well px-3 py-2"` (line 370);
  - `TextInput` is imported at line 8.
- **Tests that import these files:** `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (already mocks `nativewind`) and `apps/mobile/src/components/ais/tools-section.test.tsx` (does not). No test imports `model-picker.tsx` or `limits-fields.tsx` directly.

### What to build
1. **model-picker:** use `TextField` with `className="py-2.5"`.
   - Keep every prop except `placeholderTextColor`.
   - Remove the now-unused `scheme`, `useColorScheme`, `asColorScheme` and `MUTED_FOREGROUND` code and imports, but only if nothing else in the file uses them.
2. **limits-fields:** the same, with `className="w-32 py-2.5"`.
3. **tool-detail-sheet:** use `TextField` with `className="min-h-[60px] font-mono text-[13px]"`.
   - Remove the wrapper `View` and the `#8a8a8a`.
   - Remove `TextInput` from the `react-native` import if it is no longer used.
4. **Tests:** existing tests keep passing. Change the two listed test files only to add mocks, if the `TextField` import needs them (see the pitfall in `docs/LEAD_HANDOFF.md`).

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0300-mobile-text-field-3.md` (Report), the three files and the two tests.

### Allowed files
`apps/mobile/src/components/ais/model-picker.tsx`, `apps/mobile/src/components/ais/limits-fields.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (mocks only), `apps/mobile/src/components/ais/tools-section.test.tsx` (mocks only), `work/T-0305-mobile-text-field-6.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ais
pnpm gate
```

### Acceptance
- The three fields render through `TextField`, and none of the three source files has a raw `<TextInput`, `#8a8a8a` or `MUTED_FOREGROUND` left.
- Sizes, labels and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
