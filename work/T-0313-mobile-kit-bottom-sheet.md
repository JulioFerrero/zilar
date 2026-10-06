---
id: T-0313
title: "Mobile kit: BottomSheet (keyboard-aware panel sheet); pins list and invite links sheets use it"
status: merged
milestone: M5
branch: task/T-0313-mobile-kit-bottom-sheet
model: auto
effort: low
depends_on: [T-0310]
estimate: 0.4 day
---

# T-0313: mobile kit BottomSheet

## Spec (written by Claude, do not edit)

### Why
About ten mobile sheets repeat the same shell:
- a `Modal`;
- a dim backdrop `Pressable` that closes;
- a rounded-top panel (`rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3`) with a grab handle (`mb-1 h-1 w-10 self-center rounded-full bg-surface-raised`) and a header line.

T-0299 and T-0310 had to add keyboard handling to two of them by hand. A kit `BottomSheet` gives one shell, with the keyboard handling built in. This task builds it and moves two sheets onto it; later tasks move the rest.

### Verified facts (do not re-derive)
- **The keyboard-aware layout, as in `apps/mobile/src/components/chat/invite-links-sheet.tsx` (T-0299/T-0310):**
  - `KeyboardAvoidingView` (`behavior` `'padding'` on iOS, `undefined` otherwise, `className="flex-1"`);
  - inside it, a backdrop `Pressable` (`flex-1 justify-end bg-black/40`, `onPress={onClose}`);
  - then the sheet `Pressable` (`onPress={() => {}}`, `max-h-[85%]`), with `paddingBottom: sheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight)`;
  - then a `ScrollView` with `keyboardShouldPersistTaps="handled"`, holding the handle, the header `Text` (`accessibilityRole="header"`, `text-[18px] font-semibold text-foreground`) and the content.
- **`sheetBottomPadding` and `useKeyboardHeight`:** both live in `apps/mobile/src/lib/use-keyboard-height.ts`.
- **`apps/mobile/src/components/chat/pins-sheet.tsx`** (112 lines, pure view, no hooks):
  - `Modal` with backdrop label "Close pins list";
  - a panel with `max-h-[70%]` and `paddingBottom: 16`;
  - a handle, then the header "Pinned messages ({n})" (`text-[17px]`), the rows, an empty line and an error line.
- **`apps/mobile/src/components/chat/invite-links-sheet.tsx`:** the layout above, with backdrop label "Close invite links", the header "Invite links" and `max-h-[85%]`.
- **The kit:**
  - lives in `apps/mobile/src/components/ui/`;
  - its catalog is `apps/mobile/src/app/dev/kit.tsx`, which has an "Action sheet" section showing how a sample opens a sheet with local state;
  - `kit.test.tsx` shows the `renderToStaticMarkup` + `vi.mock` testing style.
- **Tests:** `apps/mobile/src/components/chat/pins-sheet.test.tsx` and `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`. Each mocks `react-native` by hand.

