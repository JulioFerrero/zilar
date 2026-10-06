---
id: T-0311
title: "Mobile kit migration: GIF search uses SearchField and the Telegram import link field uses TextField"
status: merged
milestone: M5
branch: task/T-0311-mobile-gif-telegram-fields
model: auto
effort: low
depends_on: [T-0309]
estimate: 0.1 day
---

# T-0311: GIF search and Telegram import field on the kit

## Spec (written by Claude, do not edit)

### Why
These are the last two plain mobile fields outside the kit:
- the GIF panel search, which uses an old flat look and a hard-coded `#a1a1a1`;
- the Telegram sticker import link field, which uses a hand-rolled well wrapper.

The kit has `TextField` (`apps/mobile/src/components/ui/text-field.tsx`) and `SearchField` (`apps/mobile/src/components/ui/search-field.tsx`, from T-0308). Read the T-0309 Report in `work/T-0309-mobile-search-field-2.md` first.

### Verified facts (do not re-derive)
- **`SearchField`:**
  - a `h-10 … rounded-xl px-3` well row with a muted 16 px icon (default `Search`);
  - every `TextInput` prop passes through;
  - `containerClassName` goes on the row, and `className` on the input.
- **`TextField`:**
  - a well-look `TextInput` (`rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`);
  - a default muted placeholder colour;
  - `className` merged with `cn`.
- **`apps/mobile/src/components/chat/gif-panel.tsx`:**
  - lines 236-249: `<View className="p-2">` wrapping a `TextInput`;
  - the `TextInput` has `value={query}`, an inline `onChangeText` that sets the query, stores `queryRef` and calls `scheduleSearch`, `placeholder="Search GIFs"`, `placeholderTextColor="#a1a1a1"`, `accessibilityLabel="Search GIFs"` and `className="w-full rounded-[8px] bg-surface-raised px-3 py-1.5 text-[13px] text-foreground"`;
  - line 3 imports `TextInput`.
- **`apps/mobile/src/components/stickers/telegram-import-sheet.tsx`:**
  - line 281: a wrapper `View className="mt-3 h-11 justify-center rounded-xl px-3" style={well}`;
  - inside it, a `TextInput` (lines 282-297) with `value`, `onChangeText`, `onSubmitEditing`, `maxLength={512}`, `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="url"`, `returnKeyType="go"`, `autoFocus`, `editable={!busy}`, `placeholder="t.me/addstickers/FunCats"`, `placeholderTextColor={MUTED_FOREGROUND[scheme]}`, `accessibilityLabel="Pack link or name"` and `className="text-[15px] text-foreground"`;
  - `MUTED_FOREGROUND` and `scheme` are also used at lines 207 and 300, so keep them;
  - `well` (line 17) may become unused.
- **Tests:**
  - `apps/mobile/src/components/chat/gif-panel.test.tsx` does not mock `nativewind`, so it probably needs that mock, and maybe a `lucide-react-native` mock;
  - `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` already mocks `nativewind`.

### What to build
1. **gif-panel:**
   - keep the `View className="p-2"`; inside it, the field becomes `<SearchField … />` with the same `value`, `onChangeText`, `placeholder` and `accessibilityLabel`;
   - drop the `#a1a1a1` and the old classes;
   - remove `TextInput` from the import if it is no longer used.
2. **telegram-import-sheet:**
   - the wrapper and its `TextInput` become one `<TextField className="mt-3 h-11" … same props except placeholderTextColor … />`;
   - remove `TextInput` and `well` from the imports if they are no longer used.
3. **Tests:** existing tests keep passing. Change the two test files only to add mocks (see the pitfall in `docs/LEAD_HANDOFF.md`).

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), the two kit files, `work/T-0309-mobile-search-field-2.md` (Report), the two components and their tests.

