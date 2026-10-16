---
id: T-1673
title: "One emoji table for web and phone: move the phone's category table into packages/chat-core, add the 31 glyphs only web had, and switch web's Emoji tab to the shared table, names and searchEmoji (web goes from 102 to ~330 emoji; its own emoji.ts list is deleted)"
status: merged
milestone: M5
branch: task/T-1673-shared-emoji-table
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1673: Shared emoji table

## Spec (written by Claude, do not edit)

### Why
Web and phone keep two separate emoji lists:
- **web:** 102 entries with names in 7 categories (`apps/web/src/components/sticker/emoji.ts`);
- **phone:** 297 glyphs in 9 categories (`apps/mobile/src/lib/emoji-table.ts`, T-1665), with names in `packages/chat-core/src/emoji-names.ts` (T-1660).

The lead compared them on 2026-10-16. 31 of web's glyphs aren't on the phone, and about 220 of the phone's aren't on web. Shared data belongs in the packages.

### Facts (the lead read them on 2026-10-16, main after T-1669)
- **`apps/mobile/src/lib/emoji-table.ts`** (351 lines): `EmojiCategoryId` (nine ids: smileys, people, hearts, animals, food, activities, travel, objects, symbols), `EmojiCategory`, `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY`. `apps/mobile/src/lib/emoji-data.ts` (123 lines) re-exports them from `./emoji-table`.
- **`packages/chat-core/src/emoji-names.ts`** (329 lines): `EMOJI_NAMES` and `searchEmoji(query, glyphs)`, exported from `packages/chat-core/src/index.ts`.
- **Web:**
  - `apps/web/src/components/sticker/EmojiTab.tsx` (82 lines) imports `EMOJI`, `EMOJI_CATEGORIES` and `EmojiEntry` from `./emoji` (its only importer);
  - it filters with `entry.name.includes(trimmed) || entry.emoji === trimmed`, shows one header per category, and labels each button `` `Insert ${entry.emoji} (${entry.name})` `` with `title={entry.name}`.
- **The 31 web-only glyphs:** 😢 😡 😳 🫶 🌈 ☀️ 🌙 ⚡ ❄️ 🌸 🌻 🌹 🌵 🌊 🍣 🍰 🍺 🍷 🎂 🧩 🎸 🎤 🔒 ✂️ ⚙️ 🔔 🔕 🚫 ♻️ 💤 💥. Their web names are in `apps/web/src/components/sticker/emoji.ts`.

