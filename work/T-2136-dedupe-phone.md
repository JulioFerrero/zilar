---
id: T-2136
title: "Clean-up (phone): remove duplicated blocks the clone scan found (visibility fields vs sheet, attachment body/video/message vs media bubble, chat row vs topic row, people line vs avatar stack, group info vs group/channel screens, bubble pieces, screen shells, and more) — each block lives once, no behaviour change"
status: merged
milestone: M5
branch: task/T-2136-dedupe-phone
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2136: One copy of each duplicated block (phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `e4a868766` (windows of 6 normalised lines, ignoring imports, blanks and comments). It covers `apps/mobile/src`, excluding the store, mocks, tests and the files T-2134 and T-2135 hold tonight. These pairs share the same code; the line ranges are where the copies sit.

| # | File A (lines) | File B (lines) | Shared lines |
| --- | --- | --- | ---: |
| 1 | `components/chat/visibility-fields.tsx` (41-55, 65-73, 86-106) | `components/chat/visibility-sheet.tsx` (149-163, 173-181, 194-214) | 22 |
| 2 | `components/chat/attachment-body.tsx` (43-59, 73-81, 150-159) | `components/chat/media-bubble.tsx` (115-131, 176-184, 254-263) | 19 |
| 3 | `components/chat/attachment-video.tsx` (116-123, 185-196) | `components/chat/media-bubble.tsx` (318-325, 400-411) | 15 |
| 4 | `components/chat/chat-list-item.tsx` (85-149) | `components/chat/topic-row.tsx` (90-150) | 15 |
| 5 | `components/chat/topic-people-line.tsx` (54-72) | `components/group-info/avatar-stack.tsx` (14-32) | 13 |
| 6 | `components/chat/attachment-message.tsx` (33-51) | `components/chat/attachment-video.tsx` (24-42) | 12 |
| 7 | `app/group-info/[id].tsx` (150-158, 260-267, 538-549) | `app/group/[id].tsx` (336-344, 355-362, 550-561) | 11 |
| 8 | `app/group-info/[id].tsx` (414-533) | `components/chat/channel-screen.tsx` (87-129, 592-656) | 11 |
| 9 | `components/chat/attachment-message.tsx` (89-94) | `components/chat/media-bubble.tsx` (342-347) | 11 |
| 10 | `components/chat/message-bubble-content.tsx` (109-114, 488-502) | `components/chat/message-bubble-decor.tsx` (121-135, 151-156) | 11 |
| 11 | `components/chat/message-bubble-content.tsx` (296-303, 412-423) | `components/chat/plain-bubble-body.tsx` (275-295, 326-346) | 10 |
| 12 | `components/ais/screen-shell.tsx` (33-54) | `components/settings/screen-shell.tsx` (93-114) | 9 |
| 13 | `components/chat/message-bubble-actions.tsx` (34-44, 86-93) | `components/chat/message-menu-host.tsx` (18-28, 53-60) | 9 |
| 14 | `components/ais/routines-section.tsx` (140-148) | `components/ais/tools-section.tsx` (134-142) | 8 |
| 15 | `app/settings/blocked.tsx` (107-115) | `app/settings/requests.tsx` (144-152) | 7 |
| 16 | `components/chat/blocks/chart-blocks.tsx` (40-57) | `components/chat/blocks/line-block.tsx` (31-48) | 6 |

All paths are under `apps/mobile/src/`.

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy where the concept lives (a component, a hook or a helper) and make the other file use it. For example, `visibility-sheet.tsx` renders `visibility-fields.tsx`; the media bubble pieces share one helper; the two screen shells become one.
2. **Not a real copy:** if the shared window is only a call site or a hook's destructured return, skip the pair and say so in the Report.
3. **Genuinely different behaviour:** leave the pair and say why in the Report.
4. **Keep the sum smaller:** a shared piece must save more lines than it adds. If it doesn't, revert it and say so.

### Rules
- No behaviour change, no visual change: the same styles, the same accessibility labels and the same gestures.
- Do not touch:
  - `apps/mobile/src/store/**`;
  - any `apps/mobile/src/lib/*-api.ts`;
  - any `use-*-api.ts` hook;
  - `apps/mobile/src/components/chat/sticker-panel.tsx`, `gif-panel.tsx`, `chat-composer-dock.tsx`, `link-preview-card.tsx`, `new-chat-button.tsx`, `chat-search-results.tsx`;
  - `apps/mobile/src/app/settings/integrations.tsx`.

  T-2134 and T-2135 hold those files tonight.
- **Pair 12 (screen shells):** share the duplicated block inside the two shell files (one imports a piece from the other). Do not change any file that imports a shell.
- No new tests.

### Allowed files
- `apps/mobile/src/components/chat/visibility-fields.tsx`
- `apps/mobile/src/components/chat/visibility-sheet.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/attachment-video.tsx`
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/group-info/avatar-stack.tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/message-menu-host.tsx`
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/tools-section.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/line-block.tsx`
- `apps/mobile/src/components/chat/media-shared.tsx` (new, only if a media helper needs a home)
- `work/T-2136-dedupe-phone.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 80.
- The Report lists each pair: done, with lines saved, or skipped, and why.
- **Lead check:** a phone smoke of:
  - the chat list (rows and topic rows);
  - a chat with photos, a video and a file;
  - group info and its visibility sheet;
  - a channel;
  - an AI page (tools and routines);
  - Settings → Blocked and Requests;
  - a chart card.

---

## Report (written by the worker when done)

### What I did

Product lines went down by **131** (touched files −208, new `components/chat/media-shared.tsx` +77), with no intended behaviour or visual change: every moved block kept its markup, classes, accessibility labels and handlers.

New file: `apps/mobile/src/components/chat/media-shared.tsx` (media upload props, failed/overlay pieces, the album-first viewer hook).

Pair by pair:

1. **visibility fields vs sheet — done, ~25 lines.** `VisibilityChoice` and `HandleCheckField` now live in `visibility-fields.tsx`; the create fields, the sheet and the new group binder all render them. `visibilityReasonText` moved here too, so the old sheet → fields import direction is gone. Accessibility labels (`Visibility`, `Private`/`Public`, `Group handle`) and all classes are unchanged.
2. **attachment body vs media bubble — done, part of the media group (41 lines).** The album-first `viewerPhotos`/`startIndex` scoping is one `useAttachmentViewer` hook in `media-shared.tsx`; both media bodies use it.
3. **attachment video vs media bubble — done, part of the media group.** `UploadFailed` and `UploadOverlay` are shared, including the image attachment's identical overlay.
4. **chat list row vs topic row — skipped.** The overlapping window is the pinned/muted icons and time interleaved with row-specific branches (drafts and `unreadMark` only exist in the chat row; topics add lock/activity and use a different muted icon and flex classes). Sharing the row body would take ~12 props and either change classes or add lines.
5. **topic people line vs avatar stack — done, 31 lines.** `Stack` is deleted; the line uses `AvatarStack`. Same 22 px size, ring, overlap and avatar.
6. **attachment message vs attachment video — done, part of the media group.** `MediaUploadProps` holds the shared trusted-host/local-preview/upload fields; both components extend it (the image props do too).
7. **group info vs group screen — skipped.** The shared window is one effect plus three derived locals and the `NewTopicSheet`/visibility prop blocks. A shared helper needs a new module outside the Allowed files, and importing one route screen from the other would couple route modules. No behaviour change is worth that.
8. **group info vs channel screen — done, ~2 lines net.** `GroupVisibilitySheet` binds the hook state to the one sheet; both screens now pass `state`, `groupTitle` and `share`. The wrapper is 34 lines against the 18-line prop block per screen, so the win is small but positive; it is the single place the sheet is bound.
9. **attachment message vs media bubble (gradient props) — skipped.** Only the `LinearGradient` start/end props match; a wrapper would save ~2 lines and add a layer, so it is not smaller.
10. **message bubble content vs decor — done for the duplicated props, ~19 lines.** `BigEmojiBubble` now takes `ComponentProps<typeof BigEmoji>` instead of repeating the six props. The meta pill was left: one is an absolute photo overlay, the other a raised centred pill, with different colours.
11. **message bubble content vs plain bubble body — reverted.** Extracted `BubbleMetaTail` into `plain-bubble-body.tsx`, but the component (30 lines) plus three 7-line call sites cost more than the three 12-line blocks: +16 lines. Reverted per rule 4.
12. **screen shells — attempted and reverted.** A shared `ScreenScaffold` added +36 lines net (AI shell +56, settings −20): the footer, pull spinner and the two body layouts need a props-heavy wrapper. Reverted per rule 4; both shell files are untouched.
13. **message bubble actions vs menu host — done, 8 lines.** `BubbleActionsTarget` is exported from `message-bubble-actions.tsx`; `MessageMenuTarget` is an alias in the host. `albumMembers` became optional in the target type, which is a widening only.
14. **routines vs tools sections — done, 5 lines.** `SectionError` (message + Retry) lives in `routines-section.tsx`; the tools section renders it.
15. **blocked vs requests — skipped.** The match is the five-line error `Text` and its condition; a shared component needs a home in one settings screen and saves under a line, so it is not smaller.
16. **chart blocks vs line block — attempted and reverted.** `BlockHeading` replaced a 15-line block in both files but the component itself is ~20 lines (+5 net). Reverted per rule 4; both files are untouched.

### Checks run

- `pnpm install`: done (12.8s, 1299 resolved).
- No single test file was run: this is a UI-only move with no new tests asked for. The gate ran the mobile package tests.
- `pnpm gate` (from the repo root), final run:
  - `PASS  install (frozen)  (6.2s)`
  - `PASS  format  (5.2s)`
  - `PASS  lint  (3.3s)`
  - `PASS  typecheck  (13.5s)`
  - `PASS  effect  (2.2s)`
  - `SKIP  build @zilar/server (no server, package or manifest change)`
  - `PASS  tests @zilar/mobile  (2.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Soft size warnings only: `group-info/[id].tsx` 534 (main 552), `channel-screen.tsx` 656 (main 674), `message-bubble-actions.tsx` 401 (main 397), `message-bubble-content.tsx` 496 (main 515). No file is over 800.
- Earlier gate runs failed on format (3 files, fixed with Prettier) and lint (an unused `Button` import in `tools-section.tsx`, removed); the final run above is green.

### Notes for the lead

- Phone smoke still needed: chat list rows and topic rows (pair 4 untouched), a chat with photo/video/file, group info → visibility sheet, a channel → visibility sheet, AI tools/routines error+retry, Settings → Blocked/Requests (untouched), and a chart card (pair 16 untouched).
- `message-bubble-actions.tsx` is at 401 lines, one over the soft limit, because the target type moved here; it stays a single file, per the "never split only for the limit" rule.
- Pair 8's win is small (2 lines); the value is that the sheet state is bound in one place. If you prefer a bigger win there, the screens could call `VisibilitySheet` directly again.

## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −131 on the phone. The duplicated blocks now live once:
- `visibility-sheet` renders the shared fields from `visibility-fields`;
- the attachment body, video and message share helpers in the new `media-shared.tsx` with the media bubble;
- the people line reuses the avatar stack;
- group info and the channel screen share their duplicated rows;
- the bubble content, decor and menu host pieces are deduplicated;
- the routines and tools sections are deduplicated.

**Phone emulator:**
- The smoke passed: `/`, `/chat/ana@zilar.test`, `/chat/dev-team@rooms.zilar.test`, `/group-info/g-devteam`, `/chat/acme@rooms.zilar.test`, `/ais/ai-dev-1`, `/settings/requests`.
- Group info → Settings → Visibility → Public plus `devteam7` saves ("Saved.", Copy share link).
- Long-pressing an own message opens the full menu (reactions, Reply, Forward, Select, Edit, Copy text, Delete, Pin), and Reply puts "Reply to You" above the composer.
