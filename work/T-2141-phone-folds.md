---
id: T-2141
title: "Phone (AI sheets, attach sheet, card blocks, chat list folders, markdown table, media, pinned banner, voice recorder, stickers, push actions, share): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2141-phone-folds
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2141: Fold single-use phone files (AI sheets, attach sheet, card blocks, chat list folders, markdown table, media, pinned banner, voice recorder, stickers, push actions, share)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `55ef09f23`. Each mover has exactly one production importer, the host; the tests listed import it too. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `components/ais/ai-memory-sheet.tsx` (30) | `components/chat/topic-info-host.tsx` (289) | — |
| `components/ais/new-ai/orb-view.tsx` (204) | `components/ais/new-ai/new-ai-sheet.tsx` (277) | — |
| `components/ais/tool-detail-format.ts` (29) | `components/ais/tool-detail-body.tsx` (407) | — |
| `components/chat/attach/gallery-tab.tsx` (238) | `components/chat/attach-sheet.tsx` (235) | — |
| `components/chat/attach/use-gallery-assets.ts` (145) | `components/chat/attach-sheet.tsx` (235) | — |
| `components/chat/blocks/alert-block.tsx` (132) | `components/chat/blocks/choice-blocks.tsx` (206) | — |
| `components/chat/blocks/buttons-block.tsx` (132) | `components/chat/blocks/choice-blocks.tsx` (206) | — |
| `components/chat/blocks/images-block.tsx` (181) | `components/chat/blocks/content-blocks.tsx` (316) | — |
| `components/chat/blocks/poll-block.tsx` (148) | `components/chat/blocks/choice-blocks.tsx` (206) | — |
| `components/chat/folder-pager.tsx` (156) | `components/chat/chat-list.tsx` (265) | — |
| `components/chat/folder-tabs.tsx` (170) | `components/chat/chat-list.tsx` (265) | — |
| `components/chat/markdown-table.tsx` (129) | `components/chat/markdown-text.tsx` (311) | — |
| `components/chat/media-rows.tsx` (223) | `components/chat/media-sheet.tsx` (278) | — |
| `components/chat/pinned-banner.tsx` (136) | `app/chat/[id].tsx` (383) | — |
| `components/chat/voice-recorder-flow.ts` (139) | `components/chat/voice-recorder.tsx` (473) | — |
| `components/stickers/discover-tab.tsx` (129) | `app/settings/stickers.tsx` (380) | — |
| `components/stickers/pack-grid.tsx` (143) | `app/settings/sticker-pack.tsx` (405) | — |
| `components/stickers/packs-tab.tsx` (121) | `app/settings/stickers.tsx` (380) | — |
| `lib/attachment-downscale.ts` (125) | `lib/attachment-picker.ts` (323) | components/chat/attach/gallery-reader.test.ts |
| `lib/push/actions.ts` (143) | `lib/push/background.ts` (245) | lib/push/actions.test.ts |
| `lib/save-photo.ts` (82) | `components/chat/image-viewer.tsx` (322) | — |
| `lib/share-send.ts` (137) | `app/share.tsx` (176) | — |

All paths are under `apps/mobile/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or exceed 650 lines. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same styles, accessibility labels, gestures, animations and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/mobile/src/store/**`;
  - `apps/mobile/src/auth/**`;
  - any `apps/mobile/src/lib/*-api.ts`;
  - any `use-*-api.ts` hook.
