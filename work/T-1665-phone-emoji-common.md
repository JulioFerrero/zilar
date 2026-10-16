---
id: T-1665
title: "Phone emoji picker: add the common emoji it lacks (🔥 🎉 😭 👀 ✅ ❌ 💯 ✨ …) with searchable names, and move the category table out of lib/emoji-data.ts (435 lines, over the cap) into a new lib/emoji-table.ts"
status: merged
milestone: M5
branch: task/T-1665-phone-emoji-common
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1665: Common emoji on the phone, and the table split

## Spec (written by Claude, do not edit)

### Why
The phone emoji picker has no 🔥, 🎉, 😭, 👀, ✅, ❌, 💯 or ✨. The lead checked `apps/mobile/src/lib/emoji-data.ts` on 2026-10-16: 0 matches for those. These are among the most-used emoji, and web's picker has 🔥 and 🎉 (`apps/web/src/components/sticker/emoji.ts:59,103`). Separately, `emoji-data.ts` is 435 lines, over the 400-line cap.

### Facts (the lead read them on 2026-10-16, main after T-1660)
- **`apps/mobile/src/lib/emoji-data.ts`** (435 lines):
  - `EmojiCategoryId` (`:9-18`), `EmojiCategory` (`:20-23`) and `EMOJI_CATEGORIES` (`:25-35`);
  - `EMOJI_BY_CATEGORY: Record<EmojiCategoryId, readonly string[]>` (`:37-322`, one glyph per line in nine arrays: `smileys :38`, `people :88`, `hearts :122`, `animals :144`, `food :176`, `activities :206`, `travel :234`, `objects :262`, `symbols :294`);
  - then the helpers `CaretSelection`, `insertEmojiAtCaret`, `MAX_RECENT_EMOJI`, the recents functions and `EMOJI_RECENTS_STORAGE` (`:325-435`).
- **Importers of `@/lib/emoji-data`:**
  - `apps/mobile/src/components/chat/emoji-tab.tsx:21` (`EMOJI_BY_CATEGORY`, `EMOJI_CATEGORIES`, `EmojiCategoryId`);
  - `apps/mobile/src/components/chat/emoji-sheet.tsx:7`;
  - `apps/mobile/src/components/chat/composer-sheet.ts:19`;
  - `apps/mobile/src/components/chat/composer.tsx:19`;
  - `apps/mobile/src/components/chat/composer-input-row.tsx:20`;
  - `apps/mobile/src/components/chat/use-composer-mentions.ts:12`.
- **`packages/chat-core/src/emoji-names.ts`** (298 lines, T-1660): `EMOJI_NAMES` maps every phone glyph to a lowercase name plus keywords; `searchEmoji` looks names up there.

### Steps
1. **Create `apps/mobile/src/lib/emoji-table.ts`:**
   - move `EmojiCategoryId`, `EmojiCategory`, `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY` there unchanged, with the file's doc comment;
   - in `emoji-data.ts`, re-export them (`export { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES } from './emoji-table'; export type { EmojiCategory, EmojiCategoryId } from './emoji-table';`), so no importer changes.
2. **Add these glyphs**, each to the most fitting existing category, **skipping any that are already present** (check each one):

   😭 🥳 😎 🙄 😴 🤯 🥺 😬 🤗 🫠 💀 🤦 🤷 🫡 👀 🔥 ✨ ⭐ 🌟 💯 ✅ ❌ ⚠️ ❓ ❗ 🎉 🎊 🏆 🍻 🥂 🍾 💡 📌 📎 🔗 ⏰ 📅 💰 🎯

   Put faces in `smileys`; gestures and 👀 in `people`; 🔥, ✨, ⭐ and 🌟 in `travel` (the Unicode "Travel & Places" group holds 🔥 and the stars); ✅, ❌, ⚠️, ❓, ❗ and 💯 in `symbols`; 🎉, 🎊, 🏆 and 🎯 in `activities`; drinks in `food`; the rest in `objects`. Keep the glyphs exactly as listed (with `️` where shown).
