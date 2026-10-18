---
id: T-1948
title: "Phone UI consistency M1: one ScreenHeader kit component; the three root tabs get the same 28/600 title and every settings/AIs sub-screen gets the same back row + 28/600 title"
status: merged
milestone: M5
branch: task/T-1948-phone-screen-header
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1947]
estimate: 40 min
---

# T-1948: Phone ScreenHeader (M1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **M1** of `docs/audit/ui-consistency.md` §5 (T-1947). The targets are in §1.1 and §1.2, and the API in §4.1.

**What the lead measured on the emulator:**
- the root titles differ: Chats is 28 px (`apps/mobile/src/components/chat/search-header.tsx:53-55`), while Settings and My AIs are 20 px. Both get their title from a shell:
  - `apps/mobile/src/components/settings/screen-shell.tsx:52`, used by `app/(tabs)/settings.tsx:238`;
  - `apps/mobile/src/components/ais/screen-shell.tsx:46`, used by `app/(tabs)/ais.tsx:244`;
- sub-screens mix a 20 px inline title and a `largeTitle` 28 px title below the back row (`settings/screen-shell.tsx:19-22`, `:75-83`).

### Facts (read by the lead on 2026-10-18)
- **`apps/mobile/src/components/settings/screen-shell.tsx`** (90 lines):
  - props `title`, `subtitle`, `onBack`, `right`, `largeTitle` (`:12-24`);
  - the header row `flex-row items-center py-2`, with a back `IconButton` and `ChevronLeft size={24}` (`:38-64`);
  - the large title inside the scroll body (`:75-83`).
- **`apps/mobile/src/components/ais/screen-shell.tsx`** (82 lines): the same header row (`:36-56`), plus `scroll` and `footer` (`:57-80`).
- **`apps/mobile/src/components/chat/search-header.tsx`** (75 lines): the Chats title at `:52-55`, `gap-2 px-4 py-2`.
- **The kit** is in `apps/mobile/src/components/ui/`: `icon-button.tsx`, `text.tsx`. There is no `screen-header.tsx`.

### Steps
1. **New `apps/mobile/src/components/ui/screen-header.tsx`**, with the props from audit §4.1: `variant: 'root' | 'sub'`, `title`, `subtitle?`, `onBack?`, `right?`, `bare?`, `testID?`.
   - **`root`:** one row, `px-4 pt-2`, holding the title at 28/600, line-height 36, tracking `-0.02em`. `right`, if given, sits at the row's right end (for example the My AIs **+**). Below it is an 8 px gap.
   - **`sub`:**
     - a 56 dp row with the back `IconButton` (40×40, `ChevronLeft size={24}`, `label="Back"`) at 4 dp from the left, and `right` at 16 dp from the right;
     - then the title at 28/600, line-height 36, tracking `-0.02em`, with margins 4 top, 16 sides, 16 bottom;
     - then the optional subtitle at 14/400, `text-muted-foreground`, one line, 2 dp under the title.
   - **`bare`:** only the 56 dp row, no title.
   - The caller owns the safe area. `accessibilityRole="header"` goes on the title.
2. **`settings/screen-shell.tsx` and `ais/screen-shell.tsx`** render `ScreenHeader`:
   - `variant="root"` when `onBack` is undefined, `variant="sub"` otherwise, passing `title`, `subtitle` and `right`.
   - In `sub`, the title sits in the fixed header above the `ScrollView` (not inside it), so every sub-screen looks alike.
   - Delete the old inline header rows and the `largeTitle` large-title block.
   - Keep the `largeTitle` prop for now as a no-op (callers pass it), with a `// T-1948: every sub screen now has the large title` comment.
   - The rest of each shell (scroll, padding, footer) doesn't change.
3. **`search-header.tsx`:** render the Chats title through `ScreenHeader variant="root" title="Chats"` and keep the search well under it, as now.
4. **No other screens change in this batch.** Screens with their own hand-made headers move in M3–M10.
5. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/mobile/src/components/ui/screen-header.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/chat/search-header.tsx`
- `work/T-1948-phone-screen-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks phone smoke screenshots of `/`, `/ais`, `/settings`, `/settings/profile`, `/settings/stickers` and `/settings/devices`:
- the three root titles are the same 28/600 on the same baseline;
- every settings sub-screen shows the 56 dp back row, then the 28/600 title (and subtitle where it had one);
- Save on `/settings/profile` stays in the back row.

The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/ui/screen-header.tsx`: the `ScreenHeader` kit component with `variant: 'root' | 'sub'`, `title`, `subtitle`, `onBack`, `right`, `bare` and `testID`.
  - `root`: one `px-4 pt-2 pb-2` row, title at 28/600, line-height 36, tracking `-0.02em`, `right` at the row's end, 8 px gap below.
  - `sub`: a 56 dp (`h-14`) row with the back `IconButton` (40×40, `ChevronLeft size={24}`, `label="Back"`) 4 px from the left and `right` 16 px from the right, then the title at 28/600 with margin `4px 16px 16px`, then the optional 14/400 muted subtitle 2 px under it. `bare` draws only the row.
  - `accessibilityRole="header"` is on the title; the caller owns the safe area.
- `settings/screen-shell.tsx` and `ais/screen-shell.tsx` now render `ScreenHeader` (`root` when `onBack` is undefined, `sub` otherwise) and pass `title`, `subtitle` and `right`. The old inline header rows and the in-scroll large-title block are gone. `largeTitle` stays in the props as a no-op with the `// T-1948: every sub screen now has the large title` note; scroll, body padding and footer are unchanged.
- `search-header.tsx`: the Chats title now goes through `ScreenHeader variant="root" title="Chats"`, and the search well sits 8 px under it. The open-search branch (search field + Cancel) is unchanged.

### Checks run

- `pnpm install` — done, 1299 packages resolved. It warns that `apps/mobile`'s `@types/react-dom 19.3.0` has an unmet peer `@types/react@^19.3.0` (found 19.2.18); this is pre-existing and unrelated.
- `pnpm gate` (from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.4s)
  PASS  lint  (1.7s)
  PASS  typecheck  (5.1s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: this is UI-only and the spec says no tests.
- I did not run the emulator/screenshot smoke; that is the lead's acceptance step.

### Notes for the lead

- `bare` and `testID` are implemented but not used by these two shells yet; they are there for the M3–M10 screens from the audit.
- `largeTitle` is accepted and ignored by `SettingsScreenShell`; callers (`stickers.tsx`, `sticker-pack.tsx`) still pass it.
- One spacing detail to confirm on the phone smoke: the root header itself ends with an 8 px gap, and the shells' scroll body keeps its `p-4`, so the first content block under Settings/My AIs is 16 px below that gap (24 px total). I left the shell padding unchanged as the spec says; if the boards want exactly 8 px there, the body's top padding is the knob.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 0 findings. The lead checked the phone smoke (mock build of `ea513cb98`):
- **Root titles:** Chats, My AIs and Settings now show the same 28/600 title. My AIs and Settings were 20 px before.
- **Sub-screens:** `/settings/profile` and `/settings/stickers` show the 56 dp back row, with Save or + on the right, then the 28/600 title and subtitle.

`/settings/devices` still shows its old inline header, because it draws its own instead of using the shell. That's batch M4 (T-1960); the spec's acceptance list wrongly included it here.

The 24 px gap under the root title is left as is, since the D24 boards show a similar gap.