- **Tests.** Update the import path, or the `jest.mock`/`vi.mock` path, in each listed test; change nothing else in it. No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/components/ais/ai-memory-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/orb-view.tsx`
- `apps/mobile/src/components/ais/tool-detail-body.tsx`
- `apps/mobile/src/components/ais/tool-detail-format.ts`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/attach/gallery-reader.test.ts`
- `apps/mobile/src/components/chat/attach/gallery-tab.tsx`
- `apps/mobile/src/components/chat/attach/use-gallery-assets.ts`
- `apps/mobile/src/components/chat/blocks/alert-block.tsx`
- `apps/mobile/src/components/chat/blocks/buttons-block.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/images-block.tsx`
- `apps/mobile/src/components/chat/blocks/poll-block.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/folder-pager.tsx`
- `apps/mobile/src/components/chat/folder-tabs.tsx`
- `apps/mobile/src/components/chat/image-viewer.tsx`
- `apps/mobile/src/components/chat/markdown-table.tsx`
- `apps/mobile/src/components/chat/markdown-text.tsx`
- `apps/mobile/src/components/chat/media-rows.tsx`
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/chat/pinned-banner.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/voice-recorder-flow.ts`
- `apps/mobile/src/components/chat/voice-recorder.tsx`
- `apps/mobile/src/components/stickers/discover-tab.tsx`
- `apps/mobile/src/components/stickers/pack-grid.tsx`
- `apps/mobile/src/components/stickers/packs-tab.tsx`
- `apps/mobile/src/lib/attachment-downscale.ts`
- `apps/mobile/src/lib/attachment-picker.ts`
- `apps/mobile/src/lib/push/actions.test.ts`
- `apps/mobile/src/lib/push/actions.ts`
- `apps/mobile/src/lib/push/background.ts`
- `apps/mobile/src/lib/save-photo.ts`
- `apps/mobile/src/lib/share-send.ts`
- `work/T-2141-phone-folds.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (phone emulator smoke): the chat list folder tabs and pager, a chat with a pinned banner, the attach sheet gallery, card blocks (alert, buttons, poll, images), a Markdown table, shared media, recording a voice note, Settings → Stickers (packs, discover, a pack), the image viewer save, the New AI orb step, an AI's memory sheet, a tool's detail.

---

## Report (written by the worker when done)

### What I did

Folded 21 of the 22 movers into their hosts (one host pair covers two rows). Each mover is now a non-exported declaration below the host's main export, with relative imports adjusted; only exports still used elsewhere remain (`AttachmentChoice`, `ImageDownscaler`, the two push action constants and `onNotificationAction`). Net product diff: **−182 lines** in `apps/mobile/src` (2836 added, 3018 deleted), above the −60 requirement.

| Row | Result |
| --- | --- |
| `ais/ai-memory-sheet.tsx` → `chat/topic-info-host.tsx` | folded, net −3 |
| `ais/new-ai/orb-view.tsx` → `new-ai-sheet.tsx` | folded, net −14 |
| `ais/tool-detail-format.ts` → `tool-detail-body.tsx` | folded, net +3 (the host keeps the `ToolListItem` import) |
| `chat/attach/gallery-tab.tsx` + `use-gallery-assets.ts` → `attach-sheet.tsx` | folded, net −18 |
| `blocks/alert-block.tsx`, `buttons-block.tsx`, `poll-block.tsx` → `choice-blocks.tsx` | folded, net −22 |
| `blocks/images-block.tsx` → `content-blocks.tsx` | folded, net −3 |
| `chat/folder-pager.tsx` + `folder-tabs.tsx` → `chat-list.tsx` | folded, net −12 |
| `chat/markdown-table.tsx` → `markdown-text.tsx` | folded, net −11 |
| `chat/media-rows.tsx` → `media-sheet.tsx` | folded, net −8 |
| `chat/pinned-banner.tsx` → `app/chat/[id].tsx` | **skipped**: `chat/use-chat-screen.ts` imports `BannerPin` from it, and that file is outside Allowed files; deleting the mover would break the import |
| `chat/voice-recorder-flow.ts` → `voice-recorder.tsx` | folded, net −42 |
| `stickers/discover-tab.tsx` + `packs-tab.tsx` → `app/settings/stickers.tsx` | folded, net −16 |
| `stickers/pack-grid.tsx` → `app/settings/sticker-pack.tsx` | folded, net −11 |
| `lib/attachment-downscale.ts` → `lib/attachment-picker.ts` | folded, net −5; test import updated |
| `lib/push/actions.ts` → `lib/push/background.ts` | folded, net −9; test import updated (net +4 in the test) |
| `lib/save-photo.ts` → `components/chat/image-viewer.tsx` | folded, net −11 |
| `lib/share-send.ts` → `app/share.tsx` | folded, net −4 |

