---
id: T-2118
title: "Fold 60 small single-use files into the one file that imports each (web, part 3 (redo of T-2104 on current main)): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2118-fold-web-c
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2118: Fold single-use files (web, part 3 (redo of T-2104 on current main))

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 60 files total 5195 lines, 369 of them import lines.

- `apps/web/src/components/message/blocks/blockKey.ts` (5) → `apps/web/src/components/message/blocks/ContentBlocks.tsx` (251)
- `apps/web/src/routes/ExploreRoute.tsx` (27) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/routes/LoginPage.tsx` (41) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/components/folder/FolderHideSection.tsx` (65) → `apps/web/src/components/FolderEditorDialog.tsx` (209)
- `apps/web/src/store/groupStoreTypes.ts` (65) → `apps/web/src/store/store.ts` (235)
- `apps/web/src/components/MentionPicker.tsx` (65) → `apps/web/src/components/composer/ComposerControls.tsx` (323)
- `apps/web/src/components/panels/TopicToolsRow.tsx` (65) → `apps/web/src/components/TopicPanel.tsx` (418)
- `apps/web/src/components/ui/dialog-parts.tsx` (66) → `apps/web/src/components/ui/dialog.tsx` (132)
- `apps/web/src/components/ais/AiDelegationSection.tsx` (66) → `apps/web/src/components/ais/AiPanel.tsx` (357)
- `apps/web/src/components/NewGroupMembers.tsx` (67) → `apps/web/src/components/NewGroupDialog.tsx` (337)
- `apps/web/src/components/ais/AiUsageSection.tsx` (67) → `apps/web/src/components/ais/AiPanel.tsx` (357)
- `apps/web/src/components/panels/TopicHeader.tsx` (68) → `apps/web/src/components/TopicPanel.tsx` (418)
- `apps/web/src/lib/push/pageActions.ts` (69) → `apps/web/src/lib/push/usePushEnable.ts` (322)
- `apps/web/src/components/machines/ApprovedRow.tsx` (71) → `apps/web/src/components/machines/MachineListRow.tsx` (85)
- `apps/web/src/components/folder/FolderIconPicker.tsx` (71) → `apps/web/src/components/FolderEditorDialog.tsx` (209)
- `apps/web/src/components/ais/new-ai/ModelStep.tsx` (73) → `apps/web/src/components/ais/NewAiDialog.tsx` (83)
- `apps/web/src/components/attach/AttachMenu.tsx` (73) → `apps/web/src/components/composer/ComposerControls.tsx` (323)
- `apps/web/src/components/push/DevicesSection.tsx` (74) → `apps/web/src/routes/NotificationsPage.tsx` (264)
- `apps/web/src/components/connections/ReplaceKeyForm.tsx` (76) → `apps/web/src/components/connections/ConnectionRow.tsx` (192)
- `apps/web/src/components/topic/TopicNotInRow.tsx` (76) → `apps/web/src/components/Composer.tsx` (372)
- `apps/web/src/components/topic/TopicMuteLeave.tsx` (78) → `apps/web/src/components/TopicPanel.tsx` (418)
- `apps/web/src/components/topic/AiStatusLine.tsx` (78) → `apps/web/src/routes/ChatView.tsx` (503)
- `apps/web/src/components/sticker/PackMenu.tsx` (79) → `apps/web/src/components/sticker/PackRows.tsx` (132)
- `apps/web/src/components/ChatMediaPanel.tsx` (79) → `apps/web/src/routes/ChatView.tsx` (503)
- `apps/web/src/components/settings/hub/rows.ts` (85) → `apps/web/src/routes/SettingsHubPage.tsx` (141)
- `apps/web/src/routes/IntegrationsPage.tsx` (85) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/components/machines/MachineListRow.tsx` (85) → `apps/web/src/routes/MachinesPage.tsx` (351)
- `apps/web/src/components/MessageSearchResult.tsx` (86) → `apps/web/src/components/MessageSearchResults.tsx` (260)
- `apps/web/src/routes/NamePage.tsx` (86) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/components/SearchBar.tsx` (87) → `apps/web/src/components/ChatList.tsx` (250)
- `apps/web/src/lib/push/badge.ts` (88) → `apps/web/src/lib/push.ts` (286)
- `apps/web/src/components/machines/RevokedMachineCard.tsx` (88) → `apps/web/src/routes/MachinesPage.tsx` (351)
- `apps/web/src/components/ais/AiMachineSection.tsx` (89) → `apps/web/src/components/ais/AiPanel.tsx` (357)
- `apps/web/src/components/ais/AiComputerSection.tsx` (92) → `apps/web/src/components/ais/AiPanel.tsx` (357)
- `apps/web/src/components/ais/new-ai/SetupStep.tsx` (93) → `apps/web/src/components/ais/NewAiDialog.tsx` (83)
- `apps/web/src/components/FolderTabs.tsx` (95) → `apps/web/src/components/ChatList.tsx` (250)
- `apps/web/src/components/background/backgroundWrites.ts` (95) → `apps/web/src/components/ChatBackgroundDialog.tsx` (324)
- `apps/web/src/components/tools/ToolSourceSection.tsx` (96) → `apps/web/src/components/tools/ToolDetailPanel.tsx` (282)
- `apps/web/src/components/ImageMessage.tsx` (96) → `apps/web/src/components/message/AttachmentBody.tsx` (363)
- `apps/web/src/components/sticker/EmojiCategoryBar.tsx` (98) → `apps/web/src/components/sticker/EmojiTab.tsx` (232)
- `apps/web/src/routes/ConnectionsPage.tsx` (99) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/components/FileMessage.tsx` (100) → `apps/web/src/components/message/AttachmentBody.tsx` (363)
- `apps/web/src/components/useMessageWindow.ts` (103) → `apps/web/src/components/MessageList.tsx` (373)
- `apps/web/src/lib/drafts.ts` (104) → `apps/web/src/store/effects/ports.ts` (318)
- `apps/web/src/store/effects/send.ts` (105) → `apps/web/src/store/effects/chatActions.ts` (250)
- `apps/web/src/components/auth/OtpInput.tsx` (105) → `apps/web/src/components/auth/AuthFlow.tsx` (285)
- `apps/web/src/components/ExportSection.tsx` (105) → `apps/web/src/components/ProfileSettingsSection.tsx` (315)
- `apps/web/src/components/push/MutedChatsSection.tsx` (106) → `apps/web/src/routes/NotificationsPage.tsx` (264)
- `apps/web/src/components/avatar/CropDialog.tsx` (108) → `apps/web/src/components/AvatarUploader.tsx` (282)
- `apps/web/src/components/tools/ToolRunSection.tsx` (110) → `apps/web/src/components/tools/ToolDetailPanel.tsx` (282)
- `apps/web/src/components/composer/AttachmentStrip.tsx` (110) → `apps/web/src/components/composer/ComposerControls.tsx` (323)
- `apps/web/src/components/panels/panelLists.ts` (112) → `apps/web/src/components/panels/topicPanelOps.ts` (262)
- `apps/web/src/routes/ChatShell.tsx` (112) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/routes/AisPage.tsx` (113) → `apps/web/src/routes/AppRoutes.tsx` (283)
- `apps/web/src/components/sticker/PackEditorForm.tsx` (114) → `apps/web/src/components/PackEditor.tsx` (266)
- `apps/web/src/store/effects/portAdapters.ts` (114) → `apps/web/src/store/effects/ports.ts` (318)
- `apps/web/src/components/composer/formatShortcut.ts` (114) → `apps/web/src/components/Composer.tsx` (372)
- `apps/web/src/components/settings/TelegramCard.tsx` (115) → `apps/web/src/routes/IntegrationsPage.tsx` (85)
- `apps/web/src/store/chatGroups.ts` (119) → `apps/web/src/store/store.ts` (235)
- `apps/web/src/components/group-info/PeoplePage.tsx` (119) → `apps/web/src/components/GroupPanel.tsx` (321)

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
- `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/web/src/components/ais/AiDelegationSection.tsx`
- `apps/web/src/components/ais/AiMachineSection.tsx`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/web/src/components/ais/AiUsageSection.tsx`
- `apps/web/src/components/ais/new-ai/ModelStep.tsx`
- `apps/web/src/components/ais/new-ai/SetupStep.tsx`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/attach/AttachMenu.tsx`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/OtpInput.tsx`
- `apps/web/src/components/avatar/CropDialog.tsx`
- `apps/web/src/components/AvatarUploader.tsx`
- `apps/web/src/components/background/backgroundWrites.ts`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/ChatMediaPanel.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/composer/AttachmentStrip.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/composer/formatShortcut.ts`
- `apps/web/src/components/connections/ConnectionRow.tsx`
- `apps/web/src/components/connections/ReplaceKeyForm.tsx`
- `apps/web/src/components/ExportSection.tsx`
- `apps/web/src/components/FileMessage.tsx`
- `apps/web/src/components/folder/FolderHideSection.tsx`
- `apps/web/src/components/folder/FolderIconPicker.tsx`
- `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/FolderTabs.tsx`
- `apps/web/src/components/group-info/PeoplePage.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/ImageMessage.tsx`
- `apps/web/src/components/machines/ApprovedRow.tsx`
- `apps/web/src/components/machines/MachineListRow.tsx`
- `apps/web/src/components/machines/RevokedMachineCard.tsx`
- `apps/web/src/components/MentionPicker.tsx`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/blocks/blockKey.ts`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageSearchResult.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/NewGroupMembers.tsx`
- `apps/web/src/components/PackEditor.tsx`
- `apps/web/src/components/panels/panelLists.ts`
- `apps/web/src/components/panels/TopicHeader.tsx`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/panels/TopicToolsRow.tsx`
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/push/DevicesSection.tsx`
- `apps/web/src/components/push/MutedChatsSection.tsx`
- `apps/web/src/components/SearchBar.tsx`
- `apps/web/src/components/settings/hub/rows.ts`
- `apps/web/src/components/settings/TelegramCard.tsx`
- `apps/web/src/components/sticker/EmojiCategoryBar.tsx`
- `apps/web/src/components/sticker/EmojiTab.tsx`
- `apps/web/src/components/sticker/PackEditorForm.tsx`
- `apps/web/src/components/sticker/PackMenu.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/tools/ToolRunSection.tsx`
- `apps/web/src/components/tools/ToolSourceSection.tsx`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/web/src/components/topic/TopicMuteLeave.tsx`
- `apps/web/src/components/topic/TopicNotInRow.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/ui/dialog-parts.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/useMessageWindow.ts`
- `apps/web/src/lib/drafts.ts`
- `apps/web/src/lib/push.ts`
- `apps/web/src/lib/push/badge.ts`
- `apps/web/src/lib/push/pageActions.ts`
- `apps/web/src/lib/push/usePushEnable.ts`
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/ChatShell.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/ExploreRoute.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/LoginPage.tsx`
- `apps/web/src/routes/MachinesPage.tsx`
- `apps/web/src/routes/NamePage.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `apps/web/src/routes/SettingsHubPage.tsx`
- `apps/web/src/store/chatGroups.ts`
- `apps/web/src/store/effects/chatActions.ts`
- `apps/web/src/store/effects/portAdapters.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/send.ts`
- `apps/web/src/store/groupStoreTypes.ts`
- `apps/web/src/store/store.ts`
- `apps/web/src/components/topic/TopicNotInRow.fixture.tsx`
- `work/T-2118-fold-web-c.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 184 lower.

