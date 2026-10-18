---
id: T-1945
title: "Web emoji panel like Telegram/WhatsApp: one continuous scroll of every emoji with a category bar that follows it, Recent first, even spacing, tabs Emoji | Stickers | GIFs"
status: merged
milestone: M5
branch: task/T-1945-web-emoji-panel
model: deepseek/deepseek-flash
effort: default
depends_on: []
estimate: 45 min
---

# T-1945: Web emoji panel

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "the emoji part needs a little rework with the margins, spacing, etc and if i scroll needs to show all the emoji down and the categories just scroll up or down … make sure we have closest parity with telegram or discord or whatsapp, also make sure all the ui follows the same style and flow".

**What the lead saw on the web mock (1440×900):**
- the panel has no category bar, only one long list;
- 6 widely spaced columns;
- no Recent section;
- the tab order is Stickers | GIFs | Emoji, while the phone uses Emoji | Stickers | GIFs.

T-1946 is the phone twin. Both must end up with the same layout, icons and order.

### Facts (read by the lead on 2026-10-18)
- **`apps/web/src/components/sticker/EmojiTab.tsx`** (88 lines):
  - a `SearchField` in `border-b p-2` (`:20-27`);
  - a scroller `max-h-[260px] overflow-y-auto p-2` (`:28`), which either shows search results or every `EMOJI_CATEGORIES` section with a header (`:35-51`);
  - `EmojiGrid` is `grid grid-cols-6 gap-1` with 48 px buttons and 26 px glyphs (`:64-87`).
  - It's also used by the reactions dialog, `apps/web/src/components/message/MessageMenu.tsx`.
- **`apps/web/src/components/StickerPanel.tsx`** (298 lines):
  - `PANEL_TABS = ['stickers', 'gifs', 'emoji']` (`:50`);
  - `useState<Tab>('stickers')` (`:112`);
  - the `SegmentedControl` tab row (`:256-272`);
  - the panel is `min-w-[min(344px,calc(100vw-2rem))]` (`:253`).
- **The shared data:** `EMOJI_CATEGORIES` and `EMOJI_BY_CATEGORY` from `@zilar/chat-core` (nine categories).
- **The phone's category icons**, to reuse here as `lucide-react` icons: `apps/mobile/src/components/chat/emoji-tab.tsx:2-37`.
  - Recent = `Clock`;
  - smileys `Smile`, people `Hand`, animals `PawPrint`, food `Pizza`, activities `Trophy`, travel `Plane`, objects `Lightbulb`, symbols `Hash`, flags `Flag`.
- **The phone's recents rule**, `apps/mobile/src/lib/emoji-data.ts:37-46`: `MAX_RECENT_EMOJI = 24`, and `rememberRecentEmoji` puts the picked emoji first, deduplicated. Web has no emoji recents.
- **D24** (`docs/design/ui-style.md`):
  - segmented control `:170-174`;
  - `--surface-raised` for selected (`:60`);
  - raised segment `:115`.