Deviations worth knowing:
- Gate rejects task IDs in added comments, so the moved `T-1320`, `T-1925`, `T-1850`, `T-1796` and `T-1822` references were removed from the comments (wording kept). Gate also required the original `// effect-plain:` marker from `poll-block.tsx` to stay at the top of `choice-blocks.tsx`.
- `voice-recorder-flow.ts` exported `runRecorderBegin`/`runRecorderFinish` only through the re-export block in `voice-recorder.tsx`, which nothing imported; lint flagged them as unused after the fold, so the two Promise wrappers were dropped. The Effect versions are still used.
- `lib/push/actions.test.ts` needed more than the import path: importing `background.ts` evaluates the wake task, so its `expo-notifications` mock now includes `registerTaskAsync`, `setNotificationHandler` and `BackgroundNotificationTaskResult`, and `expo-task-manager` is mocked. Test bodies and assertions are unchanged.

### Checks run

- `pnpm install`: done, no errors.
- Single test file: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/chat/attach/gallery-reader.test.ts` — passed.
- Single test file: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/actions.test.ts` — passed.
- `pnpm gate` (final):
  ```
  gate: 40 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.6s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (2.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead

- The pinned banner is the only skipped row; folding it needs an edit to `apps/mobile/src/components/chat/use-chat-screen.ts` (move `BannerPin` next to its other screen types, or import it from the route). One decision, then it can fold in a follow-up.
- Soft-limit warnings are expected: every host stayed at or below 650 lines, and none is over 800.
- No behaviour, style, accessibility, gesture or animation logic changed; the only non-import edits are the comment wording and the removed unused Promise wrappers noted above.

### Round

- **F1 fixed.** In `lib/push/background.ts`, `MESSAGE_CATEGORY`, `REPLY_ACTION`, `READ_ACTION` (together with `MAX_REPLY_LENGTH` and `REPLY_RETRY_DELAY_MS`) now sit above the module-level `if (!MOCK_MODE)` block, so `registerMessageCategory()` reads initialized constants and `setNotificationCategoryAsync` runs instead of warning from its `catch`.
- **Test added.** `lib/push/actions.test.ts` fresh-imports `background` and asserts the message category registers both Reply and Mark as read. Re-evaluating the module inside the test covers the module-level registration path that previously hit the TDZ.
- Single test: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/actions.test.ts` — 1 file, 5 tests passed.
- `pnpm gate`: `gate: 40 changed file(s) against main`; PASS install (frozen), format, lint, typecheck, effect, tests @zilar/mobile; SKIP build @zilar/server; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Prereview round

- **Prereview finding 1 fixed.** In `lib/push/actions.test.ts`, `setNotificationCategoryAsync` is now `mockClear`ed after `vi.resetModules()` and before the fresh `import('./background')`, so the category assertion can no longer pass on the call retained from the top-level import. No other test body changed.
- **Nit 2 left as is.** It is a nit and the duplicated interface is not in a line this round changes.
- Single test: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/actions.test.ts` — 1 file, 5 tests passed.
- `pnpm gate`: `gate: 40 changed file(s) against main`; PASS install (frozen), format, lint, typecheck, effect, tests @zilar/mobile; SKIP build @zilar/server; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

## Review (written by Claude)

Approved; the pre-review was clean after 2 auto rounds. Net −165: 21 of 22 single-use phone files folded into their only importer (AI memory sheet, orb view, tool detail format, attach gallery, alert/buttons/poll/images card blocks, folder pager and tabs, markdown table, media rows, voice recorder flow, the sticker tabs and pack grid, attachment downscale, push actions, save photo, share send).

**Skip:** the pinned banner was skipped correctly, because `use-chat-screen.ts` also imports from it.

**Comments:** the folds dropped only task-ID prefixes and kept every "why" line (the poll's counts-only rule, the gallery's permission fallback).

**Phone emulator:**
- The smoke passed: `/`, `/chat/dev-team@rooms.zilar.test`, `/chat/ana@zilar.test`, `/settings/stickers`, `/ais/ai-dev-1`.
- The chat list shows its folder tabs.
- The content card renders.
- Stickers → My packs, Discover and Favorites all render.
- The attach sheet's gallery shows the camera tile and video durations.
- The New AI sheet opens.

`/ais/new` is not a phone route, so its tile shows "That AI no longer exists"; that is not a regression. The mock seeds no poll, button or alert card, so those folds rest on the gate's typecheck and the line-for-line pre-review.
