---
id: T-0308
title: "Mobile kit: SearchField (icon + well + optional clear); group topics search and Explore use it"
status: merged
milestone: M5
branch: task/T-0308-mobile-kit-search-field
model: auto
effort: low
depends_on: [T-0306]
estimate: 0.3 day
---

# T-0308: mobile kit SearchField

## Spec (written by Claude, do not edit)

### Why
Four mobile screens hand-roll the same search bar:
- a `View className="h-10 … flex-row items-center gap-2 rounded-xl px-3" style={well}`;
- a 16 px icon, often coloured with a hard-coded `#8a8a8a`;
- a bare `TextInput className="flex-1 text-[15px] text-foreground"`.

This task adds a kit `SearchField` and moves the two simplest bars onto it. A later task does the chat list (it has a clear button) and Stickers.

### Verified facts (do not re-derive)
- **The kit:** lives in `apps/mobile/src/components/ui/`.
  - `text-field.tsx` is the closest model: it takes the colour scheme from `useColorScheme` (nativewind) with `asColorScheme`, fills the placeholder from `MUTED_FOREGROUND[scheme]` (`@/lib/colors`), and merges `className` with `cn`.
  - Tests are in `apps/mobile/src/components/ui/kit.test.tsx` (`renderToStaticMarkup`, with `react-native`, `nativewind` and `lucide-react-native` mocked at lines 16-35). The `TextField` tests start at line 212.
  - The catalog screen is `apps/mobile/src/app/dev/kit.tsx`; its "Text field" section is at lines 130-147.
- **`well`:** exported from `apps/mobile/src/lib/depth.ts:72` (`backgroundColor`, `borderWidth: 1`, `borderColor`, `boxShadow`).
- **`apps/mobile/src/app/group/[id].tsx`, lines 531-543:**
  - the "Search topics" bar: `View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}`;
  - inside it, `<Search size={16} color="#8a8a8a" />` and a `TextInput` (`value={search}`, `onChangeText={setSearch}`, `placeholder="Search topics"`, `placeholderTextColor={MUTED_FOREGROUND[scheme]}`, `accessibilityLabel="Search topics"`);
  - the file still uses `ICON[scheme]` elsewhere, and `well` and `MUTED_FOREGROUND` may be used elsewhere too, so check before removing an import.
- **`apps/mobile/src/app/explore.tsx`, lines 199-212:**
  - the same bar without `flex-1`, with `<Compass size={16} color="#8a8a8a" />`;
  - its `TextInput` has `maxLength={100}`, `placeholder="Search by name or @handle"`, `accessibilityLabel="Search public groups and channels"`, `autoCapitalize="none"` and `autoCorrect={false}`.
- **Tests that import the group screen:** `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx` and `apps/mobile/src/components/directory/handle-route.test.ts`. No test imports `explore.tsx`.

### What to build
1. **New `apps/mobile/src/components/ui/search-field.tsx`,** exporting `SearchField`.
   - **Props:** every `TextInput` prop, plus:
     - `icon?: LucideIcon`, defaulting to `Search` from `lucide-react-native`;
     - `onClear?: () => void` and `clearLabel?: string` (default `"Clear search"`);
     - `containerClassName?: string`.
   - **Render:** a `View` with `className={cn('h-10 flex-row items-center gap-2 rounded-xl px-3', containerClassName)}` and `style={well}`, holding:
     - the icon at `size={16}`, `color={MUTED_FOREGROUND[scheme]}`;
     - a `TextInput` with `className={cn('flex-1 text-[15px] text-foreground', className)}`, the placeholder colour defaulting to `MUTED_FOREGROUND[scheme]`, and the other props passed through;
     - when `onClear` is given **and** `value` is a non-empty string, a `Pressable` (`accessibilityRole="button"`, `accessibilityLabel={clearLabel}`, `onPress={onClear}`) holding `<X size={16} color={MUTED_FOREGROUND[scheme]} />`.
   - Add a doc comment in the style of `text-field.tsx`.
2. **Tests in `kit.test.tsx`:** a `describe('SearchField')` that checks:
   - the default placeholder colour;
   - a custom icon renders instead of `Search`;
   - the clear button appears only with `onClear` and a non-empty value.

   Extend the `lucide-react-native` mock there if needed.
