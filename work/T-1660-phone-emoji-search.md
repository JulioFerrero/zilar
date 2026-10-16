---
id: T-1660
title: "Phone emoji search (parity audit gap 8): a shared lowercase emoji-name table plus searchEmoji in packages/chat-core, and a Search emoji field on the phone Emoji tab that filters every category by name, like web's WUX-26 tab"
status: merged
milestone: M5
branch: task/T-1660-phone-emoji-search
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1660: Emoji search on the phone

## Spec (written by Claude, do not edit)

### Why
Web's Emoji tab has a search box: "heart" finds ❤️ (WUX-26, `apps/web/src/components/sticker/EmojiTab.tsx:6-17`). The phone Emoji tab only has categories (`docs/audit/parity-2026-10-16.md`, gap 8). The phone's emoji list is plain glyphs with no names, so there's nothing to search.

### Facts (the lead read them on 2026-10-16)
- **Web:** `apps/web/src/components/sticker/emoji.ts` (134 lines) has `EmojiEntry { emoji; name; category }` with lowercase names. `EmojiTab.tsx:17` filters with `entry.name.includes(trimmed) || entry.emoji === trimmed`, shows "No emoji found." (`:34`), and uses `SearchField` with the placeholder and `aria-label` "Search emoji" (`:24-28`).
- **Phone:** `apps/mobile/src/lib/emoji-data.ts` (435 lines): `EMOJI_BY_CATEGORY: Record<EmojiCategoryId, readonly string[]>` (`:37-…`), with nine categories (`smileys` … `symbols`), plain strings.
- **`apps/mobile/src/components/chat/emoji-tab.tsx`** (156 lines), `EmojiTab({ open, recents, activeCategory, onSelectCategory, onPick })` (`:53-59`):
  - `active` and `emoji` are computed at `:64-67`;
  - a horizontal category `ScrollView` (`:69-…`), then the grid (`EMOJI_GRID_COLUMNS = 8`, `:45`).
- **The phone search input:** `apps/mobile/src/components/ui/search-field.tsx` exports `SearchField` (TextInput props).
- **`packages/chat-core/src/`** has `emoji.ts` (28 lines, `isBigEmoji`), exported from `index.ts:11`. There's no `emoji-names.ts`.

### Steps
1. **Add `packages/chat-core/src/emoji-names.ts`:**
   - `export const EMOJI_NAMES: Readonly<Record<string, string>>` maps **every glyph in the phone's `EMOJI_BY_CATEGORY`** to a lowercase name plus a few space-separated keywords (e.g. `'❤️': 'red heart love'`, `'😂': 'face with tears of joy laugh lol'`);
   - `export function searchEmoji(query: string, glyphs: readonly string[]): string[]`: trim and lowercase the query; return `[]` when it's empty; otherwise return the glyphs, in order and without duplicates, whose name includes the query, or that equal the query;
   - keep the file within 400 lines (one entry per line);
   - export it from `packages/chat-core/src/index.ts` next to `./emoji`.
2. **In `emoji-tab.tsx`:**
   - add local `query` state and a `SearchField` (placeholder "Search emoji", `accessibilityLabel` "Search emoji") above the category strip;
   - when the query is non-empty, hide the category strip and show `searchEmoji(query, all glyphs of every category)` in the same grid, or a muted "No emoji found." line;
   - clear the query when `open` turns false;
   - tapping a result calls `onPick`, as today.
3. **No web change** (web keeps its own list for now). No tests (UI and data).