### What to build
1. **New `apps/mobile/src/components/ui/bottom-sheet.tsx`,** exporting `BottomSheet`:
   - **Props:**
     - `visible: boolean`;
     - `onClose: () => void`;
     - `closeLabel: string` (the backdrop's accessibility label);
     - `title?: string` (rendered as the header `Text`);
     - `maxHeightClassName?: string` (default `'max-h-[85%]'`);
     - `children: ReactNode`.
   - **Render:** exactly the keyboard-aware layout above. The handle comes first, then the `title` (when given), then `children`, all inside the `ScrollView`.
   - Add a doc comment naming T-0299/T-0310.
2. **New test `apps/mobile/src/components/ui/bottom-sheet.test.tsx`,** in the style of `kit.test.tsx`. It checks:
   - the title renders as a header;
   - the backdrop has `closeLabel`;
   - the children render;
   - the custom max height class is applied.
3. **Catalog:** add a "Bottom sheet" section to `app/dev/kit.tsx`, with a button that opens a sample sheet holding a `TextField`, so the keyboard case can be tried.
4. **`pins-sheet.tsx`:**
   - render `<BottomSheet visible={open} onClose={onClose} closeLabel="Close pins list" title={`Pinned messages (${pins.length})`} maxHeightClassName="max-h-[70%]">` around the existing rows, the empty line and the error line;
   - the header becomes 18 px (the kit size);
   - all other texts and labels stay the same.
5. **`invite-links-sheet.tsx`:**
   - use `<BottomSheet visible={visible} onClose={onClose} closeLabel="Close invite links" title="Invite links">` around its content;
   - remove its own `KeyboardAvoidingView`, `ScrollView`, padding and handle code, and imports that become unused.
6. **Tests:** existing tests keep passing. In the two sheet tests you may change mocks, and any element walk that has to go through `BottomSheet`, but every assertion keeps checking the same thing.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/components/ui/text-field.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, both sheets and their tests.

### Allowed files
`apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/ui/bottom-sheet.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/chat/pins-sheet.tsx`, `apps/mobile/src/components/chat/pins-sheet.test.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `work/T-0313-mobile-kit-bottom-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot bottom-sheet pins-sheet invite-links-sheet
pnpm gate
```

### Acceptance
- `BottomSheet` exists, is tested, and shows in the catalog with a field.
- The pins and invite links sheets render through it and keep their texts, labels and behaviour.
- The invite links sheet still sits above the keyboard (same layout, now from the kit).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The other panel sheets (visibility, new topic, group roles, attach, emoji, telegram import, tool detail) move in later tasks.

---

## Report (written by the worker when done)

Done. Kit `BottomSheet` built; pins and invite-links sheets render through it.

What I did:
- New `apps/mobile/src/components/ui/bottom-sheet.tsx`: `BottomSheet` (`visible`, `onClose`, `closeLabel`, `title?`, `maxHeightClassName?` default `'max-h-[85%]'`, `children`) rendering exactly the T-0299/T-0310 keyboard-aware layout (Modal > KeyboardAvoidingView padding-on-iOS > backdrop Pressable > sheet Pressable with `sheetBottomPadding` > ScrollView with handle, optional header `Text` at `text-[18px]`, children). Doc comment names T-0299/T-0310. One deviation: `children` is optional (`children?: ReactNode`, like `ActionSheet`) because oxlint `react(no-children-prop)` forbids passing children as a prop in tests while TS requires it in the props object when passed as a `createElement` argument; callers still pass it.
- New `apps/mobile/src/components/ui/bottom-sheet.test.tsx` (`renderToStaticMarkup` + `vi.mock` style): title-as-header, backdrop `closeLabel`, children render, default `max-h-[85%]` + custom class applied.
- `apps/mobile/src/app/dev/kit.tsx`: new "Bottom sheet" section with a button opening a sample sheet holding a labeled `TextField` (keyboard case triable).
- `apps/mobile/src/components/chat/pins-sheet.tsx`: renders through `BottomSheet` with `closeLabel="Close pins list"`, `title=Pinned messages (n)`, `maxHeightClassName="max-h-[70%]"`; header is now the kit 18 px (was 17 px); rows/empty/error unchanged.
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`: renders through `BottomSheet` (`closeLabel="Close invite links"`, `title="Invite links"`, default max height); its own KeyboardAvoidingView/ScrollView/padding/handle code and now-unused imports removed. Form/labels/buttons/rows unchanged.
- `apps/mobile/src/components/chat/pins-sheet.test.tsx`: added a `../ui/bottom-sheet` stub (pass-through rendering title + children) because the real shell owns hooks that cannot run in that test's function-call walk; all assertions check the same things. `invite-links-sheet.test.tsx` needed no change (it only exercises the pure helpers/views).

Files changed (all inside Allowed files):
`components/ui/bottom-sheet.tsx` (new), `components/ui/bottom-sheet.test.tsx` (new), `app/dev/kit.tsx`, `components/chat/pins-sheet.tsx`, `components/chat/pins-sheet.test.tsx`, `components/chat/invite-links-sheet.tsx`, plus this task file.

Commands (real results):
- `pnpm install`: ok (13.6 s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot bottom-sheet pins-sheet invite-links-sheet`: 3 files, 19 tests passed (string-stub casing warnings only, same as `kit.test.tsx`).
- `pnpm gate` (final): GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/mobile PASS; "scope: every changed file is inside the Allowed files". Intermediate gate runs caught: prettier formatting in the two sheets (fixed with `prettier --write` on those files), oxlint `react(no-children-prop)` in the new test (fixed via `createElement` child args), and a TS overload error from required `children` (fixed by making it optional). No other test files import the migrated modules (checked: only `chat/[id].tsx`, `group/[id].tsx`, `channel-screen.tsx` use them at runtime).

Problems / open questions: none. Security checklist: no secrets, no deletes/updates, no caps, no new routes, no audit entries; invite-link tokens still shown once and never logged.

## Review (written by Claude)

**Approved.** Clean pre-review (3 nits), no fix rounds (Muse, peak).
- `BottomSheet` (`components/ui/bottom-sheet.tsx`) is the T-0299/T-0310 layout in one place: `KeyboardAvoidingView`, the backdrop with `closeLabel`, the panel with `maxHeightClassName`, `sheetBottomPadding`, then a `ScrollView` with the handle and an optional header.
- It has its own test file and a catalog sample with a field.
- The pins and invite links sheets use it.

**Nits, accepted:**
- the pins test stub drops the shell props (the shell is covered by `bottom-sheet.test.tsx`);
- the string-presence assertions follow the kit style;
- the pins header lost its `py-2`. QA will check the spacing.

**Next:** move the remaining panel sheets onto it.