3. **Catalog:** in `app/dev/kit.tsx`, add a "Search field" section after "Text field", with a plain one and one with a working clear (local state).
4. **Group screen:** in `app/group/[id].tsx`, replace the topics search bar with `<SearchField containerClassName="flex-1" value={search} onChangeText={setSearch} placeholder="Search topics" accessibilityLabel="Search topics" />`. Remove imports that become unused (`Search`, `TextInput`, `well`, `MUTED_FOREGROUND`), but only if nothing else in the file uses them.
5. **Explore:** in `app/explore.tsx`, replace its bar with `<SearchField icon={Compass} …same props… />`. Remove imports that become unused.
6. Existing tests keep passing. Change the three listed test files only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/lib/depth.ts`, and the two screens.

### Allowed files
`apps/mobile/src/components/ui/search-field.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx` (mocks only), `apps/mobile/src/components/chat/group-roles-load.test.tsx` (mocks only), `apps/mobile/src/components/directory/handle-route.test.ts` (mocks only), `work/T-0308-mobile-kit-search-field.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit group-roles handle-route
pnpm gate
```

### Acceptance
- `SearchField` exists, is tested, and shows in the `zilar://dev/kit` catalog.
- The group topics search and the Explore search use it, with no `#8a8a8a` left in those two bars.
- Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The chat list search (`app/(tabs)/index.tsx`) and the Stickers discover search (`app/settings/stickers.tsx`) come in a later task.

---

## Report (written by the worker when done)

Done. New kit `SearchField` with tests, catalog entry, and both screens migrated.

What I did:
- New `apps/mobile/src/components/ui/search-field.tsx`: exports `SearchField`. Props are every
  `TextInput` prop plus `icon?: LucideIcon` (default `Search`), `onClear?: () => void`,
  `clearLabel` (default `"Clear search"`), `containerClassName?: string`. Renders a `View` with
  `cn('h-10 flex-row items-center gap-2 rounded-xl px-3', containerClassName)` + `style={well}`,
  icon at 16 px in `MUTED_FOREGROUND[scheme]`, `TextInput` with
  `cn('flex-1 text-[15px] text-foreground', className)` and placeholder defaulting to
  `MUTED_FOREGROUND[scheme]`, plus a `Pressable` clear button (`accessibilityRole="button"`,
  `accessibilityLabel={clearLabel}`) with `X` at 16 px only when `onClear` is set and `value`
  is a non-empty string. Doc comment in the `text-field.tsx` style.
- `kit.test.tsx`: extended the `lucide-react-native` mock with `Compass`, `Search`, `X`; added
  `describe('SearchField')` with 3 tests (default placeholder colour, custom icon instead of
  `Search`, clear button only with `onClear` + non-empty value).
- `app/dev/kit.tsx`: "Search field" section after "Text field" with a plain one and one with a
  working clear (local state `search`/`setSearch`, initial `'Try clearing me'`).
- `app/group/[id].tsx`: topics bar replaced with
  `<SearchField containerClassName="flex-1" value={search} onChangeText={setSearch}
  placeholder="Search topics" accessibilityLabel="Search topics" />`. Removed now-unused imports:
  `Search` (lucide), `TextInput` (react-native), `MUTED_FOREGROUND` (kept `ICON`), `well`
  (removed the whole `@/lib/depth` line — its only use). `scheme` still used via `ICON[scheme]`.
- `app/explore.tsx`: bar replaced with `<SearchField icon={Compass} value={query}
  onChangeText={setQuery} maxLength={100} placeholder="Search by name or @handle"
  accessibilityLabel="Search public groups and channels" autoCapitalize="none"
  autoCorrect={false} />`. `Compass` stays imported (used as the `icon` prop). Removed
  `TextInput`, `MUTED_FOREGROUND` (kept `ICON`), and the `@/lib/depth` line.
- No changes to the three listed test files: they don't import the group screen as a module
  (`group-roles-*.test.tsx` read `app/group/[id].tsx` as text / mirror its logic;
  `handle-route.test.ts` imports only `handle-helpers`), so no new mocks were needed.

Files changed:
- `apps/mobile/src/components/ui/search-field.tsx` (new)
- `apps/mobile/src/components/ui/kit.test.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/explore.tsx`
- `work/T-0308-mobile-kit-search-field.md` (this report)

Commands and real results:
- `pnpm install`: done, exit 0 (~12 s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit group-roles handle-route`:
  5 test files passed, 38 tests passed (the `<View /> is using incorrect casing` lines are
  pre-existing mock noise, not failures).
- `pnpm gate` (first run): FAIL on `format` only — my 2 files needed Prettier; fixed with
  `pnpm exec prettier --write` on those 2 files.
- `pnpm gate` (final): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`,
  `GATE PASS`.
- Verified: no `#8a8a8a` remains in `app/group/[id].tsx` or `app/explore.tsx` (grep hit only the
  two `SearchField` usages); placeholder texts, labels, `maxLength`, `autoCapitalize`,
  `autoCorrect` unchanged.

Security checklist: no secrets/tokens touched; no deletes/updates; no caps; no permission
changes; no new routes; no audit entries. N/A in full — UI-only change.

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), no fix rounds (Muse, peak).
- `SearchField` (`components/ui/search-field.tsx`) is a well row with a muted icon (default `Search`). It shows a clear button only with `onClear` and a non-empty value, and `className` and `containerClassName` merge with `cn`.
- Kit tests and a catalog section were added.
- Group topics search and Explore (with `Compass`) use it, and no `#8a8a8a` is left in those bars.

**Still to do:**
- the chat list search (clear button) and the Stickers discover search, in a follow-up;
- emulator QA in the next run.
