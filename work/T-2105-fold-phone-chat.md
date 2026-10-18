---
id: T-2105
title: "Fold 77 small single-use files into the one file that imports each (phone chat components): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2105-fold-phone-chat
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2105: Fold single-use files (phone chat components)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 77 files total 4976 lines, 473 of them import lines.

- `apps/mobile/src/components/chat/unread-divider.tsx` (16) → `apps/mobile/src/components/chat/message-list-row.tsx` (166)
- `apps/mobile/src/components/chat/date-separator.tsx` (17) → `apps/mobile/src/components/chat/message-list-row.tsx` (166)
- `apps/mobile/src/components/chat/use-draft-text.ts` (20) → `apps/mobile/src/components/chat/composer.tsx` (266)
- `apps/mobile/src/components/chat/forwarded-header.tsx` (21) → `apps/mobile/src/components/chat/message-bubble-content.tsx` (335)
- `apps/mobile/src/components/chat/image-message.tsx` (21) → `apps/mobile/src/components/chat/media-bubble.tsx` (368)
- `apps/mobile/src/components/chat/blocks/data-blocks.tsx` (24) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/message-search-scheduler.ts` (28) → `apps/mobile/src/components/chat/message-search.ts` (310)
- `apps/mobile/src/components/chat/routine-header.tsx` (28) → `apps/mobile/src/components/chat/message-bubble-content.tsx` (335)
- `apps/mobile/src/components/chat/chat-background.tsx` (30) → `apps/mobile/src/app/chat/[id].tsx` (156)
- `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` (33) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/topic-done-row.tsx` (33) → `apps/mobile/src/components/chat/topic-info-sheet.tsx` (345)
- `apps/mobile/src/components/chat/edit-bar.tsx` (34) → `apps/mobile/src/components/chat/composer.tsx` (266)
- `apps/mobile/src/components/chat/blocks/callout-block.tsx` (34) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` (34) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/use-message-search.ts` (35) → `apps/mobile/src/components/chat/message-search-list.tsx` (218)
- `apps/mobile/src/components/chat/jump-to-bottom.tsx` (35) → `apps/mobile/src/components/chat/message-list.tsx` (326)
- `apps/mobile/src/components/chat/mention-text.tsx` (36) → `apps/mobile/src/components/chat/link-text.tsx` (107)
- `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx` (36) → `apps/mobile/src/components/chat/voice-message.tsx` (265)
- `apps/mobile/src/components/chat/media-meta-pill.tsx` (36) → `apps/mobile/src/components/chat/media-bubble.tsx` (368)
- `apps/mobile/src/components/chat/message-search-format.ts` (37) → `apps/mobile/src/components/chat/message-search.ts` (310)
- `apps/mobile/src/components/chat/chat-header-bar.tsx` (38) → `apps/mobile/src/app/chat/[id].tsx` (156)
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx` (41) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` (43) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/group-header.tsx` (44) → `apps/mobile/src/app/group/[id].tsx` (299)
- `apps/mobile/src/components/chat/blocks/event-block.tsx` (49) → `apps/mobile/src/components/chat/blocks/content-blocks.tsx` (41)
- `apps/mobile/src/components/chat/search-snippet.tsx` (50) → `apps/mobile/src/components/chat/message-search-list.tsx` (218)
- `apps/mobile/src/components/chat/blocks/link-block.tsx` (52) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/mention-picker.tsx` (53) → `apps/mobile/src/components/chat/composer.tsx` (266)
- `apps/mobile/src/components/chat/message-bubble-tombstone.tsx` (53) → `apps/mobile/src/components/chat/message-bubble.tsx` (345)
- `apps/mobile/src/components/chat/bubble-gesture.tsx` (53) → `apps/mobile/src/components/chat/message-bubble.tsx` (345)
- `apps/mobile/src/components/chat/use-bubble-reveal.ts` (54) → `apps/mobile/src/components/chat/message-bubble.tsx` (345)
- `apps/mobile/src/components/chat/chat-overlays.tsx` (57) → `apps/mobile/src/app/chat/[id].tsx` (156)
- `apps/mobile/src/components/chat/gif-paging.ts` (59) → `apps/mobile/src/components/chat/gif-panel.tsx` (250)
- `apps/mobile/src/components/chat/blocks/block-icons.ts` (59) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/blocks/place-block.tsx` (60) → `apps/mobile/src/components/chat/blocks/content-blocks.tsx` (41)
- `apps/mobile/src/components/chat/reply-quote.tsx` (61) → `apps/mobile/src/components/chat/message-bubble-content.tsx` (335)
- `apps/mobile/src/components/chat/jump-scroll.ts` (62) → `apps/mobile/src/components/chat/use-message-list-scroll.ts` (302)
- `apps/mobile/src/components/chat/ai-status-line.tsx` (64) → `apps/mobile/src/app/chat/[id].tsx` (156)
- `apps/mobile/src/components/chat/attach/attach-tab-bar.tsx` (65) → `apps/mobile/src/components/chat/attach-sheet.tsx` (119)
- `apps/mobile/src/components/chat/attach/file-tab.tsx` (67) → `apps/mobile/src/components/chat/attach-sheet.tsx` (119)
- `apps/mobile/src/components/chat/gif-cells.tsx` (67) → `apps/mobile/src/components/chat/gif-panel.tsx` (250)
- `apps/mobile/src/components/chat/forward-sheet.tsx` (68) → `apps/mobile/src/components/chat/chat-overlays.tsx` (57)
- `apps/mobile/src/components/chat/search-header.tsx` (72) → `apps/mobile/src/app/(tabs)/index.tsx` (207)
- `apps/mobile/src/components/chat/handoff-line.tsx` (72) → `apps/mobile/src/components/chat/message-bubble.tsx` (345)
- `apps/mobile/src/components/chat/blocks/status-block.tsx` (74) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/blocks/weather-block.tsx` (75) → `apps/mobile/src/components/chat/blocks/content-blocks.tsx` (41)
- `apps/mobile/src/components/chat/emoji-rows.ts` (75) → `apps/mobile/src/components/chat/emoji-tab.tsx` (261)
- `apps/mobile/src/components/chat/blocks/progress-block.tsx` (76) → `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` (33)
- `apps/mobile/src/components/chat/blocks/gauge-block.tsx` (76) → `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` (34)
- `apps/mobile/src/components/chat/voice-recorder-gesture.ts` (76) → `apps/mobile/src/components/chat/voice-recorder.tsx` (336)
- `apps/mobile/src/components/chat/leave-topic-sheet.tsx` (77) → `apps/mobile/src/components/chat/topic-info-host.tsx` (216)
- `apps/mobile/src/components/chat/blocks/number-block.tsx` (77) → `apps/mobile/src/components/chat/blocks/block-card.tsx` (273)
- `apps/mobile/src/components/chat/blocks/stats-block.tsx` (79) → `apps/mobile/src/components/chat/blocks/data-blocks.tsx` (24)
- `apps/mobile/src/components/chat/question-card.tsx` (79) → `apps/mobile/src/components/chat/payload-card.tsx` (79)
- `apps/mobile/src/components/chat/voice-recording-row.tsx` (81) → `apps/mobile/src/components/chat/voice-recorder.tsx` (336)
- `apps/mobile/src/components/chat/chat-actions-host.tsx` (82) → `apps/mobile/src/app/(tabs)/index.tsx` (207)
- `apps/mobile/src/components/chat/selection-delete.tsx` (83) → `apps/mobile/src/components/chat/selection-bar.tsx` (156)
- `apps/mobile/src/components/chat/blocks/rating-block.tsx` (84) → `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` (43)
- `apps/mobile/src/components/chat/reaction-chips.tsx` (88) → `apps/mobile/src/components/chat/message-bubble.tsx` (345)
- `apps/mobile/src/components/chat/use-group-roles.ts` (88) → `apps/mobile/src/app/group-info/[id].tsx` (380)
- `apps/mobile/src/components/chat/blocks/choice-block.tsx` (89) → `apps/mobile/src/components/chat/blocks/choice-blocks.tsx` (43)
- `apps/mobile/src/components/chat/topic-not-in-row.tsx` (94) → `apps/mobile/src/components/chat/chat-composer-dock.tsx` (258)
- `apps/mobile/src/components/chat/blocks/countdown-block.tsx` (96) → `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` (33)
- `apps/mobile/src/components/chat/chat-row-swipe.tsx` (96) → `apps/mobile/src/components/chat/chat-rows.tsx` (93)
- `apps/mobile/src/components/chat/media-sheet-content.tsx` (97) → `apps/mobile/src/components/chat/media-sheet.tsx` (191)
- `apps/mobile/src/components/chat/sticker-message.tsx` (99) → `apps/mobile/src/components/chat/message-bubble-content.tsx` (335)
- `apps/mobile/src/components/chat/blocks/table-block.tsx` (100) → `apps/mobile/src/components/chat/blocks/data-blocks.tsx` (24)
- `apps/mobile/src/components/chat/blocks/bars-block.tsx` (103) → `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` (34)
- `apps/mobile/src/components/chat/emoji-category-bar.tsx` (103) → `apps/mobile/src/components/chat/emoji-tab.tsx` (261)
- `apps/mobile/src/components/chat/blocks/timeline-block.tsx` (106) → `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` (33)
- `apps/mobile/src/components/chat/topic-actions-sheet.tsx` (106) → `apps/mobile/src/app/group/[id].tsx` (299)
- `apps/mobile/src/components/chat/topic-mute-leave.tsx` (106) → `apps/mobile/src/components/chat/topic-info-sheet.tsx` (345)
- `apps/mobile/src/components/chat/link-text.tsx` (107) → `apps/mobile/src/components/chat/plain-bubble-body.tsx` (208)
- `apps/mobile/src/components/chat/blocks/file-block.tsx` (109) → `apps/mobile/src/components/chat/blocks/content-blocks.tsx` (41)
- `apps/mobile/src/components/chat/empty-chat.tsx` (111) → `apps/mobile/src/components/chat/message-list.tsx` (326)
- `apps/mobile/src/components/chat/new-message-sheet.tsx` (116) → `apps/mobile/src/components/chat/new-chat-button.tsx` (240)
- `apps/mobile/src/components/chat/group-list-item.tsx` (117) → `apps/mobile/src/components/chat/chat-rows.tsx` (93)

