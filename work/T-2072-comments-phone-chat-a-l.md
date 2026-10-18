---
id: T-2072
title: "Cut comments (phone chat components a–l): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2072-comments-phone-chat-a-l
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2072: Comment cut — phone chat components a–l

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **1443 comment lines in 76 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **721** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/mobile/src/components/chat/ai-activity-marks.tsx`
- `apps/mobile/src/components/chat/ai-badge.tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx`
- `apps/mobile/src/components/chat/ais-here-sheet.tsx`
- `apps/mobile/src/components/chat/album-grid.tsx`
- `apps/mobile/src/components/chat/album-members.tsx`
- `apps/mobile/src/components/chat/approval-card.tsx`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/attachment-message.tsx`
- `apps/mobile/src/components/chat/attachment-video.tsx`
- `apps/mobile/src/components/chat/avatar.tsx`
- `apps/mobile/src/components/chat/bubble-gesture.tsx`
- `apps/mobile/src/components/chat/channel-composer-bar.tsx`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/chat/chat-actions-host.tsx`
- `apps/mobile/src/components/chat/chat-actions-sheet.tsx`
- `apps/mobile/src/components/chat/chat-background.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/chat-header-bar.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/chat-jump-context.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/chat-list-page.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/chat-notice-context.tsx`
- `apps/mobile/src/components/chat/chat-overlays.tsx`
- `apps/mobile/src/components/chat/chat-picker-list.tsx`
- `apps/mobile/src/components/chat/chat-row-facts.tsx`
- `apps/mobile/src/components/chat/chat-row-swipe.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/composer-input-row.tsx`
- `apps/mobile/src/components/chat/composer-media.ts`
- `apps/mobile/src/components/chat/composer-mentions.ts`
- `apps/mobile/src/components/chat/composer-picked-strip.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/date-separator.tsx`
- `apps/mobile/src/components/chat/dm-chat-id.ts`
- `apps/mobile/src/components/chat/edit-bar.tsx`
- `apps/mobile/src/components/chat/emoji-category-bar.tsx`
- `apps/mobile/src/components/chat/emoji-rows.ts`
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/emoji-tab.tsx`
- `apps/mobile/src/components/chat/empty-chat.tsx`
- `apps/mobile/src/components/chat/entity-avatar.tsx`
- `apps/mobile/src/components/chat/file-bubble.tsx`
- `apps/mobile/src/components/chat/folder-icon.ts`
- `apps/mobile/src/components/chat/folder-pager.tsx`
- `apps/mobile/src/components/chat/folder-tabs.tsx`
- `apps/mobile/src/components/chat/forward-sheet.tsx`
- `apps/mobile/src/components/chat/forwarded-header.tsx`
- `apps/mobile/src/components/chat/gif-cells.tsx`
- `apps/mobile/src/components/chat/gif-paging.ts`
- `apps/mobile/src/components/chat/gif-panel.tsx`
- `apps/mobile/src/components/chat/group-action.ts`
- `apps/mobile/src/components/chat/group-header.tsx`
- `apps/mobile/src/components/chat/group-list-item.tsx`
- `apps/mobile/src/components/chat/group-manage-section.tsx`
- `apps/mobile/src/components/chat/group-roles-sheet.tsx`
- `apps/mobile/src/components/chat/group-topic-list.tsx`
- `apps/mobile/src/components/chat/handoff-line.tsx`
- `apps/mobile/src/components/chat/haptics.ts`
- `apps/mobile/src/components/chat/image-message.tsx`
- `apps/mobile/src/components/chat/image-viewer.tsx`
- `apps/mobile/src/components/chat/invite-links-sheet.tsx`
- `apps/mobile/src/components/chat/invite-sheet.tsx`
- `apps/mobile/src/components/chat/join-link.tsx`
- `apps/mobile/src/components/chat/jump-scroll.ts`
- `apps/mobile/src/components/chat/jump-to-bottom.tsx`
- `apps/mobile/src/components/chat/leave-topic-sheet.tsx`
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `apps/mobile/src/components/chat/link-text.tsx`
- `apps/mobile/src/components/chat/load-error.tsx`
- `work/T-2072-comments-phone-chat-a-l.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 721 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in all 76 Allowed files under `apps/mobile/src/components/chat/`, following `docs/COMMENTS.md`.

- Deleted task IDs and history, component/function JSDoc that restates the name or the render, per-prop JSDoc, banners, references to removed things, and commented-out code.
- Kept only WHY comments, shortened to 1–3 lines: trust and bearer-token rules (`attachment-message`, `attachment-video`, `avatar`, `image-viewer`, `chat-thread`), permission rules (`channel-composer-bar`, `channel-screen`, `ais-here-sheet`, `chat-picker-list`, `approval-card`'s forged-card check), protocol/data invariants (`dm-chat-id` XMPP localparts, XEP-0308, album grouping order, jump retries, GIF 501 probe), platform workarounds (Metro literal mock branch, Android keyboard height, Android 13 clipboard, Android `Modal` + `GestureHandlerRootView`, `justify-center` alignment, ScrollView height), units/limits (px, MiB, caps), and tool directives (`eslint-disable-next-line`, `effect-plain`, `@ts-expect-error`).

Numbers:

- `git diff main...HEAD --shortstat`: `76 files changed, 341 insertions(+), 1426 deletions(-)` (the 75 chat files plus this task file; the insertions include the 179-line task file from the spec commit). Chat folder alone: `75 files changed, 162 insertions(+), 1426 deletions(-)`.
- Comment lines in the group: 1443 before, 180 after — 1263 removed.
- Net source-line reduction: 1264 (target was at least 721).
- Comment lines kept longer than 3 lines: none (every kept block is 1–3 lines).

No code, string, import, type or formatting line changed: a script over `git diff -U0 -- apps/mobile/src/components/chat` reports 0 changed non-comment lines. The only extra line removals are blank lines left doubled by a deleted block (and one leading blank line in `emoji-rows.ts` that Prettier rejected).

### Checks run

- `pnpm install --frozen-lockfile`: Done in 18.2s.
- `pnpm gate` (final run, from the repo root), exit 0:

```
PASS  install (frozen)  (1.9s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (3.7s)
PASS  effect  (3.3s)
PASS  tests @zilar/mobile  (2.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run separately; this task changes comments only, so the gate's package tests were the only test run.

### Notes for the lead

- An earlier gate run failed `format` on `emoji-rows.ts` (a leading blank line left by a removed file-header JSDoc); it was removed and the final gate passes.
- I left the spec's Allowed-files list untouched and edited only comments in the listed chat files plus this task file's status/report.
- No blockers or open questions.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +162 -1426 net -1264; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
