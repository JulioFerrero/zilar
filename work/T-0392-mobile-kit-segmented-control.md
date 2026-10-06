---
id: T-0392
title: "Mobile kit: a SegmentedControl (well track, raised active segment, tab or radio roles) taken from the Stickers settings tabs, used there, in the catalog and the kit test"
status: merged
milestone: M5
branch: task/T-0392-mobile-kit-segmented-control
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0392: mobile kit SegmentedControl

## Spec (written by Claude, do not edit)

### Why
- Web has had `SegmentedControl` (`apps/web/src/components/ui/segmented-control.tsx`) for a while. The UI kit audit (`docs/audit/ui-kit-audit.md` §2b) lists it as a P1 mobile gap.
- The Stickers settings screen hand-rolls one.

### Verified facts (do not re-derive)
- **Web API:**
  - `SegmentedControl({ options: { value, label, count? }[], value, onChange, ariaLabel, mode?: 'tabs' | 'radio' })`;
  - the track has role `tablist` or `radiogroup`, and each option has role `tab` or `radio` with selected or checked state.
- **The hand-rolled mobile one (`apps/mobile/src/app/settings/stickers.tsx:279-305`):**
  - the track is `<View className="mb-2 flex-row gap-0.5 rounded-[10px] p-[3px]" style={[well, { borderColor: '#1a1a1a' }]}>`;
  - each tab is `<Pressable key={`${entry.key}-${selected ? 'on' : 'off'}`} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={entry.label} onPress={() => openTab(entry.key)} className="h-[34px] flex-1 items-center justify-center rounded-[7px]" style={selected ? segment : undefined}>`;
  - each label is `<Text className={cn('text-[13px] font-medium', selected ? 'text-foreground' : 'text-muted-foreground')}>`;
  - `segment` and `well` come from `@/lib/depth` (line 25).
  - The `key` includes the selected state on purpose, so the style re-applies on toggle. Keep that trick.
- **Catalog:** `apps/mobile/src/app/dev/kit.tsx` renders kit pieces under `SectionLabel`s.
- **Kit test:** `apps/mobile/src/components/ui/kit.test.tsx` uses `renderToStaticMarkup` with `react-native` mocked as strings.
- **Test that renders the Stickers settings screen:** `apps/mobile/src/components/stickers/stickers-screen.test.tsx`.

### What to build
1. **New `apps/mobile/src/components/ui/segmented-control.tsx`** exporting `SegmentedControl({ options: { value: string; label: string }[], value, onChange, accessibilityLabel, mode?: 'tabs' | 'radio', className? })`, built from the stickers implementation above.
   - The track `View` carries `accessibilityRole={mode === 'radio' ? 'radiogroup' : 'tablist'}` and the label.
   - Each option uses `accessibilityRole` `tab` or `radio`, and `accessibilityState` `{ selected }` or `{ checked }`.
   - Call `onChange` only when the value changes.
   - Keep the `well` and `segment` styles and the `#1a1a1a` border colour exactly.
2. **Use it** in `apps/mobile/src/app/settings/stickers.tsx` for the tabs, with the same labels and `openTab` behaviour, and `className="mb-2"`.
3. **Catalog:** add a "Segmented control" section with a three-option example holding local state.
4. **Kit test:** add a `describe('SegmentedControl')` checking:
   - the roles in both modes;
   - the selected state on the active option;
   - that the labels render.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/segmented-control.tsx`, `apps/mobile/src/app/settings/stickers.tsx:270-310`, `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/app/dev/kit.tsx` and `apps/mobile/src/components/ui/kit.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/segmented-control.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx` (mocks only), `work/T-0392-mobile-kit-segmented-control.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit stickers-screen
pnpm gate
```

### Acceptance
- `SegmentedControl` exists, is shown in the catalog, and is tested.
- `stickers.tsx` uses it, with no hand-rolled tab `Pressable` left.
- `pnpm gate` ends with GATE PASS.

---

## Report (written by the worker when done)

### What I did

1. Added `apps/mobile/src/components/ui/segmented-control.tsx` exporting
   `SegmentedControl({ options: { value, label }[], value, onChange,
   accessibilityLabel, mode?: 'tabs' | 'radio', className? })`.
   - Track: `View` with `accessibilityRole` `tablist` or `radiogroup` (radio
     mode), the `accessibilityLabel`, `style={[well, { borderColor: '#1a1a1a' }]}`
     and `className="flex-row gap-0.5 rounded-[10px] p-[3px]"` merged with the
     caller class.
   - Option: `Pressable` with role `tab`/`radio`, `accessibilityState`
     `{ selected }`/`{ checked }`, `accessibilityLabel`, the `h-[34px] flex-1
     items-center justify-center rounded-[7px]` classes and `segment` when
     active. The `key` is `${value}-${selected ? 'on' : 'off'}` to keep the
     style-reapply-on-toggle trick.
   - `onChange` fires only when the pressed value differs from `value`.
2. Replaced the hand-rolled tab `View`/`Pressable` block in
   `apps/mobile/src/app/settings/stickers.tsx` with the new component
   (`options` mapped from `TABS`, `value={tab}`, `onChange` guarded by a new
   `isStickerTab` type guard before calling `openTab`,
   `accessibilityLabel="Sticker sections"`, `className="mb-2"`).
3. Catalog: added a "Segmented control" section to
   `apps/mobile/src/app/dev/kit.tsx` with a three-option example backed by
   `useState`.
4. Kit test: added a `describe('SegmentedControl')` to
   `apps/mobile/src/components/ui/kit.test.tsx` checking the `tablist`/`tab`
   roles, the `radiogroup`/`radio` roles, that both labels render, and that
   only the active option paints `text-foreground` while the other is
   `text-muted-foreground`.

### Files changed

- `apps/mobile/src/components/ui/segmented-control.tsx` (new)
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/components/ui/kit.test.tsx`
- `work/T-0392-mobile-kit-segmented-control.md`

No other file was touched.

### Commands and real results

- `pnpm install`: "Done in 18.5s" (only the pre-existing peer-dependency
  warning for `@types/react-dom` vs `@types/react`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit
  stickers-screen`: `Test Files 2 passed (2)`, `Tests 49 passed (49)`. The
  React "incorrect casing" warnings in the output are pre-existing
  `renderToStaticMarkup` noise from the mocked `react-native` host strings.
- `pnpm gate`: `gate: 5 changed file(s) against main`, then
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed
  files`, `GATE PASS`.

### Notes / deviations

- None. `well` and `segment` are still exported from `@/lib/depth`; only the
  now-unused import in `stickers.tsx` was removed.
- The selected-state assertion reads through the static markup via the label
  colour (`text-foreground` vs `text-muted-foreground`), the same convention
  already used by `floating-tab-bar.test.tsx`; `accessibilityState` object
  props serialize as `[object Object]` under `renderToStaticMarkup` and cannot
  be compared per option there.
- The `isStickerTab` guard was added so `onChange: (value: string) => void`
  narrows safely to the `StickerTab` union without a cast.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-06). The mobile kit SegmentedControl is built from the Stickers tabs (well track, raised segment, `#1a1a1a` border, key trick, tab/radio roles and states), used on the Stickers settings screen, shown in the catalog and kit-tested. Accepted nit: the onChange-only-on-change guard has no press test (the static-markup kit tests cannot press).