### Steps
1. **Fold each row.**
   - Move the small file's code into its importer, next to where it is used: above the component or function that uses it.
   - Merge the imports: one import per module, no duplicates.
   - Delete the importer's import of the small file, then delete the small file.
   - Keep `export` only on names something else still imports (a test or a fixture). Otherwise drop the keyword.
2. **Skip a row, and list it in the Report with the reason, when:**
   - the importer would go over 800 lines;
   - the importer loads the small file lazily (`lazy(() => import(…))`, `import(…)` or `require(…)`), since code splitting must stay;
   - the small file is named by a config, script or entry point (check with `git grep -n "<path without extension>"` across the repo);
   - folding would create an import cycle.
3. **Tests and fixtures** that import a folded file import the same names from the importer instead.
4. **Change no behaviour:** no logic, no wording, no styling. Formatting follows prettier.
5. **No new tests.** Report the line counts and the skipped rows.

### Allowed files
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/attach/attach-tab-bar.tsx`
- `apps/mobile/src/components/chat/attach/file-tab.tsx`
- `apps/mobile/src/components/chat/blocks/bars-block.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/block-icons.ts`
- `apps/mobile/src/components/chat/blocks/callout-block.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/choice-block.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/countdown-block.tsx`
- `apps/mobile/src/components/chat/blocks/data-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/event-block.tsx`
- `apps/mobile/src/components/chat/blocks/file-block.tsx`
- `apps/mobile/src/components/chat/blocks/gauge-block.tsx`
- `apps/mobile/src/components/chat/blocks/link-block.tsx`
- `apps/mobile/src/components/chat/blocks/number-block.tsx`
- `apps/mobile/src/components/chat/blocks/place-block.tsx`
- `apps/mobile/src/components/chat/blocks/progress-block.tsx`
- `apps/mobile/src/components/chat/blocks/progress-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/rating-block.tsx`
- `apps/mobile/src/components/chat/blocks/stats-block.tsx`
- `apps/mobile/src/components/chat/blocks/status-block.tsx`
- `apps/mobile/src/components/chat/blocks/table-block.tsx`
- `apps/mobile/src/components/chat/blocks/timeline-block.tsx`
- `apps/mobile/src/components/chat/blocks/weather-block.tsx`
- `apps/mobile/src/components/chat/bubble-gesture.tsx`
- `apps/mobile/src/components/chat/chat-actions-host.tsx`
- `apps/mobile/src/components/chat/chat-background.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/chat-header-bar.tsx`
- `apps/mobile/src/components/chat/chat-overlays.tsx`
- `apps/mobile/src/components/chat/chat-row-swipe.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/date-separator.tsx`
- `apps/mobile/src/components/chat/edit-bar.tsx`
- `apps/mobile/src/components/chat/emoji-category-bar.tsx`
- `apps/mobile/src/components/chat/emoji-rows.ts`
- `apps/mobile/src/components/chat/emoji-tab.tsx`
- `apps/mobile/src/components/chat/empty-chat.tsx`
- `apps/mobile/src/components/chat/forward-sheet.tsx`
- `apps/mobile/src/components/chat/forwarded-header.tsx`
- `apps/mobile/src/components/chat/gif-cells.tsx`
- `apps/mobile/src/components/chat/gif-paging.ts`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/group-header.tsx`
- `apps/mobile/src/components/chat/group-list-item.tsx`
- `apps/mobile/src/components/chat/handoff-line.tsx`
- `apps/mobile/src/components/chat/image-message.tsx`
- `apps/mobile/src/components/chat/jump-scroll.ts`
- `apps/mobile/src/components/chat/jump-to-bottom.tsx`
- `apps/mobile/src/components/chat/leave-topic-sheet.tsx`
- `apps/mobile/src/components/chat/link-text.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/media-meta-pill.tsx`
- `apps/mobile/src/components/chat/media-sheet-content.tsx`
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/chat/mention-picker.tsx`
- `apps/mobile/src/components/chat/mention-text.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble-tombstone.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/message-search-format.ts`
- `apps/mobile/src/components/chat/message-search-list.tsx`
- `apps/mobile/src/components/chat/message-search-scheduler.ts`
- `apps/mobile/src/components/chat/message-search.ts`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-message-sheet.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/question-card.tsx`
- `apps/mobile/src/components/chat/reaction-chips.tsx`
- `apps/mobile/src/components/chat/reply-quote.tsx`
- `apps/mobile/src/components/chat/routine-header.tsx`
- `apps/mobile/src/components/chat/search-header.tsx`
- `apps/mobile/src/components/chat/search-snippet.tsx`
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `apps/mobile/src/components/chat/selection-delete.tsx`
- `apps/mobile/src/components/chat/sticker-message.tsx`
- `apps/mobile/src/components/chat/topic-actions-sheet.tsx`
- `apps/mobile/src/components/chat/topic-done-row.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-mute-leave.tsx`
- `apps/mobile/src/components/chat/topic-not-in-row.tsx`
- `apps/mobile/src/components/chat/unread-divider.tsx`
- `apps/mobile/src/components/chat/use-bubble-reveal.ts`
- `apps/mobile/src/components/chat/use-draft-text.ts`
- `apps/mobile/src/components/chat/use-group-roles.ts`
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/use-message-search.ts`
- `apps/mobile/src/components/chat/voice-message.tsx`
- `apps/mobile/src/components/chat/voice-recorder-gesture.ts`
- `apps/mobile/src/components/chat/voice-recorder.tsx`
- `apps/mobile/src/components/chat/voice-recording-row.tsx`
- `apps/mobile/src/components/chat/voice-transcribe-confirm.tsx`
- `work/T-2105-fold-phone-chat.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 236 lower.