### Allowed files
`apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`, `apps/mobile/src/components/chat/gif-panel.test.tsx` (mocks only), `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/emoji-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/composer-gifs.test.tsx` (mocks only), `apps/mobile/src/components/chat/composer-mentions.test.ts` (mocks only), `work/T-0311-mobile-gif-telegram-fields.md`. (The last three test files were added by the lead after the worker's BLOCKED: they reach `GifPanel` through `emoji-sheet.tsx` and `composer.tsx`.)

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot gif-panel telegram-import-sheet
pnpm gate
```

### Acceptance
- The GIF search renders through `SearchField` and the Telegram link field through `TextField`.
- No `#a1a1a1` is left in `gif-panel.tsx`.
- The debounced GIF search and the import submit behave as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. Both plain mobile fields now render through the kit, and `pnpm gate`
ends with GATE PASS.

What I did:
- `apps/mobile/src/components/chat/gif-panel.tsx`: the `View className="p-2"`
  search wrapper now holds `<SearchField value={query} onChangeText={...}
  placeholder="Search GIFs" accessibilityLabel="Search GIFs" />` with the same
  query/queryRef/scheduleSearch handler. Dropped `#a1a1a1` and the old classes;
  removed `TextInput` from the `react-native` import, added the `SearchField`
  import.
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`: the
  hand-rolled well `View` + `TextInput` became one
  `<TextField className="mt-3 h-11" value onChangeText onSubmitEditing
  maxLength={512} autoCapitalize="none" autoCorrect={false} keyboardType="url"
  returnKeyType="go" autoFocus editable placeholder accessibilityLabel />`
  (placeholderTextColor dropped — the kit fills it; `MUTED_FOREGROUND`/`scheme`
  kept, still used at lines 207/300). Removed `TextInput` from the
  `react-native` import and the `well` import; added the `TextField` import.
- Mocks only, no assertion changed:
  - `gif-panel.test.tsx`: added `nativewind` (`useColorScheme` → dark) and
    `lucide-react-native` (`Search`/`X`) mocks, which `SearchField` needs.
  - `emoji-sheet.test.tsx` (reaches `GifPanel` via `EmojiSheet`; added to
    Allowed files after my BLOCKED round): added `Search: 'Search',
    X: 'X'` to the `lucide-react-native` mock and `MUTED_FOREGROUND` to the
    `@/lib/colors` mock, both needed by `SearchField`. The second entry only
    surfaced after the first (`No "MUTED_FOREGROUND" export is defined on the
    "@/lib/colors" mock`).
  - `telegram-import-sheet.test.tsx`, `composer-gifs.test.tsx`,
    `composer-mentions.test.ts`: no changes needed — the first already mocks
    everything `TextField` needs, and the two composer tests pass unchanged
    (57-test run below covers them).
- `telegram-import-sheet.test.tsx`: no changes needed — it already mocks
  `nativewind`, `lucide-react-native`, `@/lib/colors`, `@/lib/color-scheme`
  and `@/lib/depth`; `TextField`'s remaining deps (`@/lib/utils`,
  `@/components/ui/text`) are pure/already mocked.

Files changed:
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/chat/gif-panel.test.tsx` (mocks only)
- `apps/mobile/src/components/chat/emoji-sheet.test.tsx` (mocks only)
- `work/T-0311-mobile-gif-telegram-fields.md` (this report)

Commands and real results:
- `pnpm install`: exit 0 (~17 s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  emoji-sheet composer-gifs composer-mentions gif-panel telegram-import-sheet`:
  5 files passed, 57 tests passed.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS tests @zilar/mobile`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`
  (5 changed files against main).
- Verified: no `#a1a1a1` and no `TextInput` left in `gif-panel.tsx`; no `well`
  and no `TextInput` left in `telegram-import-sheet.tsx` (grep, no matches).
- Note: the first gate run failed on `emoji-sheet.test.tsx` (missing `Search`
  mock, then missing `MUTED_FOREGROUND` mock); I stopped per AGENTS.md §3, the
  lead widened the Allowed files, and the mocks-only fix above resolved it.
  No assertions were changed in any test file.

Security checklist: no secrets/tokens touched; no deletes/updates; no caps;
no permission changes; no new routes; no audit entries. N/A in full —
UI-only change.

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), after one lead unblock: the scope grew to the transitive test `emoji-sheet.test.tsx` (the pitfall is now in `docs/LEAD_HANDOFF.md`).
- The GIF search uses `SearchField`, with no `#a1a1a1` left in the component.
- The Telegram link field uses `TextField` with `mt-3 h-11`.
- The test changes are mock entries only (lucide `Search` and `X`, `nativewind`, colours); the `#a1a1a1` in the gif-panel test is a mock value.
- The composer tests needed nothing.

The plain mobile fields are now all on the kit.
