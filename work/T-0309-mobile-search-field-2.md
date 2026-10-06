---
id: T-0309
title: "Mobile kit migration: chat list search and Stickers discover search use the kit SearchField"
status: todo
milestone: M5
branch: task/T-0309-mobile-search-field-2
model: auto
effort: low
depends_on: [T-0308]
estimate: 0.2 day
---

# T-0309: SearchField, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0308 added the kit `SearchField` (`apps/mobile/src/components/ui/search-field.tsx`) and moved the group topics search and Explore onto it. Two hand-rolled search bars remain; this task moves them. Read `work/T-0308-mobile-kit-search-field.md` (Report) first.

### Verified facts (do not re-derive)
- **`SearchField`:**
  - props: every `TextInput` prop, plus `icon` (default `Search`), `onClear`, `clearLabel` (default `"Clear search"`) and `containerClassName`;
  - it renders a `h-10 … rounded-xl px-3` well row with a muted 16 px icon;
  - it shows a clear `X` only when `onClear` is given and `value` is non-empty.
- **`apps/mobile/src/app/(tabs)/index.tsx`, lines 208-232:** the open search header.
  - a `View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}`;
  - inside it, `<Search size={16} color="#8a8a8a" />`;
  - a `TextInput` with `autoFocus`, `value={search}`, `onChangeText={onSearchChange}`, `onSubmitEditing={() => setSubmitRequest((count) => count + 1)}`, `placeholder="Search, or type @username"`, `accessibilityLabel="Search chats, messages and people"`, `returnKeyType="search"`, `autoCapitalize="none"` and `autoCorrect={false}`;
  - when `search.length > 0`, a `Pressable` with `accessibilityLabel="Clear search"` and `onPress={() => onSearchChange('')}`, holding `X`.
  - The closed search pill at lines 247-262 is a `Pressable` button, not a field. **Leave it unchanged**, apart from its `Search` icon colour: `#8a8a8a` becomes `MUTED_FOREGROUND[scheme]`.
- **`apps/mobile/src/app/settings/stickers.tsx`, lines 457-472:** the discover bar.
  - a `View className="h-10 flex-row items-center gap-2 rounded-xl px-3" style={well}`;
  - inside it, a `Search` icon and a `TextInput` with `value={query}`, `onChangeText={setQuery}`, `onSubmitEditing={() => loadDiscover(query)}`, `maxLength={60}`, `returnKeyType="search"`, `placeholder="Search shared packs"`, `accessibilityLabel="Search sticker packs"`, `autoCapitalize="none"` and `autoCorrect={false}`;
  - `well`, `MUTED_FOREGROUND` and `TextInput` may still be used elsewhere in the file (e.g. line 288 uses `well`), so check before removing an import.
- **Tests:**
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx` imports the Stickers screen;
  - no test imports `(tabs)/index.tsx`.

### What to build
1. **Chat list:** the open search header becomes `<SearchField containerClassName="flex-1" … same props … onClear={() => onSearchChange('')} />`.
   - The clear label stays "Clear search", which is the default.
   - Recolour the closed pill's `Search` icon as described above.
   - Remove imports that become unused.
2. **Stickers:** the discover bar becomes `<SearchField … same props … />`. Remove imports that become unused.
3. **Tests:** existing tests keep passing. Change `stickers-screen.test.tsx` only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/search-field.tsx`, `work/T-0308-mobile-kit-search-field.md` (Report), the two screens and the test.

### Allowed files
`apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx` (mocks only), `work/T-0309-mobile-search-field-2.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen
pnpm gate
```

### Acceptance
- Both bars render through `SearchField`. No `#8a8a8a` is left in `(tabs)/index.tsx`, and the clear button still clears the search.
- Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