---

## Report (written by the worker when done)

### What I did

Folded 73 of the 77 rows: moved each small file's body into the importer above the
importer's own code, merged the import blocks (one import per module, no duplicate
specifiers, relative paths rewritten for the importer's folder), dropped the `export`
keyword from moved declarations, removed the importer's import of the small file and
deleted the small file. 73 files deleted, 33 importers changed.

Where the importer re-exported names from a folded file, the re-export became a local
export so no consumer changes: `gif-panel.tsx` keeps `GifCell`, `isPanelGifUrl`,
`fetchGifPage`, `probeGifsAvailability` (the last is imported by `composer-sheet.ts`,
which is outside this task's Allowed files), and `media-sheet.tsx` keeps
`MEDIA_EMPTY_TEXT`, `MEDIA_LOADING_TEXT` and `MediaSheetContentProps`.

Rows skipped (4, all "importer would go over 800 lines"):

- `blocks/choice-blocks.tsx` -> `blocks/block-card.tsx` (would be 887 lines)
- `blocks/chart-blocks.tsx` -> `blocks/block-card.tsx` (would be 885 lines)
- `blocks/progress-blocks.tsx` -> `blocks/block-card.tsx` (would be 971 lines)
- `blocks/content-blocks.tsx` -> `blocks/block-card.tsx` (would be 980 lines)

Their own child rows were still folded into them, so the four remaining files are now
205-316 lines each and `block-card.tsx` ends at 727 lines (under the 800 limit). No row
was skipped for lazy loading, config references or cycles; no test or fixture imported a
folded file, so no test import changed.

### Line counts

`git diff --numstat -- apps/mobile`: 4604 insertions, 5024 deletions, net **-420**
product lines (the acceptance asks for at least 236 lower). The 77 small files were
4976 lines before; 73 of them are gone.

### Checks run

`pnpm gate` (from the repo root):

```
gate: 106 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.6s)
PASS  lint  (0.7s)
PASS  typecheck  (4.9s)
PASS  effect  (1.7s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (1.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

The size warnings for the 9 importers between 400 and 800 lines are the expected soft
limit warnings, not failures. I ran no single test file by hand; the gate ran the nearest
mobile tests.

### Notes for the lead

- The gate flags moved comments that cite task IDs. I removed the ID from the six moved
  comment lines it reported (`attach-sheet.tsx` x2, `block-card.tsx` x2,
  `choice-blocks.tsx` x2); no other wording changed.
- Folding exposed three duplicate declarations, fixed without behaviour change:
  `content-blocks.tsx` had two `KEY` and two `TILE` constants from different blocks, now
  `DIRECTIONS_KEY` and `EVENT_TILE`; `attach-sheet.tsx` imported `AttachmentChoice` from
  itself (the folded file's type-only import of its importer), removed because the type is
  declared locally; `app/chat/[id].tsx` imported `ChatSummary` from both
  `@zilar/chat-core` and `@/lib/types` (the latter re-exports the former), so only the
  chat-core import remains.
- `block-card.tsx` at 727 lines is the one file close to the 800 line limit; the next
  block fold there (`choice-blocks`, 206 lines) would cross it.

## Review (written by Claude)

Approved; the pre-review was clean (2 nits: stale file names in moved comments). Net −420; 73 files folded into their only importer.
- **Sizes.** The largest results are `blocks/block-card.tsx` (727) and `message-bubble.tsx` (646). Both are under the 800 hard limit, and every fold removed import lines.
- **Phone emulator smoke:** `/`, `/chat/ana@zilar.test`, `/chat/viernes@rooms.zilar.test`, `/chat/acme@rooms.zilar.test` and `/chat/ai-dev-1@zilar.test` all PASS. The lead looked at the screenshots:
  - the AI chat shows the rich message blocks (headings, list, code, table, quote, link) and the steps card;
  - the channel shows its header, subscriber count and post.
- **Accepted:** the duplicate constants and imports exposed by the fold were renamed or removed without changing behaviour.