### Steps
1. **`StickerPanel.tsx`:** `PANEL_TABS = ['emoji', 'stickers', 'gifs']`, and the panel opens on `'emoji'`. The labels stay the same.
2. **New `apps/web/src/lib/emojiRecents.ts`** (about 40 lines):
   - `readEmojiRecents(storage)` and `rememberEmojiRecent(storage, emoji)`;
   - localStorage key `zilar:emojiRecents`, at most 24, newest first, deduplicated (the phone's rule);
   - every read and write in try/catch, and a bad value reads as `[]`.
   - Clear it where the other per-user caches are cleared, in `resetUserState` (`apps/web/src/store/effects/lifecycle.ts:57-70`).
3. **`EmojiTab.tsx`, the layout from top to bottom, with one inset of 12 px (`px-3`) on every row:**
   - **The category bar:** one row of equal 32×32 icon buttons with 7 px radius, `justify-between`.
     - A **Search** icon (lucide `Search`) comes first, then **Recent** (only when there are recents), then the nine categories.
     - The active category gets `bg-surface-raised text-foreground` with the D24 raised inset. The others are `text-muted-foreground hover:text-foreground`.
     - Every button has an `aria-label`, and the active one has `aria-pressed`.
   - **Search:** clicking the Search icon swaps the bar for the `SearchField` in the same row, focused, with a clear/close button that brings the bar back. While a query is typed, the grid shows only the results (or "No emoji found."), with no headers.
   - **The grid:** one scroller with a **fixed height of 300 px** (so the panel never resizes) and `overflow-y-auto`.
     - It holds every section in order: "Recently used" (if any), then the nine categories.
     - Each section has a sticky header: `sticky top-0 bg-surface`, 12/600, `text-subtle-foreground`, `py-1.5`.
     - The grid is `grid-cols-8`, with 36 px square buttons, 24 px glyphs, a 2 px gap and an 8 px radius on hover.
   - **The bar follows the scroll:** on scroll, the active category is the last section whose top is at or above the scroller's top. Clicking a category scrolls its section to the top (`scrollTo` smooth, instant under `prefers-reduced-motion`).
   - **A pick** calls `onEmoji` as now and records it with `rememberEmojiRecent`. Recents re-read when the tab mounts, so the order doesn't jump under the pointer.
   - Keep `EmojiTab.tsx` at 400 lines or fewer. Put the bar in a new `apps/web/src/components/sticker/EmojiCategoryBar.tsx` if that helps.
4. **The reactions dialog** (`MessageMenu.tsx`) uses the same `EmojiTab`, so it gets the same panel. Don't change it otherwise.
5. **No tests** (UI).

### Allowed files
- `apps/web/src/components/sticker/EmojiTab.tsx`
- `apps/web/src/components/sticker/EmojiCategoryBar.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `apps/web/src/lib/emojiRecents.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `work/T-1945-web-emoji-panel.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The panel opens on Emoji, with tabs Emoji | Stickers | GIFs.
- One continuous scroll shows Recently used, then every category with a header, 8 to a row, evenly spaced.
- Scrolling moves the highlighted category in the bar. Clicking a category jumps there.
- The Search icon opens search in place, and closing it returns the bar.
- A picked emoji appears first in Recently used the next time the panel opens.
- The same applies in the reactions "React" dialog.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `StickerPanel.tsx`: `PANEL_TABS` is now `['emoji', 'stickers', 'gifs']`, the panel opens on `'emoji'`, and the GIF-unavailable fallback now lands on Emoji too (it used to fall back to Stickers). Labels and the GIF probe are unchanged.
- New `apps/web/src/lib/emojiRecents.ts`: `EMOJI_RECENTS_KEY = 'zilar:emojiRecents'`, `MAX_RECENT_EMOJI = 24`, `readEmojiRecents`, `rememberEmojiRecent` and `clearEmojiRecents`; newest first, deduplicated, every storage/JSON step in try/catch via the `orFallback` pattern used by `lib/stickers.ts`, and a hostile value reads as `[]`.
- `resetUserState` in `store/effects/lifecycle.ts` now calls `clearEmojiRecents(storage)` next to `clearChatListCache`.
- New `sticker/EmojiCategoryBar.tsx`: one row of equal 32 px, 7 px-radius icon keys — Search first, Recent (Clock) only when there are recents, then the nine categories with the phone's icons (`Smile`, `Hand`, `PawPrint`, `Pizza`, `Trophy`, `Plane`, `Lightbulb`, `Hash`, `Flag`). Active key is `bg-surface-raised text-foreground` with the D24 raised inset; every key has an `aria-label` and categories carry `aria-pressed`.
- `sticker/EmojiTab.tsx`, 211 lines:
  - the Search key swaps the bar for a `SearchField` in the same row, focused on open, with an `X` key that clears the query and restores the bar; a query shows only results (or "No emoji found.") with no headers;
  - one 300 px `overflow-y-auto` scroller with `px-3`, holding "Recently used" (when any) plus every non-empty category, each under a sticky `bg-surface` 12/600 `text-subtle-foreground` `py-1.5` header;
  - an 8-column grid of 36×36 buttons, 24 px glyphs, 2 px gaps and 8 px hover radius;
  - `onScroll` highlights the last section whose top reached the scroller's top (last section at the bottom edge, so Flags can win);
  - clicking a category scrolls its section to the top with `scrollTo` smooth, `auto` under `prefers-reduced-motion`;
  - a pick calls `onEmoji` and `rememberEmojiRecent`; recents are read once on mount so the order never jumps under the pointer.
- No tests added (UI change, per AGENTS.md and the task's "No tests").
- Reactions dialog untouched: it already renders the same `EmojiTab`, so it gets the new panel.

### Checks run
- `pnpm install` — done, 1155 packages added/reused, one deprecated-subdependency warning only.
- `pnpm gate` (first run) — `FAIL format` on the three new/rewritten files. Fixed with `pnpm exec prettier --write` on those three files only.
- `pnpm gate` (final) — real summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.8s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/web  (8.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run separately: the change is UI-only and the gate ran the web package tests once.

### Notes for the lead
- At the 344 px panel width the bar has 10 keys without recents and 11 with recents; the `w-8 shrink` keys share the row evenly, so with recents they are about 29 px wide but still 32 px tall. If you want exactly 32 px with recents, the panel needs ~24 px more width (not changed here).
- When search is open the scroller keeps its fixed 300 px, but the top row grows ~6 px compared with the bar row (the field is 32 px plus the search icon inset). The panel therefore grows slightly on the first Search click and returns when closed; the grid itself never resizes.
- `rememberEmojiRecent` returns the new list but `EmojiTab` ignores it on purpose (spec: recents re-read on mount), so the Recent section and key inside an open panel keep the list from when it opened.

### Round (fix round 1)
- Fixed finding 1 (should-fix): the active key in `EmojiCategoryBar.tsx` now uses the codebase's `segment-raised` utility (D24 raised segment, as in `segmented-control.tsx`, `FolderTabs.tsx` and `dialog-stepper.tsx`) instead of the one-off `bg-surface-raised` plus inline inset shadow. The utility's gradient replaces the flat fill, matching every other active segmented tab in the app.
- Findings 2 and 3 are nits and were left untouched, as instructed.
- Tests: none added. The finding names no test, the spec says "No tests (UI)" and AGENTS.md says UI code gets no tests; there is no behaviour change beyond the visual recipe.
- Disagreements: none.
- `pnpm gate` (after the fix):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/web  (3.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run separately: UI-only change, and the gate ran the web package tests.

### Round 2 (lead's web-mock check)
- **Item 1, last category never active.** The bar now uses a jump target instead of a bare scroll position: `jumpTo` clamps the target to the scroller's maximum scroll offset, sets the clicked key active at once and records the target; `followScroll` ignores scroll events while a jump target is set; the scroller's `onScrollEnd` clears the target, then the bar follows the scroll again. The end-of-scroller test is now `scrollTop + clientHeight >= scrollHeight - 2` and selects the last section, so Flags wins at the bottom. Clicking a category that is already at the top does not set a target, so there is nothing to wait for. I first wrote the settle hold with `setTimeout`/150 ms; the gate's Effect ratchet rejected the timers (H3), so it uses `scrollend`, which is the same settle point without a timer.
- **Item 2, two close buttons.** The close control is now `ArrowLeft` in a 32 px key before the field with `aria-label="Close search"`; the field keeps its own native clear for the text, and Escape in the field closes search (`stopPropagation` so a surrounding dialog does not also close).
- **Item 3, search row height (pre-review nit 3).** The bar row and the search row now share one fixed 48 px row (`flex h-12 items-center px-3`), so opening search does not move the panel. The bar keeps its 32 px keys and the field its 32 px compact input, both centred in the fixed row.
- Pre-review findings: nit 3 is the only one this round touched; nit 2 (29 px keys with recents) is unchanged. There were no must-fix or other should-fix findings in `PREREVIEW.md`.
- Tests: none added, same reason as round 1 (UI only, spec says no tests).
- Verification: I did not re-run the lead's Playwright click-through; this machine's rules forbid starting a dev server, so the three checks (Recently used, a middle category, Flags) were reasoned from the code, not clicked. The gate passes.
- Commits: `T-1945: fix last category active state after category jump`, `T-1945: fix double close control in emoji search`, `T-1945: fix emoji search row height`.
- `pnpm gate` (final):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/web  (4.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```


### Round 3 (PREREVIEW.md at HEAD 40dd3da)

- **Finding 1 (should-fix), fixed.** `followScroll` no longer bails out for the whole time a jump target is set. It now clears `jumpTargetRef` and continues following once `Math.abs(scroller.scrollTop - target) < 2`, so a jump releases itself from the scroll event even where `scrollend` never fires (Safari before 26.2, or an instant `auto` scroll under `prefers-reduced-motion`). `settleJump` / `onScrollEnd` is kept as the normal path; when it arrives after the scroll event already released the target it is a no-op. A jump that never reaches its target still releases on `scrollend` where that event exists — unchanged.
- **Finding 2 (nit), untouched.** The `w-8 shrink` keys are on a line this round does not change, and exact 32 px with recents needs a wider panel, which the nit itself says would disturb the Stickers/GIFs tabs.
- Tests: none added. The finding names no test, the spec says "No tests (UI)" and AGENTS.md says UI code gets no tests; there is no non-UI code path to test.
- Verification: reasoned from the code; no dev server or browser session was started (machine rules forbid it), and the lead's Playwright click-through was not re-run.
- Disagreements: none.
- Commit: `T-1945: fix finding 1 - release emoji jump without scrollend`.
- `pnpm gate` (final):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/web  (3.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)

**Approved and merged.** The lead checked the web mock with Playwright at 1440×900 on `48250ed3c`:
- **The panel:** it opens on Emoji, with tabs Emoji | Stickers | GIFs. The category bar is Search, Recent, then the nine categories, and the grid is 8 per row with sticky headers.
- **The bar follows the scroll:** at a scroll of 2400 the active category is People. Clicking Flags makes Flags active (it was Symbols before fix round 1).
- **Search:** "heart" gives 34 results. A back arrow sits before the field and there's one clear ✕ (there were two before).
- **Recently used:** a picked emoji shows first in Recently used on reopen.

The two remaining nits are left as they are. The phone twin is T-1946, merged.
