---
id: T-2079
title: "Cut comments (web component folders): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2079-comments-web-components-folders
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2079: Comment cut — web component folders

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2314 comment lines in 240 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

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
3. The target is to remove at least **1157** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/web/src/components/ais/AiActivity.tsx`
- `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/web/src/components/ais/AiDangerZone.tsx`
- `apps/web/src/components/ais/AiDelegationSection.tsx`
- `apps/web/src/components/ais/AiFormFields.tsx`
- `apps/web/src/components/ais/AiHealthRow.tsx`
- `apps/web/src/components/ais/AiMachineSection.tsx`
- `apps/web/src/components/ais/AiMemoryDialog.tsx`
- `apps/web/src/components/ais/AiMemorySection.tsx`
- `apps/web/src/components/ais/AiPageShell.tsx`
- `apps/web/src/components/ais/AiPanel.tsx`
- `apps/web/src/components/ais/AiPictureSection.tsx`
- `apps/web/src/components/ais/AiUsageSection.tsx`
- `apps/web/src/components/ais/ConnectionPicker.tsx`
- `apps/web/src/components/ais/LimitsFields.tsx`
- `apps/web/src/components/ais/ModelPicker.tsx`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/ais/aiForm.ts`
- `apps/web/src/components/ais/aiPanelOps.ts`
- `apps/web/src/components/ais/errors.ts`
- `apps/web/src/components/ais/limits.ts`
- `apps/web/src/components/ais/models.ts`
- `apps/web/src/components/ais/new-ai/KeyStep.tsx`
- `apps/web/src/components/ais/new-ai/ModelStep.tsx`
- `apps/web/src/components/ais/new-ai/OrbPicker.tsx`
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/web/src/components/ais/new-ai/SetupStep.tsx`
- `apps/web/src/components/ais/new-ai/orb-png.ts`
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/approvals/AlwaysAllowedList.tsx`
- `apps/web/src/components/approvals/ApprovalRow.tsx`
- `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx`
- `apps/web/src/components/attach/AttachMenu.tsx`
- `apps/web/src/components/attach/AttachSendDialog.tsx`
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/InviteCodeField.tsx`
- `apps/web/src/components/auth/OtpInput.tsx`
- `apps/web/src/components/avatar/CropDialog.tsx`
- `apps/web/src/components/avatar/avatarErrors.ts`
- `apps/web/src/components/avatar/avatarImageCodec.ts`
- `apps/web/src/components/background/BackgroundImages.tsx`
- `apps/web/src/components/background/backgroundOps.ts`
- `apps/web/src/components/background/backgroundWrites.ts`
- `apps/web/src/components/channel-info/ChannelAisPage.tsx`
- `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/web/src/components/chatList/ChatListMenu.tsx`
- `apps/web/src/components/chatList/ContactRequestsRow.tsx`
- `apps/web/src/components/chatList/GroupHeaderRow.tsx`
- `apps/web/src/components/chatList/PreviewLine.tsx`
- `apps/web/src/components/chatList/RequestRows.tsx`
- `apps/web/src/components/chatList/rowsSelector.ts`
- `apps/web/src/components/composer/AttachmentStrip.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `apps/web/src/components/composer/composerShared.ts`
- `apps/web/src/components/composer/formatShortcut.ts`
- `apps/web/src/components/composer/useComposerAttachments.ts`
- `apps/web/src/components/composer/useComposerFocus.ts`
- `apps/web/src/components/composer/useDraftValue.ts`
- `apps/web/src/components/composer/useMentions.ts`
- `apps/web/src/components/composer/useRecordingLifecycle.ts`
- `apps/web/src/components/composer/useVoiceRecorder.ts`
- `apps/web/src/components/connections/AddKeyDialog.tsx`
- `apps/web/src/components/connections/ConnectionRow.tsx`
- `apps/web/src/components/connections/ReplaceKeyForm.tsx`
- `apps/web/src/components/folder/ChatPicker.tsx`
- `apps/web/src/components/folder/folderEditorModel.ts`
- `apps/web/src/components/group-info/AvatarStack.tsx`
- `apps/web/src/components/group-info/ContentNav.tsx`
- `apps/web/src/components/group-info/GroupExit.tsx`
- `apps/web/src/components/group-info/GroupInfoPage.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/group-info/MemberRow.tsx`
- `apps/web/src/components/group-info/PeoplePage.tsx`
- `apps/web/src/components/group-info/TopicsSection.fixture.tsx`
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/machines/AddMachineButton.tsx`
- `apps/web/src/components/machines/AddMachineDialog.tsx`
- `apps/web/src/components/machines/ApprovedMachineCard.tsx`
- `apps/web/src/components/machines/ApprovedRow.tsx`
- `apps/web/src/components/machines/MachineListRow.tsx`
- `apps/web/src/components/machines/MachineListSkeleton.tsx`
- `apps/web/src/components/machines/PendingMachineCard.tsx`
- `apps/web/src/components/machines/PendingRow.tsx`
- `apps/web/src/components/machines/RevokedMachineCard.tsx`
- `apps/web/src/components/machines/RevokedRow.tsx`
- `apps/web/src/components/machines/errors.ts`
- `apps/web/src/components/machines/machineRowOps.ts`
- `apps/web/src/components/media/MediaBody.tsx`
- `apps/web/src/components/media/MediaViewer.tsx`
- `apps/web/src/components/media/mediaModel.ts`
- `apps/web/src/components/media/trusted-media.ts`
- `apps/web/src/components/media/useShowInChat.ts`
- `apps/web/src/components/media/viewerSlides.ts`
- `apps/web/src/components/message/AlbumGrid.tsx`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/BigEmoji.tsx`
- `apps/web/src/components/message/EmptyChat.tsx`
- `apps/web/src/components/message/HandoffLine.tsx`
- `apps/web/src/components/message/LinkPreviewCard.tsx`
- `apps/web/src/components/message/MediaMetaPill.tsx`
- `apps/web/src/components/message/MessageMenu.tsx`
- `apps/web/src/components/message/MessageMenuBody.tsx`
- `apps/web/src/components/message/MessageTextBody.tsx`
- `apps/web/src/components/message/MessageTombstone.tsx`
- `apps/web/src/components/message/QuestionCard.tsx`
- `apps/web/src/components/message/RoutineHeader.tsx`
- `apps/web/src/components/message/SendFailure.tsx`
- `apps/web/src/components/message/blocks/AlertBlock.tsx`
- `apps/web/src/components/message/blocks/BarsBlock.tsx`
- `apps/web/src/components/message/blocks/BlockCard.fixture.tsx`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/BlockRespond.tsx`
- `apps/web/src/components/message/blocks/ButtonsBlock.tsx`
- `apps/web/src/components/message/blocks/CalloutBlock.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.tsx`
- `apps/web/src/components/message/blocks/ChecklistBlock.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlock.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/web/src/components/message/blocks/CountdownBlock.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.tsx`
- `apps/web/src/components/message/blocks/EventBlock.tsx`
- `apps/web/src/components/message/blocks/FigureBlock.tsx`
- `apps/web/src/components/message/blocks/FileBlock.tsx`
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `apps/web/src/components/message/blocks/GaugeBlock.tsx`
- `apps/web/src/components/message/blocks/ImagesBlock.tsx`
- `apps/web/src/components/message/blocks/LineBlock.tsx`
- `apps/web/src/components/message/blocks/LinkBlock.tsx`
- `apps/web/src/components/message/blocks/NumberBlock.tsx`
- `apps/web/src/components/message/blocks/PlaceBlock.tsx`
- `apps/web/src/components/message/blocks/PollBlock.tsx`
- `apps/web/src/components/message/blocks/ProgressBlock.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.tsx`
- `apps/web/src/components/message/blocks/RatingBlock.tsx`
- `apps/web/src/components/message/blocks/StatsBlock.tsx`
- `apps/web/src/components/message/blocks/StatusBlock.tsx`
- `apps/web/src/components/message/blocks/TableBlock.tsx`
- `apps/web/src/components/message/blocks/TimelineBlock.tsx`
- `apps/web/src/components/message/blocks/WeatherBlock.tsx`
- `apps/web/src/components/message/blocks/blockIcons.ts`
- `apps/web/src/components/message/blocks/blockKey.ts`
- `apps/web/src/components/message/blocks/choiceStyles.ts`
- `apps/web/src/components/message/bubbleFlags.ts`
- `apps/web/src/components/message/doubleClickReply.ts`
- `apps/web/src/components/message/use-message-menu.ts`
- `apps/web/src/components/panels/ChannelAdminsSection.tsx`
- `apps/web/src/components/panels/GroupAiRowView.tsx`
- `apps/web/src/components/panels/GroupAiSection.tsx`
- `apps/web/src/components/panels/GroupPictureSection.tsx`
- `apps/web/src/components/panels/GroupRolesSection.tsx`
- `apps/web/src/components/panels/GroupSettingSwitch.tsx`
- `apps/web/src/components/panels/TopicActionButtons.tsx`
- `apps/web/src/components/panels/TopicAddDialog.fixture.tsx`
- `apps/web/src/components/panels/TopicAddDialog.tsx`
- `apps/web/src/components/panels/TopicAisSection.tsx`
- `apps/web/src/components/panels/TopicDangerZone.tsx`
- `apps/web/src/components/panels/TopicHeader.tsx`
- `apps/web/src/components/panels/TopicListNotices.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `apps/web/src/components/panels/TopicRolesSection.tsx`
- `apps/web/src/components/panels/TopicRulesSection.tsx`
- `apps/web/src/components/panels/TopicToolsRow.tsx`
- `apps/web/src/components/panels/channelPanelOps.ts`
- `apps/web/src/components/panels/groupPanelOps.ts`
- `apps/web/src/components/panels/panelLists.ts`
- `apps/web/src/components/panels/topic-failure.ts`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/push/DevicesSection.tsx`
- `apps/web/src/components/push/MutedChatsSection.tsx`
- `apps/web/src/components/push/PreviewsSection.tsx`
- `apps/web/src/components/push/ThisDeviceCard.tsx`
- `apps/web/src/components/routines/RoutineRow.tsx`
- `apps/web/src/components/settings/hub/rows.ts`
- `apps/web/src/components/settings/integrationErrors.ts`
- `apps/web/src/components/settings/useIntegrationSave.ts`
- `apps/web/src/components/sticker/BlobPreview.tsx`
- `apps/web/src/components/sticker/EmojiCategoryBar.tsx`
- `apps/web/src/components/sticker/EmojiTab.tsx`
- `apps/web/src/components/sticker/FavoriteRow.tsx`
- `apps/web/src/components/sticker/FavoriteStar.tsx`
- `apps/web/src/components/sticker/PackEditorForm.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `apps/web/src/components/sticker/PackLinkRow.tsx`
- `apps/web/src/components/sticker/PackMenu.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/sticker/PackThumbs.tsx`
- `apps/web/src/components/sticker/StickerGrid.tsx`
- `apps/web/src/components/sticker/StickerThumb.tsx`
- `apps/web/src/components/sticker/TilePopover.tsx`
- `apps/web/src/components/sticker/packEditorModel.ts`
- `apps/web/src/components/sticker/pageActions.ts`
- `apps/web/src/components/sticker/usePackSave.ts`
- `apps/web/src/components/tools/CodeBlock.tsx`
- `apps/web/src/components/tools/DeleteToolButton.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/tools/ToolRunSection.tsx`
- `apps/web/src/components/tools/ToolSourceSection.tsx`
- `apps/web/src/components/tools/ToolsSection.tsx`
- `apps/web/src/components/tools/toolDetailOps.ts`
- `apps/web/src/components/topic/AiActivityMarks.tsx`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/web/src/components/topic/AisHereKey.tsx`
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `apps/web/src/components/topic/TopicLinkRow.tsx`
- `apps/web/src/components/topic/TopicMuteLeave.tsx`
- `apps/web/src/components/topic/TopicNotInRow.tsx`
- `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx`
- `apps/web/src/components/topic/TopicPeopleLine.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/checkbox.tsx`
- `apps/web/src/components/ui/chip.tsx`
- `apps/web/src/components/ui/combobox.tsx`
- `apps/web/src/components/ui/dialog-parts.tsx`
- `apps/web/src/components/ui/dialog-stepper.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/icon-button.tsx`
- `apps/web/src/components/ui/list-row.tsx`
- `apps/web/src/components/ui/menu.tsx`
- `apps/web/src/components/ui/panel-key.tsx`
- `apps/web/src/components/ui/screen-header.tsx`
- `apps/web/src/components/ui/segmented-control.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/sortable-list.tsx`
- `apps/web/src/components/ui/state-message.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/components/ui/well.tsx`
- `work/T-2079-comments-web-components-folders.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1157 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments in all 240 Allowed files, following `docs/COMMENTS.md`: deleted task IDs and history, component/prop narration, JSDoc that only repeated parameters, design-board references, banners and stale references; shortened surviving multi-line blocks to the fewest lines that keep the why. Kept security/privacy notes (untrusted media URLs, fixed user-facing error sentences, never deleting a user's saved key, owner-only stop), protocol/data invariants (album ids and index order, 404 meaning, protocol-pinned icon names, expand/contract unknown values), platform/library workarounds (StrictMode object-URL revoke, jsdom pointer capture, Base UI nested backdrop, `scrollend` on older Safari, `exactOptionalPropertyTypes`) and units/limits (400 ms, 256 px, 4 KB/16 KiB, 48 h).

Only comment lines changed, plus blank lines left doubled by a removed block. No code, string, import, type or formatting was edited. Three short comments were kept inside otherwise-empty `catch` blocks (`RequestRows`, `PollBlock`) and one prop note (`TopicsSection`) because deleting them made Prettier rewrite the surrounding code; that would have been a code change.

Diff check: a script parsed `git diff -U0` against the original comment-block ranges: every removed line is a comment or a blank line from a removed block, and every added line is a comment line or blank.

### Checks run

`pnpm gate` (final run) summary:

```
gate: waiting for a free gate slot
gate: 241 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (3.8s)
PASS  lint  (1.6s)
PASS  typecheck  (1.0s)
PASS  effect  (8.7s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/web  (6.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run (comment-only change). `git diff main...HEAD --shortstat`: `241 files changed, 660 insertions(+), 2230 deletions(-)` (this includes the branch's spec and `docs/COMMENTS.md` commits). Source-only diff of this commit: `240 files changed, 292 insertions(+), 2230 deletions(-)`, a net removal of 1938 lines.

Comments kept longer than 3 lines (start line in the final file, reason):

- `ais/ConnectionPicker.tsx:7` — GitHub connections cannot run an AI.
- `ais/new-ai/orb-png.ts:10` — 256 px output; null blob means no encoder.
- `chatList/rowsSelector.ts:17` — cached rows keep typing/presence from re-rendering.
- `composer/formatShortcut.ts:81` — layout-effect selection restore before paint.
- `composer/useDraftValue.ts:33` — edit stash keyed by user and chat; no cross-account restore.
- `media/trusted-media.ts:3` — untrusted URL would leak the reader's IP.
- `media/viewerSlides.ts:5` — same-origin file route checks session and membership.
- `message/AlbumGrid.tsx:31` — sanitizer downgrades untrusted hosts to `file`.
- `message/BigEmoji.tsx:38` — zero-width caret prevents layout shift.
- `message/QuestionCard.tsx:16` — one-tap answer closes the question; reload reads it back.
- `message/blocks/ImagesBlock.tsx:22` — same-origin cookie authenticates media.
- `panels/panelLists.ts:89` — a failed re-read never shows a deleted row as failed.
- `panels/topic-failure.ts:4` — user-facing errors are fixed sentences.
- `settings/hub/rows.ts:25` — shared route list; no dead links on web.
- `settings/useIntegrationSave.ts:15` — reload is part of the action; success never lies.
- `sticker/BlobPreview.tsx:4` — StrictMode revoke/recreate race.
- `sticker/FavoriteStar.tsx:9` — request must roll back after the row leaves.
- `sticker/StickerThumb.tsx:8` — hostile localStorage URL is never fetched.
- `sticker/pageActions.ts:29` — fixed sentence vs raw server text.
- `tools/CodeBlock.tsx:4` — text-only rendering keeps tool output inert.
- `tools/RoutinesSection.tsx:56` — "no such scope" reads as an empty list.
- `tools/RoutinesSection.tsx:185` — deleted row stays mounted for the parent's settle step.
- `tools/ToolsSection.tsx:125` — same no-such-scope handling.
- `topic/TopicLinkRow.tsx:24` — parser/`new URL` mismatch falls back instead of crashing.
- `topic/TopicPeopleLine.tsx:67` — stable orb seed until names arrive.
- `ui/checkbox.tsx:11` — caller's row `<label>` toggles it.
- `ui/dialog.tsx:23` — Base UI drops a nested dialog's backdrop.
- `ui/sheet.tsx:14` — shared focus/Escape/Tab behaviour with `Dialog`.
- `ui/sortable-list.tsx:42` — readable dnd-kit live-region announcements.

### Notes for the lead

- Removed 1933 comment lines from the 240 files (well above the 1157 target); the source diff is a net 1938 lines lighter.
- Final shortstat above includes this task file's report and the branch's spec/docs commits; the source-only figure is the one to compare against the target.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +292 -2230 net -1938; non-comment changed lines: 2. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
