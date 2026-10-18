---
id: T-2103
title: "Fold 65 small single-use files into the one file that imports each (web, part 1): the code moves into its importer, duplicate imports merge, the small file goes — no behaviour change"
status: merged
milestone: M5
branch: task/T-2103-fold-web-a
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2103: Fold single-use files (web, part 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down. A file over 400 lines is fine when it saves lines; never split only for the number, and only a file over 800 lines must split.

The 10-10 split rule left many small files with exactly one importer. Each one repeats an import block, an export line and the importer's import line.

### Facts (the lead's import graph, 2026-10-18 at `e42276bc7`)
Each row below is `small file (lines) → its only production importer (lines)`. The lead resolved every relative and `@/` import, including dynamic `import()`. The 65 files total 2350 lines, 226 of them import lines.

- `apps/web/src/lib/errors.ts` (4) → `apps/web/src/components/panels/channelPanelOps.ts` (39)
- `apps/web/src/routes/InvitePage.tsx` (8) → `apps/web/src/routes/AppRoutes.tsx` (229)
- `apps/web/src/lib/api/agent-tasks.ts` (10) → `apps/web/src/components/StepsPanel.tsx` (233)
- `apps/web/src/lib/sticker-motion.ts` (10) → `apps/web/src/lib/sticker-images.ts` (361)
- `apps/web/src/components/UnreadDivider.tsx` (11) → `apps/web/src/components/MessageListRow.tsx` (120)
- `apps/web/src/components/media/viewerSlides.ts` (14) → `apps/web/src/components/media/MediaViewer.tsx` (108)
- `apps/web/src/lib/useContactRequests.ts` (14) → `apps/web/src/components/chatList/RequestRows.tsx` (265)
- `apps/web/src/components/ais/aiForm.ts` (14) → `apps/web/src/components/ais/AiPanel.tsx` (344)
- `apps/web/src/components/TypingDots.tsx` (15) → `apps/web/src/components/ChatHeaderLines.tsx` (55)
- `apps/web/src/components/DateSeparator.tsx` (15) → `apps/web/src/components/MessageListRow.tsx` (120)
- `apps/web/src/components/machines/AddMachineButton.tsx` (15) → `apps/web/src/routes/MachinesPage.tsx` (199)
- `apps/web/src/lib/api/devices.ts` (15) → `apps/web/src/routes/DevicesPage.tsx` (226)
- `apps/web/src/components/media/trusted-media.ts` (15) → `apps/web/src/components/message/AttachmentBody.tsx` (330)
- `apps/web/src/components/ForwardedHeader.tsx` (15) → `apps/web/src/components/MessageBubble.tsx` (366)
- `apps/web/src/components/panels/TopicRulesSection.tsx` (17) → `apps/web/src/components/TopicPanel.tsx` (343)
- `apps/web/src/routes/ProfilePage.tsx` (18) → `apps/web/src/routes/AppRoutes.tsx` (229)
- `apps/web/src/lib/useClientVersionCheck.ts` (20) → `apps/web/src/components/ClientVersionBanner.tsx` (25)
- `apps/web/src/components/ais/AiPictureSection.tsx` (23) → `apps/web/src/components/ais/AiPanel.tsx` (344)
- `apps/web/src/components/ClientVersionBanner.tsx` (25) → `apps/web/src/App.tsx` (35)
- `apps/web/src/components/EditBar.tsx` (25) → `apps/web/src/components/composer/ComposerControls.tsx` (301)
- `apps/web/src/components/auth/InviteCodeField.tsx` (26) → `apps/web/src/components/auth/AuthFlow.tsx` (263)
- `apps/web/src/routes/ExploreRoute.tsx` (27) → `apps/web/src/routes/AppRoutes.tsx` (229)
- `apps/web/src/components/media/useShowInChat.ts` (28) → `apps/web/src/components/media/MediaRows.tsx` (115)
- `apps/web/src/components/push/PreviewsSection.tsx` (28) → `apps/web/src/routes/NotificationsPage.tsx` (180)
- `apps/web/src/components/sticker/FavoriteRow.tsx` (29) → `apps/web/src/routes/StickersPage.tsx` (311)
- `apps/web/src/components/avatar/avatarErrors.ts` (32) → `apps/web/src/components/AvatarUploader.tsx` (250)
- `apps/web/src/components/panels/GroupPictureSection.tsx` (32) → `apps/web/src/components/GroupPanel.tsx` (292)
- `apps/web/src/components/sticker/PackLinkRow.tsx` (33) → `apps/web/src/routes/StickerPackPage.tsx` (194)
- `apps/web/src/components/ComposerDock.tsx` (33) → `apps/web/src/routes/ChatView.tsx` (366)
- `apps/web/src/App.tsx` (35) → `apps/web/src/main.tsx` (18)
- `apps/web/src/components/machines/MachineListSkeleton.tsx` (35) → `apps/web/src/routes/MachinesPage.tsx` (199)
- `apps/web/src/lib/useVoiceTranscription.ts` (35) → `apps/web/src/components/VoiceMessage.tsx` (303)
- `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx` (36) → `apps/web/src/routes/ApprovalsPage.tsx` (181)
- `apps/web/src/routes/AddContactRoute.tsx` (36) → `apps/web/src/routes/AppRoutes.tsx` (229)
- `apps/web/src/components/MessageAnnouncer.tsx` (36) → `apps/web/src/components/MessageList.tsx` (248)
- `apps/web/src/lib/api/machines.ts` (37) → `apps/web/src/lib/api.ts` (50)
- `apps/web/src/components/ais/new-ai/orb-png.ts` (37) → `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` (242)
- `apps/web/src/lib/api/topics.ts` (41) → `apps/web/src/lib/api.ts` (50)
- `apps/web/src/routes/LoginPage.tsx` (41) → `apps/web/src/routes/AppRoutes.tsx` (229)
- `apps/web/src/components/background/PresetGrid.tsx` (41) → `apps/web/src/components/ChatBackgroundDialog.tsx` (282)
- `apps/web/src/lib/handles.ts` (43) → `apps/web/src/routes/HandlePage.tsx` (194)
- `apps/web/src/components/AttachmentPreview.tsx` (44) → `apps/web/src/components/composer/AttachmentStrip.tsx` (69)
- `apps/web/src/store/storeOptions.ts` (44) → `apps/web/src/store/store.ts` (212)
- `apps/web/src/components/ReactionChips.tsx` (48) → `apps/web/src/components/MessageBubble.tsx` (366)
- `apps/web/src/components/TopicKeyboardNav.tsx` (49) → `apps/web/src/components/chatList/ChatListBody.tsx` (198)
- `apps/web/src/components/machines/RevokedRow.tsx` (49) → `apps/web/src/routes/MachinesPage.tsx` (199)
- `apps/web/src/components/ChannelComposerBar.tsx` (49) → `apps/web/src/routes/ChatView.tsx` (366)
- `apps/web/src/components/approvals/ApprovalRow.tsx` (52) → `apps/web/src/routes/ApprovalsPage.tsx` (181)
- `apps/web/src/components/ReplyQuote.tsx` (52) → `apps/web/src/components/MessageBubble.tsx` (366)
- `apps/web/src/components/sticker/BlobPreview.tsx` (53) → `apps/web/src/components/sticker/TilePopover.tsx` (228)
- `apps/web/src/components/MarkdownText.tsx` (54) → `apps/web/src/components/message/MessageTextBody.tsx` (93)
- `apps/web/src/lib/voice/waveform.ts` (55) → `apps/web/src/components/composer/useVoiceRecorder.ts` (302)
- `apps/web/src/components/ChatHeaderLines.tsx` (55) → `apps/web/src/components/ChatHeader.tsx` (339)
- `apps/web/src/components/panels/ChannelAdminsSection.tsx` (56) → `apps/web/src/components/channel-info/ChannelAisPage.tsx` (116)
- `apps/web/src/components/sticker/PackEditorItems.tsx` (57) → `apps/web/src/components/PackEditor.tsx` (211)
- `apps/web/src/components/sticker/FavoriteStar.tsx` (57) → `apps/web/src/components/sticker/StickerGrid.tsx` (217)
- `apps/web/src/components/useMessageSelection.ts` (57) → `apps/web/src/routes/ChatView.tsx` (366)
- `apps/web/src/components/ais/LimitsFields.tsx` (58) → `apps/web/src/components/ais/AiFormFields.tsx` (104)
- `apps/web/src/components/composer/useDraftValue.ts` (60) → `apps/web/src/components/Composer.tsx` (315)
- `apps/web/src/components/tools/DeleteToolButton.tsx` (61) → `apps/web/src/components/tools/ToolDetailPanel.tsx` (229)
- `apps/web/src/components/panels/TopicDangerZone.tsx` (61) → `apps/web/src/components/TopicPanel.tsx` (343)
- `apps/web/src/components/push/ThisDeviceCard.tsx` (62) → `apps/web/src/routes/NotificationsPage.tsx` (180)
- `apps/web/src/lib/api/sessionGone.ts` (63) → `apps/web/src/store/effects/ports.ts` (262)
- `apps/web/src/lib/topicsUi.ts` (65) → `apps/web/src/components/ChatList.tsx` (192)
- `apps/web/src/components/machines/PendingRow.tsx` (65) → `apps/web/src/routes/MachinesPage.tsx` (199)

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
- `apps/web/src/App.tsx`
- `apps/web/src/components/ais/aiForm.ts`
- `apps/web/src/components/ais/AiFormFields.tsx`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/web/src/components/ais/AiPictureSection.tsx`
- `apps/web/src/components/ais/LimitsFields.tsx`
- `apps/web/src/components/ais/new-ai/orb-png.ts`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/approvals/ApprovalRow.tsx`
- `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx`
- `apps/web/src/components/AttachmentPreview.tsx`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/InviteCodeField.tsx`
- `apps/web/src/components/avatar/avatarErrors.ts`
- `apps/web/src/components/AvatarUploader.tsx`
- `apps/web/src/components/background/PresetGrid.tsx`
- `apps/web/src/components/channel-info/ChannelAisPage.tsx`
- `apps/web/src/components/ChannelComposerBar.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/ChatHeaderLines.tsx`
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/web/src/components/chatList/RequestRows.tsx`
- `apps/web/src/components/ClientVersionBanner.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/composer/AttachmentStrip.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/composer/useDraftValue.ts`
- `apps/web/src/components/composer/useVoiceRecorder.ts`
- `apps/web/src/components/ComposerDock.tsx`
- `apps/web/src/components/DateSeparator.tsx`
- `apps/web/src/components/EditBar.tsx`
- `apps/web/src/components/ForwardedHeader.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/machines/AddMachineButton.tsx`
- `apps/web/src/components/machines/MachineListSkeleton.tsx`
- `apps/web/src/components/machines/PendingRow.tsx`
- `apps/web/src/components/machines/RevokedRow.tsx`
- `apps/web/src/components/MarkdownText.tsx`
- `apps/web/src/components/media/MediaRows.tsx`
- `apps/web/src/components/media/MediaViewer.tsx`
- `apps/web/src/components/media/trusted-media.ts`
- `apps/web/src/components/media/useShowInChat.ts`
- `apps/web/src/components/media/viewerSlides.ts`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/MessageTextBody.tsx`
- `apps/web/src/components/MessageAnnouncer.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/MessageListRow.tsx`
- `apps/web/src/components/PackEditor.tsx`
- `apps/web/src/components/panels/ChannelAdminsSection.tsx`
- `apps/web/src/components/panels/channelPanelOps.ts`
- `apps/web/src/components/panels/GroupPictureSection.tsx`
- `apps/web/src/components/panels/TopicDangerZone.tsx`
- `apps/web/src/components/panels/TopicRulesSection.tsx`
- `apps/web/src/components/push/PreviewsSection.tsx`
- `apps/web/src/components/push/ThisDeviceCard.tsx`
- `apps/web/src/components/ReactionChips.tsx`
- `apps/web/src/components/ReplyQuote.tsx`
- `apps/web/src/components/StepsPanel.tsx`
- `apps/web/src/components/sticker/BlobPreview.tsx`
- `apps/web/src/components/sticker/FavoriteRow.tsx`
- `apps/web/src/components/sticker/FavoriteStar.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `apps/web/src/components/sticker/PackLinkRow.tsx`
- `apps/web/src/components/sticker/StickerGrid.tsx`
- `apps/web/src/components/sticker/TilePopover.tsx`
- `apps/web/src/components/tools/DeleteToolButton.tsx`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/TopicKeyboardNav.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/TypingDots.tsx`
- `apps/web/src/components/UnreadDivider.tsx`
- `apps/web/src/components/useMessageSelection.ts`
- `apps/web/src/components/VoiceMessage.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api/agent-tasks.ts`
- `apps/web/src/lib/api/devices.ts`
- `apps/web/src/lib/api/machines.ts`
- `apps/web/src/lib/api/sessionGone.ts`
- `apps/web/src/lib/api/topics.ts`
- `apps/web/src/lib/errors.ts`
- `apps/web/src/lib/handles.ts`
- `apps/web/src/lib/sticker-images.ts`
- `apps/web/src/lib/sticker-motion.ts`
- `apps/web/src/lib/topicsUi.ts`
- `apps/web/src/lib/useClientVersionCheck.ts`
- `apps/web/src/lib/useContactRequests.ts`
- `apps/web/src/lib/useVoiceTranscription.ts`
- `apps/web/src/lib/voice/waveform.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/routes/AddContactRoute.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/ApprovalsPage.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/routes/DevicesPage.tsx`
- `apps/web/src/routes/ExploreRoute.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/web/src/routes/InvitePage.tsx`
- `apps/web/src/routes/LoginPage.tsx`
- `apps/web/src/routes/MachinesPage.tsx`
- `apps/web/src/routes/NotificationsPage.tsx`
- `apps/web/src/routes/ProfilePage.tsx`
- `apps/web/src/routes/StickerPackPage.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/store.ts`
- `apps/web/src/store/storeOptions.ts`
- `apps/web/src/components/media/trusted-media.test.ts`
- `apps/web/src/lib/api/sessionGone.test.ts`
- `work/T-2103-fold-web-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 113 lower.

---

## Report (written by the worker when done)

### What I did

Folded 62 of the 65 listed single-use files into their only importer: moved each file's code
(and its imports, merged per module and de-duplicated) directly after the importer's import
block, removed the importer's import of the folded file, dropped `export` from names nothing
else imports, and deleted the 62 small files. Updated the two tests that imported folded files
(`trusted-media.test.ts`, `sessionGone.test.ts`) to import the same names from the importer.

Skipped rows (lazy imports, code splitting kept):
- `routes/LoginPage.tsx` -> `routes/AppRoutes.tsx` (`lazy(() => import('./LoginPage'))`)
- `routes/ExploreRoute.tsx` -> `routes/AppRoutes.tsx` (`lazy(() => import('./ExploreRoute'))`)
- `components/MarkdownText.tsx` -> `components/message/MessageTextBody.tsx` (`lazy(() => import('../MarkdownText'))`)

No other row hit a skip rule: no importer went over 800 lines (largest: `ChatView.tsx` 503,
`MessageBubble.tsx` 480), none of the 62 is named by a config/script/entry point, and no fold
created a cycle.

Line counts (`git diff main --numstat -- apps/web`): 2153 added, 2358 deleted, net **-205**
product lines (acceptance was at least -113).

Deviations from the letter of the spec, all behaviour-neutral:
- Moved code sits immediately after the importer's import block (above every declaration),
  not right above each usage, to keep original declaration order and avoid splitting comments.
- Three dead exported names had no importer anywhere, so they could not stay exported and would
  fail `noUnusedLocals` as locals: removed `resetVoiceTranscriptionCache` (was in
  `lib/useVoiceTranscription.ts`), `isRateLimited` (was in `lib/handles.ts`) and the unused
  `AiFormState` interface (was in `ais/aiForm.ts`). No caller existed for any of them.
- In `useNewAiFlow.ts` the folded `OrbParams` type was renamed `OrbPngParams` to avoid the
  importer's existing module-level `OrbParams`; in `HandlePage.tsx` the folded generic arrow
  became `<A,>` because the file is `.tsx`.
- `lib/api.ts` keeps the exports it used to re-export (`machineSchema`, `topicSchema`, machine
  and topic types), since consumers import them from `@/lib/api`; the old `export *` lines for
  the folded api modules were removed.
- `sessionGone.test.ts` mocks now target `@/lib/api/chats` and `@/lib/auth`, the modules the
  folded code imports.

### Checks run

- `pnpm install`: Done in 36.7s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/media/trusted-media.test.ts src/lib/api/sessionGone.test.ts`:
  2 files passed, 9 tests passed.
- `pnpm gate`:
  ```
  gate: 109 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (2.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.6s)
  PASS  effect  (2.1s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/web  (15.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Size warnings only: `ChatHeader.tsx` 407, `MessageBubble.tsx` 480, `TopicPanel.tsx` 418,
  `ChatView.tsx` 503 lines (all under 800; the spec allows keeping them whole to save lines).

### Notes for the lead

- 62 files deleted; the 3 lazy routes above remain as separate files.

## Review (written by Claude)

Approved; the pre-review was clean ("62 folds verified move-only"). Net −205, 62 files deleted. The three lazily loaded routes stay as their own files, so code splitting is unchanged.
- **Web mock, all 25 routes** (`:5237`, `tmp/shots/routes.mjs`): every route renders with no page errors, including `/`, three chats, every settings page, `/explore`, `/u/marta`, `/invite/abc` and `/welcome/name`.
- `/stickers/cats` says "not available" on both this branch and main: the mock has no pack with that id.