---

## Report (written by the worker when done)

### What I did

Folded 56 of the 60 rows: each small file's code moved into its only importer, above the declaration that uses it; imports merged to one statement per module (deduped by resolved path); the importer's import of the small file removed; the small file deleted; `export` dropped except where another file still imports the name.

Line counts (product code, `apps/web/src`):
- 92 product files changed: **5192 insertions, 5390 deletions, net −198 lines** (acceptance: at least 184 lower).
- 56 small files deleted (5195 lines in the spec's count); 36 importers grew.
- Largest resulting importers: `AiPanel.tsx` 656, `ChatView.tsx` 653, `TopicPanel.tsx` 626 — all under the 800 hard limit. `pnpm gate` reports the 400-line soft-limit warnings only.

Skipped rows (4), all because `AppRoutes.tsx` loads them lazily with `lazy(() => import(...))`, so code splitting has to stay:
- `ExploreRoute.tsx` (27) → `AppRoutes.tsx`
- `LoginPage.tsx` (41) → `AppRoutes.tsx`
- `ConnectionsPage.tsx` (99) → `AppRoutes.tsx`
- `IntegrationsPage.tsx` (85) → `AppRoutes.tsx`

Other files touched:
- `apps/web/src/components/topic/TopicNotInRow.fixture.tsx`: now imports `TopicNotInRow` from `../Composer`, since the small file is gone.

### Checks run

`pnpm install` — done (19.2s).
`pnpm gate` (from the repo root), final run:

```
PASS  install (frozen)  (5.1s)
PASS  format  (5.9s)
PASS  lint  (2.5s)
PASS  typecheck  (2.1s)
PASS  effect  (5.7s)
SKIP  build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/web  (16.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

`size` also printed the expected soft-limit warnings (400 lines) for 16 merged importers; the largest is 656. No single test file was run separately during the task; the gate ran `@zilar/web` tests once.

### Notes for the lead

- `folderUnread` was deleted from `store/store.ts` (it came in from `chatGroups.ts`). It was exported from `store.ts` only through the re-export line that folding removes, and nothing in the repo imports it; keeping the declaration without `export` failed `no-unused-vars`. `ChatGroup` and `ChatStoreGroupApi` re-exports were similarly removed, but both interfaces stayed in `store.ts` and are still used there.
- `lib/push.ts` already re-exported `push/badge`; that re-export line was removed and the badge code now lives in `push.ts` with the same exported names (`updateAppBadge`, `dismissChatNotifications`, plus the `totalBadgeUnread` re-export from `chat-core`). Its duplicated module comment was removed.
- Two real name collisions from folding were resolved without behaviour change: `ConnectionRow.tsx` had two identical `messageOf` helpers (one kept), and `ChatList.tsx` had React's `KeyboardEvent` shadowing the DOM one used by the folded `SearchBar` (React's type is now imported as `ReactKeyboardEvent`).
- `ports.ts` folds `drafts.ts` and `portAdapters.ts`; their relative imports were rebased to the new directory and `OpenDraftStream` is now imported directly from `@zilar/client-core/store` (the small file's re-export used to provide it). The obsolete "this module imports types from ./ports only" comment was removed.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit: a leftover `export` on `UsageBlock`). Net −198; 56 single-use web files folded on current main. This replaces T-2104, whose rebase conflicted on 26 files. The largest results are `ais/AiPanel.tsx` (656), `routes/AppRoutes.tsx` (575) and `composer/ComposerControls.tsx` (578).
- **Lead check** (`tmp/cc/dangling.py`): no file anywhere references any of the 56 deleted paths.
- **Web mock** (`:5244`):
  - all 25 routes render with no page errors;
  - the Dev-1 AI panel opens in full, and the Dev-1 chat shows its blocks;
  - the composer shows the Emoji, Stickers (19 images) and GIFs tabs;
  - `/settings/stickers` lists the packs.
