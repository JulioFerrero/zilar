---
id: T-0329
title: "Mobile kit: Checkbox box with a Check icon, replacing the ✓ glyph boxes; approver tick becomes an icon"
status: todo
milestone: M5
branch: task/T-0329-mobile-checkbox
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0329: mobile kit Checkbox

## Spec (written by Claude, do not edit)

### Why
Three mobile picker rows draw their own checkbox box and put a text `✓` glyph inside it. The approver picker appends `' ✓'` to the label. Julio wants icons, not glyph characters, and the box should live in the kit once.

### Verified facts (do not re-derive)
- **Hand-rolled boxes.** Each sits inside a `Pressable` row that already has `accessibilityRole="checkbox"` and `accessibilityState`.
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx:216-225` (members) and `257-266` (AIs):
    - a `View` with `cn('h-5 w-5 items-center justify-center rounded-md border', checked ? 'border-accent bg-accent' : 'border-border-strong')`;
    - holding `<Text className="text-[12px] text-accent-foreground">✓</Text>` when checked.
  - `apps/mobile/src/components/chat/group-roles-sheet.tsx:259-271` (role holders): the same idea with `rounded-[6px]`.
- **Approver option:** `apps/mobile/src/components/chat/topic-sheets.tsx:375-378` renders `{option.label}{option.selected ? ' ✓' : ''}` inside a `Text`. Line 1 imports `Lock` from `lucide-react-native`.
- **Colours:** `apps/mobile/src/lib/colors.ts` exports `ACCENT`, `FOREGROUND`, `MUTED_FOREGROUND` and `ICON` (each `Record<ColorScheme, string>`). There is no accent-foreground constant. `palette.accentForeground` (`#0a0a0a`) exists in `packages/ui-tokens/src/index.ts:24`. See `apps/mobile/src/components/ui/search-field.tsx` for how a kit piece colours a lucide icon by scheme.
- **Mobile kit:**
  - files live in `apps/mobile/src/components/ui/`;
  - the node-only test pattern (stubbed `react-native` plus `renderToStaticMarkup`) is in `apps/mobile/src/components/ui/bottom-sheet.test.tsx`;
  - `apps/mobile/src/components/ui/count-badge.tsx` is a small visual-only piece to copy the shape from.
- **Tests that mock `lucide-react-native` and reach `topic-sheets.tsx`:** `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx` (lines 37-39, `Lock` only) and `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`.

  **Pitfall:** a lucide mock that lacks an icon the component now imports makes the import undefined. Every such mock must gain the new icon. See `docs/LEAD_HANDOFF.md`, "transitive test mocks".
- No test queries the `✓` glyph.

### What to build
1. **`apps/mobile/src/lib/colors.ts`:** add `ACCENT_FOREGROUND: Record<ColorScheme, string>` from `palette.accentForeground`, like `ACCENT`.
2. **New file `apps/mobile/src/components/ui/checkbox.tsx`:**
   - `Checkbox({ checked, disabled? })`, visual only: no Pressable and no accessibility role, because the row carries them;
   - box `h-5 w-5 items-center justify-center rounded-md border`;
   - checked: `border-accent bg-accent` with `<Check size={14} strokeWidth={3} color={ACCENT_FOREGROUND[scheme]} />`;
   - unchecked: `border-border-strong`;
   - `opacity-50` when disabled.
3. **New file `apps/mobile/src/components/ui/checkbox.test.tsx`** (bottom-sheet test pattern): it renders the Check icon only when checked, and the disabled class.
4. **Replace the three boxes** with `<Checkbox checked={checked} />`. For the locked member, pass `disabled={locked}`.
5. **topic-sheets.tsx:**
   - drop the `' ✓'` string;
   - when `option.selected`, render a `<Check size={16} color={FOREGROUND[scheme]} />` after the label `Text`, inside the same row;
   - get `scheme` the same way `search-field.tsx` does;
   - the row already has `accessibilityState={{ selected: option.selected }}` (line 367); keep it.
6. **Test mocks (mocks only, change nothing else):**
   - add `Check: 'Check'` to the `lucide-react-native` mocks in `topic-actions-sheet.test.tsx` and `topic-sheets-roles.test.tsx`;
   - `topic-sheets-roles.test.tsx` also mocks `@/lib/colors`, so add the constants the change uses (`FOREGROUND`) to that mock.
7. **Mocks that may be needed:**
   - `group-roles-sheet.test.tsx`, `group-roles-mounted.test.tsx` and `group-roles-load.test.tsx` stub `react-native` and `nativewind` but do not mock `lucide-react-native`;
   - `apps/mobile/src/components/directory/handle-route.test.ts` reaches `new-topic-sheet` through `app/group/[id].tsx`.

   If any of them now fails on import because of the new `Checkbox` (lucide, `@/lib/colors`, `nativewind`), add only the missing mocks there. Note in the Report which ones you touched.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `apps/mobile/src/components/ui/search-field.tsx`, `count-badge.tsx`, `bottom-sheet.test.tsx`, and the three call sites.

### Allowed files
`apps/mobile/src/lib/colors.ts`, `apps/mobile/src/components/ui/checkbox.tsx`, `apps/mobile/src/components/ui/checkbox.test.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`; mocks only: `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `apps/mobile/src/components/directory/handle-route.test.ts`; and `work/T-0329-mobile-checkbox.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot checkbox topic-actions-sheet topic-sheets-roles group-roles handle-route
pnpm gate
```

### Acceptance
- `✓` no longer appears in `new-topic-sheet.tsx`, `group-roles-sheet.tsx` or `topic-sheets.tsx`.
- The existing tests pass, with only the two lucide mocks changed, and the new Checkbox test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