3. **Add a lowercase name with keywords for every added glyph** to `EMOJI_NAMES` in `packages/chat-core/src/emoji-names.ts`, in the same style as the existing entries (e.g. `'🔥': 'fire flame hot lit'`, `'🎉': 'party popper celebrate tada'`).
4. **Keep each file within 400 lines.** `emoji-table.ts` will be about 330.
5. **No tests** (data and UI).

### Allowed files
- `apps/mobile/src/lib/emoji-table.ts`
- `apps/mobile/src/lib/emoji-data.ts`
- `packages/chat-core/src/emoji-names.ts`
- `work/T-1665-phone-emoji-common.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The phone picker shows 🔥, 🎉, 😭, 👀, ✅, ❌, 💯 and ✨** in sensible categories, and "fire" finds 🔥 in search.
- **Every glyph in the table has a name in `EMOJI_NAMES`.**
- **`emoji-data.ts` is 400 lines or fewer;** no importer changed.

---

## Report (written by the worker when done)

### What I did

- Created **`apps/mobile/src/lib/emoji-table.ts`** (351 lines): moved `EmojiCategoryId`,
  `EmojiCategory`, `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY` there unchanged, with a doc
  comment derived from the old `emoji-data.ts` header.
- **`apps/mobile/src/lib/emoji-data.ts`** (123 lines): removed the table and re-exported it
  (`export { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES }`, `export type { EmojiCategory,
  EmojiCategoryId }`) so **no importer changed**; kept every helper and gave the file a
  doc comment that describes the helpers.
- Added the **31 new glyphs** (appended at the end of each category array so the existing
  order is untouched): smileys `😭 🥳 😎 🤯 🥺 🫠 💀`; people `🤦 🤷 🫡 👀`; travel
  `🔥 ✨ ⭐ 🌟`; symbols `💯 ✅ ❌ ⚠️ ❓ ❗`; activities `🎉 🎊 🎯`; food `🍻 🥂 🍾`;
  objects `📌 📎 🔗 📅`. Skipped the 8 already present: `🙄 😴 😬 🤗 🏆 💡 ⏰ 💰`.
- Added a lowercase name + keywords for each of the 31 new glyphs to `EMOJI_NAMES` in
  **`packages/chat-core/src/emoji-names.ts`** (329 lines), inserted into its category block.

### Checks run

- `pnpm install` → done (peer-dependency warning only).
- Verification script over the three files → table glyphs 297, unique 297, **duplicates
  none**, **missing names none**, all 31 required glyphs present in the table and named.
  `🔥`'s name is `fire flame hot lit`, so `searchEmoji('fire', …)` matches it.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (2.1s)
  PASS  lint  (1.9s)
  PASS  typecheck  (7.8s)
  PASS  effect  (2.7s)
  PASS  tests @zilar/chat-core  (5.2s)
  PASS  tests @zilar/mobile  (5.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the spec says "No tests (data and UI)" and this worktree has
  no emoji test to run.

### Notes for the lead

- **Placement call:** `💀` (skull) went to `smileys`. The spec said "put faces in `smileys`
  … the rest in `objects`". I read skull as a face/emotion glyph (Unicode groups it under
  Smileys & Emotion; iOS and Android list it under Smileys & People), so it fits `smileys`
  better than `objects`. Say the word and I'll move it.
- **Doc comment:** the old single header covered both the table and the helpers, so I split
  it — the "list of emoji grouped by category" sentence moved to `emoji-table.ts`, and a
  helpers sentence stays in `emoji-data.ts`, so neither file describes code it no longer
  holds. All the other spec steps are literal.
- File sizes: `emoji-table.ts` 351, `emoji-data.ts` 123, `emoji-names.ts` 329 — all ≤ 400.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The lead's checks:**
  - each of the 39 requested glyphs appears exactly once in `emoji-table.ts`;
  - the table now has 297 glyphs (was 266), and all 297 have names (0 missing);
  - "fire" now finds 🔥.
- **The split:** `emoji-data.ts` drops from 435 to 123 lines and re-exports the table, so no importer changed. `emoji-table.ts` is 351 lines and `emoji-names.ts` 329.