### Allowed files
- `packages/chat-core/src/emoji-names.ts`
- `packages/chat-core/src/index.ts`
- `apps/mobile/src/components/chat/emoji-tab.tsx`
- `work/T-1660-phone-emoji-search.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Typing "heart" on the phone Emoji tab shows the heart emoji,** and tapping one inserts it.
- **An empty query shows the categories as before.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- Added `packages/chat-core/src/emoji-names.ts` (298 lines): `EMOJI_NAMES`, a
  `Readonly<Record<string, string>>` mapping **all 266 glyphs** of the phone's
  `EMOJI_BY_CATEGORY` to a lowercase name plus a few keywords, and
  `searchEmoji(query, glyphs)`, which trims and lowercases the query, returns `[]`
  for an empty query, and otherwise returns the glyphs (in order, no duplicates)
  whose name includes the query or that equal it.
- Exported it from `packages/chat-core/src/index.ts`, right after `./emoji`.
- `apps/mobile/src/components/chat/emoji-tab.tsx`: added a `SearchField`
  (placeholder and `accessibilityLabel` "Search emoji") above the category strip.
  When the query is non-empty the strip is hidden and the grid shows
  `searchEmoji(query, every glyph of every category)`, or the muted
  "No emoji found." line when nothing matches. Tapping a result calls `onPick`, as
  before. A non-empty query no longer shows the empty-recents hint.
- No web change; no tests added (UI and data, per the spec).

Files changed: `packages/chat-core/src/emoji-names.ts` (new),
`packages/chat-core/src/index.ts`,
`apps/mobile/src/components/chat/emoji-tab.tsx`,
`work/T-1660-phone-emoji-search.md`.

### Checks run

- `pnpm install` in the worktree: succeeded.
- `pnpm gate` (1st run): **GATE FAIL** — `lint` reported
  `apps/mobile/src/components/chat/emoji-tab.tsx:71:7: react(set-state-in-effect)`.
  Fixed by moving the search state into a child (`EmojiTabBody`) that unmounts
  while the sheet is closed, so the query resets on reopen without an effect.
- `pnpm gate` (final run): **GATE PASS**, all steps green:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (4.0s)
  PASS  format  (2.7s)
  PASS  lint  (4.1s)
  PASS  typecheck  (3.2s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/chat-core  (5.2s)
  PASS  tests @zilar/mobile  (2.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did not run a single test file on its own: no test file is named after the
  changed files. The gate's nearest-test step ran `tests @zilar/chat-core` and
  `tests @zilar/mobile`; both passed (detail above).
- Ad-hoc data check (a `node` script that reads the two source files as text; no
  repo files touched): 266 entries, 266 glyphs, 0 missing keys;
  `searchEmoji('heart')` returns 22 glyphs including ❤️; `'pizza'` returns 🍕;
  whitespace-only and unknown queries return `[]`.

### Notes for the lead

- **Deviation (flagged):** the spec says "clear the query when `open` turns false".
  A `useEffect` doing `setQuery('')` is blocked by oxlint's
  `react(set-state-in-effect)`. Instead the body component unmounts when `open` is
  false, so its `query` state is discarded and reopening starts empty. Observable
  behavior is the same as specified.
- `searchEmoji` matches substrings, so e.g. "heart" also returns 🥰 and 😍 (their
  names contain "heart"). This mirrors the web tab's `name.includes(query)`.
- Names were not reused from web's `emoji.ts`; the spec keeps web's list separate.
- Honesty: the acceptance behavior ("typing heart shows the heart emoji and
  tapping inserts it") is verified at the data/search level above; I did not run it
  on a device or via `pnpm phone:smoke`.

## Review (written by Claude)

**Approved and merged.** This is parity gap 8.

- **Pre-review:** clean, 0 nits.
- **The names table:** `packages/chat-core/src/emoji-names.ts` (298 lines) names all 266 phone glyphs. The lead checked the coverage with a script: 0 missing. Sample searches: "heart" → 22 hearts, "laugh" → 😆🤣😂, "dog" → 🐶🌭.
- **The tab:** it gains a "Search emoji" field; a query hides the category strip and shows "No emoji found." when nothing matches. The query resets when the sheet closes, because the body unmounts.
- **Gap (a data matter, not this task's):** the phone table has no 🔥.
- **Still to check:** the emulator check rides on the combined phone QA pass after T-1663.