### Steps
1. **Create `packages/chat-core/src/emoji-table.ts`** with the four exports moved word for word from the phone file (with its doc comment, updated to say it's shared). Export it from `packages/chat-core/src/index.ts`. Delete `apps/mobile/src/lib/emoji-table.ts`, and make `emoji-data.ts` re-export the same names from `@zilar/chat-core`, so no phone importer changes.
2. **Add the 31 glyphs** to fitting categories: faces → smileys, 🫶 → hearts, nature and weather → animals or travel, food and drink → food, 🎂 🧩 🎸 🎤 → activities, 🔒 ✂️ ⚙️ 🔔 🔕 → objects, 🚫 ♻️ 💤 💥 → symbols. Skip any that are already present. Add their names (reuse web's, plus keywords) to `EMOJI_NAMES`.
3. **Web `EmojiTab.tsx`:**
   - use `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY` for the grouped view;
   - use `searchEmoji(query, all glyphs)` for the search;
   - use `EMOJI_NAMES[glyph]`'s first words for the button label and title (the same label format as today; the first word or two of the name is fine);
   - keep the "No emoji found." line and the layout;
   - delete `apps/web/src/components/sticker/emoji.ts`.
4. **Keep every file within 400 lines. No tests** (data and UI).

### Allowed files
- `packages/chat-core/src/emoji-table.ts`
- `packages/chat-core/src/emoji-names.ts`
- `packages/chat-core/src/index.ts`
- `apps/mobile/src/lib/emoji-table.ts`
- `apps/mobile/src/lib/emoji-data.ts`
- `apps/web/src/components/sticker/EmojiTab.tsx`
- `apps/web/src/components/sticker/emoji.ts`
- `work/T-1673-shared-emoji-table.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Web and phone show the same emoji set** (about 328), grouped in the same nine categories.
- **"heart" and "fire" find their emoji on both.** Every glyph has a name.

---

## Report (written by the worker when done)

### What I did

- **New `packages/chat-core/src/emoji-table.ts`** (382 lines): moved
  `EmojiCategoryId`, `EmojiCategory`, `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY`
  word for word from the phone file, with the doc comment updated to say the
  table is shared. Added the 31 web-only glyphs to fitting categories:
  😢 😡 😳 → smileys; 🫶 → hearts; 🌸 🌻 🌹 🌵 → animals; 🌈 ☀️ 🌙 ⚡ ❄️ 🌊 →
  travel; 🍣 🍰 🍺 🍷 → food; 🎂 🧩 🎸 🎤 → activities; 🔒 ✂️ ⚙️ 🔔 🔕 → objects;
  🚫 ♻️ 💤 💥 → symbols. Exported it from `packages/chat-core/src/index.ts`.
- **Deleted `apps/mobile/src/lib/emoji-table.ts`**; `emoji-data.ts` now
  re-exports `EMOJI_BY_CATEGORY`, `EMOJI_CATEGORIES`, `EmojiCategory` and
  `EmojiCategoryId` from `@zilar/chat-core`, so no phone importer changed (the
  comment noting the table's home was updated too).
- **`packages/chat-core/src/emoji-names.ts`** (361 lines): added the 31 names
  (web's names plus keywords) into their category blocks, and updated the top
  comment from "the phone's `EMOJI_BY_CATEGORY` table" to the shared one.
- **`apps/web/src/components/sticker/EmojiTab.tsx`** (88 lines): now uses
  `EMOJI_CATEGORIES` + `EMOJI_BY_CATEGORY` for the grouped view and
  `searchEmoji(query, ALL_EMOJI)` for the search; the button label and title use
  the first two words of `EMOJI_NAMES[glyph]`. The "No emoji found." line, the
  layout and the `onEmoji` prop are unchanged. Deleted
  `apps/web/src/components/sticker/emoji.ts` (its only importer was this tab).
- Counts: the shared table has **328** glyphs (297 phone + 31 web-only), no
  duplicates; `emoji-table.ts` 382, `emoji-names.ts` 361, `EmojiTab.tsx` 88,
  `emoji-data.ts` 123 — all ≤ 400. No tests added (data and UI).

### Checks run

- Data check (node, one-off): `total glyphs: 328`, `unique: 328`,
  `duplicates: []`, `glyphs without name: 0`; `search("heart")` → 23 matches
  including ❤️ and 🫶; `search("fire")` → 2 including 🔥; all 31 web-only glyphs
  present.
- No emoji-specific test files exist in the repo, so nothing narrower to run;
  the gate ran the nearest package tests.
- `pnpm gate` from the repo root, exit 0:

  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (9.6s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/chat-core  (1.8s)
  PASS  tests @zilar/mobile  (2.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- The 8 changed files: `packages/chat-core/src/emoji-table.ts` (new),
  `packages/chat-core/src/emoji-names.ts`, `packages/chat-core/src/index.ts`,
  `apps/mobile/src/lib/emoji-table.ts` (deleted),
  `apps/mobile/src/lib/emoji-data.ts`,
  `apps/web/src/components/sticker/EmojiTab.tsx`,
  `apps/web/src/components/sticker/emoji.ts` (deleted), this task file.

### Notes for the lead

- The spec lists 🎂 with 🧩 🎸 🎤 → activities, so 🎂 went to activities even
  though web previously had it in food. Say the word if you'd rather have it in
  food.
- Nature/weather glyphs are split: plants (🌸 🌻 🌹 🌵) in animals, weather and
  water (🌈 ☀️ 🌙 ⚡ ❄️ 🌊) in travel — the phone already keeps 🔥 ✨ ⭐ 🌟 in
  travel, so weather there is consistent. Easy to move if you prefer otherwise.
- The web button label is the first two words of the shared name, e.g.
  "grinning face" (rather than web's old "grinning face" / "red heart" style);
  format `Insert <glyph> (<label>)` and `title` are unchanged.
- `.oxlintrc.json` still lists `apps/mobile/src/lib/emoji-data.ts` under the
  max-lines exemption; that file is now 123 lines, but I left the config alone
  (not in Allowed files).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits, 1 follow-up.
- **The lead's check:**
  - the shared table in `packages/chat-core/src/emoji-table.ts` has 328 unique glyphs, and every one is named;
  - none of web's old 102 is missing;
  - "heart" → 23, "fire" → 🚒🔥, "cake" → 🍰🎂.
- **Web's Emoji tab** now uses the shared table, names and `searchEmoji`, with nine categories (Hearts, Travel etc. replace Nature). Web's old `emoji.ts` is deleted. The phone re-exports from chat-core.
- **The worker's placement choices are accepted:** 🎂 in activities; plants in animals; weather in travel.
- **Follow-up, recorded:** remove the stale `emoji-data.ts` max-lines exemption from `.oxlintrc.json`.
