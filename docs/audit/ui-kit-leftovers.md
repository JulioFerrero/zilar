# UI kit leftovers audit (T-0406)

Docs-only audit. No code, config or package changes. Written 2026-10-06 in the
`task/T-0406-ui-kit-leftovers-audit` worktree.

This lists what is still hand-rolled **outside** the two UI kits after the
migration series (`T-0374` … `T-0403`). It is the source list for the next
migration tasks, so every row cites a `file:line` that was opened and read.

- **Web kit** (`apps/web/src/components/ui/`): `Button`
  (`button.tsx`), `IconButton` (`icon-button.tsx`), `StateMessage`
  (`state-message.tsx`), `MenuItem`/`MenuRadioItem` (`menu.tsx`), `TextInput`/
  `TextArea`/`SecretInput` (`text-input.tsx`), `SearchField`, `SegmentedControl`,
  `Switch`, `Checkbox`, `Dialog`, `Sheet`, `ListRow`, `Card`, `Badge`, `Well`.
- **Mobile kit** (`apps/mobile/src/components/ui/`): `Button`, `IconButton`,
  `StateMessage`, `TextField`, `SearchField`, `SegmentedControl`, `Switch`,
  `Checkbox`, `ActionSheet`, `BottomSheet`, `ConfirmDialog`, `ListRow`, `Card`,
  `CountBadge`, `IconTile`, `Text`.

## How this audit was made (and what it excludes)

- Every `*.tsx`/`*.ts` under both `src` trees was scanned for raw `<button>`,
  `<a>`, `Link`, `<Pressable>`, `<TouchableOpacity>`, `<input>`, `<textarea>`,
  `<TextInput>`, `ActivityIndicator` and `Loader2`; each cited line was then
  read with context.
- Test coverage was found by following importers one level up, per
  `docs/LEAD_HANDOFF.md` ("Go one level up as well"): the file's own test, the
  tests of every file that imports it, and sibling tests. Test paths below are
  relative to `apps/web/src/` or `apps/mobile/src/`.
- The kit guards already pass: `apps/web/src/components/ui/no-accent-pill.test.ts`
  and `apps/mobile/src/components/ui/no-solid-pill.test.ts` prove no hand-rolled
  **solid `bg-accent`/`key-primary`/`bg-danger` pill** is left on a button. The
  leftovers below are the non-accent controls (ghost, outline, icon keys, chips,
  menu items) plus states and fields.
- **Table 1 is about controls that act as a button, an icon button, a menu item
  or a chip.** Navigation rows, cards, tabs, radios, checkboxes, switches, grid
  and emoji cells, modal backdrops and inline text links are **not** buttons;
  they are either owned by another kit component (`ListRow`, `Card`,
  `SegmentedControl`, `Switch`, `Checkbox`) or kept by design (table 4). They are
  not counted in table 1, to keep the migration batches actionable.

---

# Web

## W1. Buttons and links styled as buttons

| File:line | What it is today (visible text) | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |
| `apps/web/src/components/MentionPicker.tsx:30` | Mention option row (`role="option"`), the member name | `MenuItem` (`ui/menu`) | `components/MentionPicker.test.tsx`, `components/Composer.test.tsx` |
| `apps/web/src/components/MessageActionsMenu.tsx:58` | "React with {emoji}" menu item (`role="menuitem"`) | `MenuItem` (`ui/menu`) | none found |
| `apps/web/src/components/NewTopicDialog.tsx:235` | "Type" chips: Channel / Group (`aria-pressed`) | `SegmentedControl` | `components/NewTopicDialog.test.tsx`, `components/ChatList.test.tsx` |
| `apps/web/src/components/ReactionChips.tsx:36` | Reaction chips (`reaction-chip`, `aria-pressed`) | none — no `Chip` in the kit | `components/ReactionChips.test.tsx` |
| `apps/web/src/components/SearchBar.tsx:45` | "Searching only in {chat}" scope chip (click clears scope) | none — no `Chip` in the kit | `components/ChatList.test.tsx` |
| `apps/web/src/components/ChatHeader.tsx:139` | Topic title button opens the info panel | `Button variant="ghost"` | `routes/ChatView.test.tsx` |
| `apps/web/src/components/ChatList.tsx:396` | "Archived ({n})" show/hide disclosure (Archive icon) | `Button variant="ghost"` | `components/ChatList.test.tsx`, `routes/ChatShell.test.tsx` |
| `apps/web/src/components/PinnedBanner.tsx:89` | "Jump to pinned message from {name}" banner button | `Button variant="ghost"` | `routes/ChatView.test.tsx` |
| `apps/web/src/components/PinsPanel.tsx:157` | "Pinned messages" row with a count opens the pins sheet | `Button variant="ghost"` | `components/GroupPanel.test.tsx`, `components/TopicPanel.test.tsx`, `routes/ChatView.test.tsx` |
| `apps/web/src/components/StickerPanel.tsx:519` | "Unfavorite {emoji}" star toggle | `IconButton` | `components/StickerPanel.test.tsx` |
| `apps/web/src/routes/StickersPage.tsx:627` | "Unfavorite {emoji}" star toggle | `IconButton` | `routes/StickersPage.test.tsx` |
| `apps/web/src/routes/FoldersPage.tsx:141` | "Reorder {folder}" drag grip (GripVertical) | `IconButton` | `routes/FoldersPage.test.tsx` |
| `apps/web/src/routes/FoldersPage.tsx:189` | "Create new folder" dashed button (Plus) | `Button variant="outline"` | `routes/FoldersPage.test.tsx` |
| `apps/web/src/components/tools/ToolDetailPanel.tsx:273` | "Show source of v{version}" toggle | `Button variant="ghost" size="sm"` | `components/tools/tools.test.tsx` |
| `apps/web/src/routes/ChatView.tsx:105` | "Dismiss" server notice | `Button variant="ghost"` | `routes/ChatView.test.tsx` |
| `apps/web/src/components/FileMessage.tsx:56` | Download link (`<a aria-label="Download {name}">`) | `Button asChild variant="ghost"` | `components/FileMessage.test.tsx` |

## W2. Loading, error and empty states not on `StateMessage`

| File:line | What it is today | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |
| `apps/web/src/components/Skeleton.tsx:15` | "Loading chats" skeleton (`role="status"`) | `StateMessage kind="loading"` | `components/Skeleton.test.tsx`, `components/ChatList.test.tsx`, `components/MessageList.test.tsx` |
| `apps/web/src/components/Skeleton.tsx:41` | "Loading messages" skeleton (`role="status"`) | `StateMessage kind="loading"` | `components/Skeleton.test.tsx`, `components/MessageList.test.tsx` |
| `apps/web/src/components/machines/MachineListSkeleton.tsx:14` | "Loading machines" skeleton (`role="status"`) | `StateMessage kind="loading"` | `routes/MachinesPage.test.tsx` |
| `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx:14` | "Loading approvals" skeleton (`role="status"`) | `StateMessage kind="loading"` | `routes/ApprovalsPage.test.tsx` |
| `apps/web/src/components/ais/AiActivity.tsx:272` | "Loading activity" skeleton (`role="status"`) | `StateMessage kind="loading"` | `components/ais/AiActivity.test.tsx` |
| `apps/web/src/components/ChatList.tsx:340` | Inline `Loader2` spinner while a chat list page loads | `StateMessage kind="loading" size="inline"` | `components/ChatList.test.tsx` |
| `apps/web/src/components/ProgressCard.tsx:11` | Inline `Loader2` spinner on a progress card | `StateMessage kind="loading" size="inline"` | `components/ProgressCard.test.tsx` |
| `apps/web/src/components/EmptyState.tsx:20` | "No chats here yet" | `StateMessage kind="empty"` | `components/ChatList.test.tsx`, `routes/ChatShell.test.tsx` |
| `apps/web/src/components/MessageList.tsx:202` | "No messages yet" | `StateMessage kind="empty"` | `components/MessageList.test.tsx`, `routes/ChatView.test.tsx` |
| `apps/web/src/components/MessageSearchResults.tsx:99` | "No messages found" | `StateMessage kind="empty"` | `components/MessageSearch.test.tsx` |
| `apps/web/src/components/PinsPanel.tsx:74` | "Nothing pinned yet" | `StateMessage kind="empty"` | `components/GroupPanel.test.tsx`, `components/TopicPanel.test.tsx`, `routes/ChatView.test.tsx` |
| `apps/web/src/components/tools/ToolsSection.tsx:133` | "No tools here yet. An AI can write small tools…" | `StateMessage kind="empty"` | `components/tools/tools.test.tsx` |
| `apps/web/src/components/approvals/AlwaysAllowedList.tsx:195` | "Nothing is always allowed here." | `StateMessage kind="empty"` | `components/approvals/AlwaysAllowedList.test.tsx` |
| `apps/web/src/routes/ApprovalsPage.tsx:268` | "Nothing is waiting for you." | `StateMessage kind="empty"` | `routes/ApprovalsPage.test.tsx` |
| `apps/web/src/components/PeopleSearchResult.tsx:40` | Error `role="alert"`: "Too many searches…" (and line 50) | `StateMessage kind="error"` | `components/PeopleSearchResult.test.tsx` |
| `apps/web/src/components/MessageSearchResults.tsx:149` | Error `role="alert"` for a failed message search | `StateMessage kind="error"` | `components/MessageSearch.test.tsx` |

## W3. Text fields not on the kit field components

| File:line | What it is today (visible text / placeholder) | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |
| `apps/web/src/components/FolderEditorDialog.tsx:167` | Folder name `<input>` ("Folder name") | `TextInput` (use its `counter`) | `components/FolderEditorDialog.test.tsx` |
| `apps/web/src/components/SearchBar.tsx:55` | Chat search `<input type="search">` ("Search, or type @username") | `SearchField` | `components/ChatList.test.tsx` |
| `apps/web/src/components/tools/ToolDetailPanel.tsx:312` | Run input `<textarea>` ("Optional JSON input (max 4 KB)") | `TextArea` | `components/tools/tools.test.tsx` |
| `apps/web/src/components/auth/AuthFlow.tsx:136` | Sign-in email `<input type="email">` ("you@example.com") | `TextInput` | `components/auth/AuthFlow.test.tsx`, `routes/SetupPage.test.tsx` |

## W4. Kept by design

- `apps/web/src/components/ChatListItem.tsx:63`, `components/TopicRow.tsx:67,228,298`,
  `components/MessageSearchResult.tsx:71`, `components/tools/ToolsSection.tsx:139`,
  `components/NewChatButton.tsx:202`, `components/PinsPanel.tsx:105` — navigation
  list rows (own chrome per row).
- `components/FolderTabs.tsx:58`, `components/FolderRail.tsx:102`,
  `components/StickerPanel.tsx:411,426,443,463` — tabs (`role="tab"`).
- `components/ais/AiPageShell.tsx:19`, `components/ais/ModelPicker.tsx:75`,
  `components/ais/NewAiDialog.tsx:229`, `components/FolderEditorDialog.tsx:189` —
  radios (`role="radio"`).
- `components/GifPanel.tsx:114`, `components/StickerPanel.tsx:391,505` — grid and
  emoji/sticker cells.
- `components/FolderRail.tsx:134,151,165,178` — FolderRail keys (New folder, Edit
  folders, My AIs, Profile).
- `components/MessageBubble.tsx:76,84,363,519,573` — inline Retry/Delete text
  links in a bubble.
- `components/EditBar.tsx:19`, `components/Composer.tsx:916` — EditBar and
  Composer full-height strips.
- `components/TaskStrip.tsx:240,283,352,368` — TaskStrip chips and their menu
  triggers.
- `components/LinkText.tsx:32`, `components/MarkdownText.tsx:28` — inline text
  links; `components/GifMessage.tsx:51`, `components/ImageMessage.tsx:48` — media
  openers; `components/auth/OtpInput.tsx:76`, `components/AvatarUploader.tsx:290,368`,
  `components/PackEditor.tsx:489`, `components/Composer.tsx:962,978` — native
  file/zoom inputs and the composer textarea.

---

# Mobile

## M1. Buttons and links styled as buttons

| File:line | What it is today (visible text) | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |
| `apps/mobile/src/app/(tabs)/index.tsx:224` | "Cancel search" icon key | `IconButton` | none found |
| `apps/mobile/src/app/(tabs)/index.tsx:263` | "Clear chat filter" chip (X) | `Button variant="ghost"` | none found |
| `apps/mobile/src/app/(tabs)/index.tsx:430` | Show/Hide archived chats disclosure | `Button variant="ghost"` | none found |
| `apps/mobile/src/app/(tabs)/profile.tsx:175` | "Retry" | `Button variant="outline"` | none found |
| `apps/mobile/src/app/chat/[id].tsx:526,539,552,565,705,718,731,744,938,951,964,977` | "Dismiss" on error/notice banners (×12) | `IconButton` / `Button variant="ghost"` | none found |
| `apps/mobile/src/app/dev/whistle.tsx:278` | "Refresh model status" | `Button variant="outline"` | none found |
| `apps/mobile/src/app/explore.tsx:251` | "Retry" (RefreshCw + label) | `Button variant="outline"` | none found |
| `apps/mobile/src/app/group/[id].tsx:563` | Show/Hide archived topics disclosure | `Button variant="ghost"` | none found |
| `apps/mobile/src/app/group/[id].tsx:583` | "New topic" FAB | `Button` (default) | none found |
| `apps/mobile/src/app/settings/connections.tsx:281` | "Test {provider}" | `Button variant="outline"` | `components/connections/connections-screen.test.tsx` |
| `apps/mobile/src/app/settings/connections.tsx:290` | "Remove {provider}" | `Button variant="destructive"` | `components/connections/connections-screen.test.tsx` |
| `apps/mobile/src/app/settings/connections.tsx:381` | "Close the form" (X) | `IconButton` | `components/connections/connections-screen.test.tsx` |
| `apps/mobile/src/app/settings/connections.tsx:438` | Show/Hide key (Eye) | `IconButton` | `components/connections/connections-screen.test.tsx` |
| `apps/mobile/src/app/settings/folder/[id].tsx:266` | "Delete folder" | `Button variant="destructive"` | none found |
| `apps/mobile/src/app/settings/folders.tsx:104` | "New folder" | `Button` (default/outline) | none found |
| `apps/mobile/src/app/settings/integrations.tsx:192` | Show/Hide {secret} (Eye) | `IconButton` | `components/integrations/integrations-screen.test.tsx` |
| `apps/mobile/src/app/settings/machines.tsx:426` | Show/Hide revoked machines | `Button variant="ghost"` | `components/machines/machines-screen.test.tsx` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:616` | "Remove sticker" (X) | `IconButton` | `components/stickers/sticker-pack-screen.test.tsx` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:628` | "Add sticker images" | `Button variant="outline"` | `components/stickers/sticker-pack-screen.test.tsx` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:737` | "Remove new sticker {n}" (X) | `IconButton` | `components/stickers/sticker-pack-screen.test.tsx` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:789` | "Delete {pack}" | `Button variant="destructive"` | `components/stickers/sticker-pack-screen.test.tsx` |
| `apps/mobile/src/app/settings/stickers.tsx:324` | "Import from Telegram" | `Button` (default) | `components/stickers/stickers-screen.test.tsx` |
| `apps/mobile/src/app/settings/stickers.tsx:363,373` | "Move {pack}" up / down | `IconButton` | `components/stickers/stickers-screen.test.tsx` |
| `apps/mobile/src/app/settings/stickers.tsx:543` | "Remove favorite" (X) | `IconButton` | `components/stickers/stickers-screen.test.tsx` |
| `apps/mobile/src/auth/AuthFlow.tsx:191` | "Resend code" | `Button variant="ghost"` | `auth/AuthFlow.test.tsx` |
| `apps/mobile/src/auth/AuthFlow.tsx:201` | "Use a different email" | `Button variant="link"` | `auth/AuthFlow.test.tsx` |
| `apps/mobile/src/components/ais/ai-activity.tsx:150` | "Refresh activity" icon key | `IconButton` | `components/ais/ai-activity.test.tsx` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:113,154,177` | "Show all" / "Show less" toggles | `Button variant="ghost" size="sm"` | `components/ais/tool-detail-sheet.test.tsx` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:295` | "Show source of v{version}" | `Button variant="ghost"` | `components/ais/tool-detail-sheet.test.tsx` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:727` | "Close tool" (X) | `IconButton` | `components/ais/tool-detail-sheet.test.tsx` |
| `apps/mobile/src/components/chat/approval-card.tsx:22` | "Retry" (raised icon key) | `Button variant="outline"` | `components/chat/payload-card.test.ts` |
| `apps/mobile/src/components/chat/attach-sheet.tsx:240` | "Remove attachment" (X) | `IconButton` | `components/chat/attach-sheet.test.tsx` |
| `apps/mobile/src/components/chat/attachment-body.tsx:170` | "Retry sending attachment" | `Button variant="outline"` | `components/chat/attachment-body.test.tsx` |
| `apps/mobile/src/components/chat/attachment-body.tsx:184` | "Cancel upload" | `Button variant="ghost"` | `components/chat/attachment-body.test.tsx` |
| `apps/mobile/src/components/chat/attachment-message.tsx:234,269` | "Retry upload" | `Button variant="outline"` | `components/chat/attachment-message.test.tsx` |
| `apps/mobile/src/components/chat/attachment-video.tsx:124` | "Retry upload" | `Button variant="outline"` | `components/chat/attachment-video.test.tsx` |
| `apps/mobile/src/components/chat/attachment-video.tsx:268` | "Close {name}" (X) | `IconButton` | `components/chat/attachment-video.test.tsx` |
| `apps/mobile/src/components/chat/channel-composer-bar.tsx:121` | "Mute" / "Unmute" | `Button variant="ghost"` | none found |
| `apps/mobile/src/components/chat/invite-links-sheet.tsx:352` | "Done with invite link" | `Button variant="ghost"` | `components/chat/invite-links-sheet.test.tsx` |
| `apps/mobile/src/components/chat/join-link.tsx:166,215` | "Cancel" | `Button variant="ghost"` | `components/chat/join-link.test.tsx` |
| `apps/mobile/src/components/chat/load-error.tsx:22` | "Retry" raised icon key (used by the chat list and message list) | `Button variant="outline"` | `components/chat/message-list.test.tsx` |
| `apps/mobile/src/components/chat/message-actions-sheet.tsx:76` | "Remove your reaction with {emoji}" | `ActionSheet` item / `Button` | none found |
| `apps/mobile/src/components/chat/message-search-list.tsx:217` | "Retry loading more messages" | `Button variant="outline"` | none found |
| `apps/mobile/src/components/chat/new-chat-button.tsx:151` | "New chat" FAB | `Button` (default) | `components/chat/new-chat-button.test.tsx` |
| `apps/mobile/src/components/chat/new-chat-button.tsx:185,193,201,209,220` | "New channel / New group / New message / Explore public groups / Join with a link" menu items | `ActionSheet` items (`menuitem`) | `components/chat/new-chat-button.test.tsx` |
| `apps/mobile/src/components/chat/new-chat-button.tsx:254` | "Close dialog" (X) | `IconButton` | `components/chat/new-chat-button.test.tsx` |
| `apps/mobile/src/components/chat/pinned-banner.tsx:59,88` | "Dismiss pins error" (X) | `IconButton` | `components/chat/pinned-banner.test.tsx` |
| `apps/mobile/src/components/chat/pinned-banner.tsx:112` | "Cycle pins, {n}" | `IconButton` | `components/chat/pinned-banner.test.tsx` |
| `apps/mobile/src/components/chat/pinned-banner.tsx:123` | "Show pinned message" / "Show all pins, {n}" | `Button variant="ghost"` | `components/chat/pinned-banner.test.tsx` |
| `apps/mobile/src/components/chat/pins-sheet.tsx:70` | "Unpin message from {name}" | `Button variant="outline"` | `components/chat/pins-sheet.test.tsx` |
| `apps/mobile/src/components/chat/reaction-chips.tsx:41` | Reaction chip | none — no `Chip` in the kit | `components/chat/reaction-chips.test.tsx` |
| `apps/mobile/src/components/chat/topic-sheets.tsx:337` | "Done adding roles" | `Button` (default) | `components/chat/topic-sheets-roles.test.tsx` |
| `apps/mobile/src/components/chat/topic-sheets.tsx:381` | "Choose approvers" | `Button variant="outline"` | `components/chat/topic-sheets-roles.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:431` | "Retry sending voice message" | `Button variant="outline"` | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:488` | "Playback speed {speed}" | `Button variant="ghost"` | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:500,531` | "Show transcript" / "Hide transcript" | `Button variant="ghost"` | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:519` | "Transcribe voice message" | `Button` (default) | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:555` | "Cancel voice upload" | `Button variant="ghost"` | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-message.tsx:580` | "Retry transcription" | `Button variant="outline"` | `components/chat/voice-message.test.tsx` |
| `apps/mobile/src/components/chat/voice-recorder.tsx:412` | "Dismiss error" (X) | `IconButton` | `components/chat/voice-recorder.test.tsx` |
| `apps/mobile/src/components/contacts/profile-card.tsx:311` | "Block" | `Button variant="destructive"` | `components/contacts/contacts.test.tsx` |
| `apps/mobile/src/components/profile/profile-view.tsx:154` | "Claim a username" | `Button` (default) | `components/profile/profile-view.test.tsx` |
| `apps/mobile/src/components/profile/profile-view.tsx:178` | "Copy username" | `Button variant="ghost"` | `components/profile/profile-view.test.tsx` |
| `apps/mobile/src/components/profile/profile-view.tsx:228` | "Discard picture" | `Button variant="ghost"` | `components/profile/profile-view.test.tsx` |
| `apps/mobile/src/components/profile/profile-view.tsx:246` | "Remove picture" | `Button variant="destructive"` | `components/profile/profile-view.test.tsx` |
| `apps/mobile/src/components/stickers/telegram-import-sheet.tsx:143` | "Close" (X) | `IconButton` | `components/stickers/telegram-import-sheet.test.tsx` |

## M2. Loading, error and empty states not on `StateMessage`

| File:line | What it is today | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |
| `apps/mobile/src/app/explore.tsx:241` | `ActivityIndicator` + "Searching…" | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/dev/whistle.tsx:240` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/at/[handle].tsx:127` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/u/[handle].tsx:212` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/ais/new.tsx:168` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/(tabs)/profile.tsx:166` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/(tabs)/settings.tsx:190` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/settings/profile.tsx:311` | `ActivityIndicator` | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/app/settings/stickers.tsx:443` | `ActivityIndicator` | `StateMessage kind="loading"` | `components/stickers/stickers-screen.test.tsx` |
| `apps/mobile/src/app/settings/machines.tsx:576` | `ActivityIndicator` (in-flight action) | `StateMessage kind="loading"` or keep the inline key | `components/machines/machines-screen.test.tsx` |
| `apps/mobile/src/app/settings/sticker-pack.tsx:462,657` | `ActivityIndicator` | `StateMessage kind="loading"` | `components/stickers/sticker-pack-screen.test.tsx` |
| `apps/mobile/src/auth/RequireAuth.tsx:17` | `ActivityIndicator` + "Loading…" | `StateMessage kind="loading"` | none found |
| `apps/mobile/src/components/chat/message-search-list.tsx:228` | `ActivityIndicator` for "load more" | `StateMessage kind="loading" size="inline"` | none found |
| `apps/mobile/src/components/chat/attachment-message.tsx:156,243` | `ActivityIndicator` "Uploading" / "Opening" | `StateMessage kind="loading" size="inline"` | `components/chat/attachment-message.test.tsx` |
| `apps/mobile/src/components/chat/attachment-video.tsx:191` | `ActivityIndicator` "Uploading" | `StateMessage kind="loading" size="inline"` | `components/chat/attachment-video.test.tsx` |
| `apps/mobile/src/components/chat/attach-sheet.tsx:168` | `ActivityIndicator` "Preparing file" | `StateMessage kind="loading" size="inline"` | `components/chat/attach-sheet.test.tsx` |
| `apps/mobile/src/components/chat/progress-card.tsx:15` | `ActivityIndicator` | `StateMessage kind="loading" size="inline"` | `components/chat/payload-card.test.ts` |
| `apps/mobile/src/components/settings/avatar-control.tsx:119` | `ActivityIndicator` while the picture saves | `StateMessage kind="loading" size="inline"` | `components/settings/settings-ui.test.tsx` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:202` | "Loading…" text | `StateMessage kind="loading" size="inline"` | `components/ais/tool-detail-sheet.test.tsx` |
| `apps/mobile/src/components/ais/routines-section.tsx:215` | "Loading…" text | `StateMessage kind="loading" size="inline"` | `components/ais/routines-section.test.tsx` |
| `apps/mobile/src/components/ais/tools-section.tsx:81` | "Loading…" text | `StateMessage kind="loading" size="inline"` | `components/ais/tools-section.test.tsx` |
| `apps/mobile/src/components/chat/load-error.tsx:22` | Hand-rolled error block + raised "Retry" key (`LoadError`/`LoadErrorBanner`) | `StateMessage kind="error"` | `components/chat/message-list.test.tsx` |
| `apps/mobile/src/app/(tabs)/index.tsx:382,418` | "Couldn't load chats" via `LoadErrorBanner` / `LoadError` | `StateMessage kind="error"` | none found |
| `apps/mobile/src/components/chat/message-list.tsx:256` | "Couldn't load messages" via `LoadError` | `StateMessage kind="error"` | `components/chat/message-list.test.tsx` |
| `apps/mobile/src/components/chat/message-search-list.tsx:136` | `LoadError` for a failed search page | `StateMessage kind="error"` | none found |
| `apps/mobile/src/app/explore.tsx:181` | "No public groups or channels yet. Be the first to make one public." | `StateMessage kind="empty"` | none found |
| `apps/mobile/src/components/chat/message-list.tsx:260` | "No messages yet" | `StateMessage kind="empty"` | `components/chat/message-list.test.tsx` |
| `apps/mobile/src/components/ais/tools-section.tsx:15` | "No tools here yet. An AI can write small tools…" | `StateMessage kind="empty"` | `components/ais/tools-section.test.tsx` |
| `apps/mobile/src/components/ais/routines-section.tsx:19` | "No routines here yet. Ask the AI…" | `StateMessage kind="empty"` | `components/ais/routines-section.test.tsx` |
| `apps/mobile/src/components/ais/ai-activity.tsx:20` | "No activity yet." | `StateMessage kind="empty"` | `components/ais/ai-activity.test.tsx` |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:289,407` | "No versions yet." / "No runs yet." | `StateMessage kind="empty"` | `components/ais/tool-detail-sheet.test.tsx` |
| `apps/mobile/src/app/settings/stickers.tsx:346,520` | "No packs on your panel yet." / "No favorites yet." | `StateMessage kind="empty"` | `components/stickers/stickers-screen.test.tsx` |
| `apps/mobile/src/app/settings/machines.tsx:296` | "No machines yet. Add one…" | `StateMessage kind="empty"` | `components/machines/machines-screen.test.tsx` |
| `apps/mobile/src/app/settings/folders.tsx:85` | "No folders yet." | `StateMessage kind="empty"` | none found |
| `apps/mobile/src/app/settings/connections.tsx:196` | "No provider connections yet." | `StateMessage kind="empty"` | `components/connections/connections-screen.test.tsx` |
| `apps/mobile/src/components/chat/invite-links-sheet.tsx:232` | "No invite links yet." | `StateMessage kind="empty"` | `components/chat/invite-links-sheet.test.tsx` |
| `apps/mobile/src/components/chat/group-roles-sheet.tsx:134` | "No roles yet. Roles grant private-topic access…" | `StateMessage kind="empty"` | `components/chat/topic-sheets-roles.test.tsx` |
| `apps/mobile/src/components/chat/sticker-panel.tsx:182` | "No stickers here yet." | `StateMessage kind="empty"` | `components/chat/sticker-panel.test.tsx` |
| `apps/mobile/src/components/chat/topic-sheets.tsx:255,288` | "No AIs here yet." / "No roles here yet…" | `StateMessage kind="empty"` | `components/chat/topic-sheets-roles.test.tsx` |

## M3. Text fields not on the kit field components

None left. All four raw `TextInput` uses are the kept ones below (table M4):
`components/chat/composer.tsx:606`, `auth/OtpInput.tsx:61`,
`app/settings/folder/[id].tsx:165`, `app/settings/sticker-pack.tsx:704`.

## M4. Kept by design

- `apps/mobile/src/components/chat/composer.tsx` — the composer (text input line
  606, Cancel reply 114, Dismiss error 586, Save edit/Send 632).
- `apps/mobile/src/auth/OtpInput.tsx:24,61` — the OTP input cells.
- `apps/mobile/src/app/settings/sticker-pack.tsx:704,737` — the sticker-pack emoji
  cell (emoji `TextInput` plus its Remove key).
- `apps/mobile/src/app/settings/folder/[id].tsx:165` — the folder name row with
  its inline `{name.length}/{max}` counter.
- `apps/mobile/src/components/chat/attachment-message.tsx:321` — the image viewer
  Close on its black overlay.
- `apps/mobile/src/components/chat/edit-bar.tsx:28` — the EditBar full-height
  strip (twin of the kept web EditBar).
- Navigation rows and cards: `components/chat/chat-list-item.tsx:72`,
  `components/chat/topic-row.tsx:89`, `components/chat/group-list-item.tsx:92`,
  `components/ais/ai-row.tsx:29`, `components/chat/channel-screen.tsx:234`,
  `components/ais/tools-section.tsx:43`, `components/contacts/profile-card.tsx:98`,
  `components/chat/message-search-list.tsx:33`,
  `components/chat/pins-sheet.tsx:55`, `app/(tabs)/settings.tsx:78`.
- Tabs, radios and checkboxes: `components/chat/folder-tabs.tsx:54`,
  `components/chat/emoji-sheet.tsx:131`,
  `components/ais/template-cards.tsx:22`, `app/explore.tsx:217`,
  `app/settings/connections.tsx:397`, `app/settings/sticker-pack.tsx:519,550`,
  `components/chat/new-topic-sheet.tsx:121,159,195,226`,
  `components/chat/visibility-sheet.tsx:145`,
  `components/chat/visibility-fields.tsx:55`,
  `components/chat/group-roles-sheet.tsx:248`,
  `components/chat/new-group-sheet.tsx:209`.
- Grid, emoji and media cells: `components/chat/emoji-tab.tsx:120,149`,
  `components/chat/sticker-panel.tsx:133,143,198`,
  `components/chat/gif-panel.tsx:57`, `components/chat/sticker-message.tsx:54`,
  `components/chat/attachment-message.tsx:94,135,369`,
  `components/chat/attachment-video.tsx:161`, `app/settings/folder/[id].tsx:184`.
- Topic chips and their menu triggers:
  `components/chat/task-strip.tsx:88,106,117,130,140,158,184,194`.
- Message bubble itself: `components/chat/message-bubble.tsx:161,437` (the bubble
  press target) and its inline Retry at `:415`.
- Modal backdrops / sheet shells:
  `components/chat/attach-sheet.tsx:84`, `components/chat/emoji-sheet.tsx:112`,
  `components/chat/gif-panel.tsx:373`, `components/chat/sticker-panel.tsx:239`,
  `components/stickers/telegram-import-sheet.tsx:125`,
  `components/chat/new-chat-button.tsx:176,181`,
  `components/chat/invite-sheet.tsx:119`,
  `components/chat/new-group-sheet.tsx:193`.

---

# Suggested batches

Groups of 3-5 rows that share a file or a test, small enough for one migration
task. Web first.

**Web**

1. **W-menu** — `MentionPicker.tsx:30`, `MessageActionsMenu.tsx:58` → `MenuItem`.
   Tests: `MentionPicker.test.tsx`, `Composer.test.tsx`.
2. **W-chips** — `NewTopicDialog.tsx:235` → `SegmentedControl`;
   `ReactionChips.tsx:36`, `SearchBar.tsx:45` → decide a `Chip` (none today).
   Tests: `NewTopicDialog.test.tsx`, `ReactionChips.test.tsx`, `ChatList.test.tsx`.
3. **W-chat-buttons** — `ChatHeader.tsx:139`, `ChatList.tsx:396`,
   `PinnedBanner.tsx:89`, `ChatView.tsx:105` → ghost `Button`.
   Tests: `ChatView.test.tsx`, `ChatList.test.tsx`.
4. **W-pins-favorites** — `PinsPanel.tsx:157`, `StickerPanel.tsx:519`,
   `StickersPage.tsx:627` → `Button` / `IconButton`.
   Tests: `StickerPanel.test.tsx`, `StickersPage.test.tsx`, `GroupPanel.test.tsx`.
5. **W-folders-tools** — `FoldersPage.tsx:141,189`, `ToolDetailPanel.tsx:273`,
   `FileMessage.tsx:56`. Tests: `FoldersPage.test.tsx`, `FileMessage.test.tsx`.
6. **W-loading-inline** — `Skeleton.tsx:15,41`, `ChatList.tsx:340`,
   `ProgressCard.tsx:11` → `StateMessage` loading.
   Tests: `Skeleton.test.tsx`, `ProgressCard.test.tsx`, `ChatList.test.tsx`.
7. **W-loading-skeletons** — `MachineListSkeleton.tsx:14`,
   `ApprovalsListSkeleton.tsx:14`, `AiActivity.tsx:272` → `StateMessage` loading.
   Tests: `MachinesPage.test.tsx`, `ApprovalsPage.test.tsx`, `AiActivity.test.tsx`.
8. **W-empty** — `EmptyState.tsx:20`, `MessageList.tsx:202`,
   `MessageSearchResults.tsx:99`, `PinsPanel.tsx:74` → `StateMessage` empty.
   Tests: `MessageList.test.tsx`, `MessageSearch.test.tsx`.
9. **W-empty-error** — `ToolsSection.tsx:133`, `AlwaysAllowedList.tsx:195`,
   `ApprovalsPage.tsx:268`, `PeopleSearchResult.tsx:40`,
   `MessageSearchResults.tsx:149` → `StateMessage`. Tests:
   `tools.test.tsx`, `AlwaysAllowedList.test.tsx`, `ApprovalsPage.test.tsx`,
   `PeopleSearchResult.test.tsx`.
10. **W-fields** — `FolderEditorDialog.tsx:167` → `TextInput`,
    `SearchBar.tsx:55` → `SearchField`, `ToolDetailPanel.tsx:312` → `TextArea`,
    `AuthFlow.tsx:136` → `TextInput`. Tests: `FolderEditorDialog.test.tsx`,
    `ChatList.test.tsx`, `AuthFlow.test.tsx`.

**Mobile**

11. **M-tab-chrome** — `(tabs)/index.tsx:224,263,430`,
    `(tabs)/profile.tsx:175`; `group/[id].tsx:563,583`. Tests: none found.
12. **M-connections** — `settings/connections.tsx:281,290,381,438` → kit
    `Button`/`IconButton`. Test: `connections-screen.test.tsx`.
13. **M-folders-stickers** — `settings/folders.tsx:104`,
    `settings/folder/[id].tsx:266`, `settings/stickers.tsx:324,363,373,543`.
    Tests: `stickers-screen.test.tsx`.
14. **M-sticker-pack** — `settings/sticker-pack.tsx:616,628,737,789`.
    Test: `sticker-pack-screen.test.tsx`.
15. **M-settings-rest** — `settings/integrations.tsx:192`,
    `settings/machines.tsx:426`. Tests: `integrations-screen.test.tsx`,
    `machines-screen.test.tsx`.
16. **M-auth** — `auth/AuthFlow.tsx:191,201`. Test: `AuthFlow.test.tsx`.
17. **M-chat-dismiss** — `app/chat/[id].tsx:526,539,552,565,705,718,731,744,938,951,964,977`
    → `IconButton`/ghost `Button`. Tests: none found.
18. **M-pinned** — `chat/pinned-banner.tsx:59,88,112,123`,
    `chat/pins-sheet.tsx:70`. Tests: `pinned-banner.test.tsx`, `pins-sheet.test.tsx`.
19. **M-attachments** — `chat/attach-sheet.tsx:240`, `chat/attachment-body.tsx:170,184`,
    `chat/attachment-message.tsx:234,269`,
    `chat/attachment-video.tsx:124,268`. Tests: `attachment-*.test.tsx`.
20. **M-voice** — `chat/voice-message.tsx:431,488,500,519,531,555,580`,
    `chat/voice-recorder.tsx:412`. Tests: `voice-message.test.tsx`,
    `voice-recorder.test.tsx`.
21. **M-profile** — `profile/profile-view.tsx:154,178,228,246`,
    `contacts/profile-card.tsx:311`. Tests: `profile-view.test.tsx`,
    `contacts.test.tsx`.
22. **M-ais** — `ais/ai-activity.tsx:150`,
    `ais/tool-detail-sheet.tsx:113,154,177,295,727`,
    `chat/topic-sheets.tsx:337,381`. Tests: `ai-activity.test.tsx`,
    `tool-detail-sheet.test.tsx`, `topic-sheets-roles.test.tsx`.
23. **M-sheets** — `chat/invite-links-sheet.tsx:352`, `chat/join-link.tsx:166,215`,
    `chat/new-chat-button.tsx:151,185,193,201,209,220,254`,
    `chat/message-actions-sheet.tsx:76`,
    `stickers/telegram-import-sheet.tsx:143`. Tests: `new-chat-button.test.tsx`,
    `join-link.test.tsx`, `invite-links-sheet.test.tsx`,
    `telegram-import-sheet.test.tsx`.
24. **M-state-screens** — `app/explore.tsx:241`, `app/dev/whistle.tsx:240`,
    `app/at/[handle].tsx:127`, `app/u/[handle].tsx:212`, `app/ais/new.tsx:168`,
    `(tabs)/profile.tsx:166`, `(tabs)/settings.tsx:190`, `auth/RequireAuth.tsx:17`
    → `StateMessage` loading. Tests: none found.
25. **M-state-settings** — `settings/profile.tsx:311`, `settings/stickers.tsx:443`,
    `settings/machines.tsx:576`, `settings/sticker-pack.tsx:462,657`.
    Tests: the settings screen tests above.
26. **M-state-chat** — `chat/message-search-list.tsx:228`,
    `chat/attachment-message.tsx:156,243`,
    `chat/attachment-video.tsx:191`, `chat/attach-sheet.tsx:168`,
    `chat/progress-card.tsx:15`, `settings/avatar-control.tsx:119`,
    `ais/tool-detail-sheet.tsx:202`, `ais/routines-section.tsx:215`,
    `ais/tools-section.tsx:81` → `StateMessage` loading. Tests per component.
27. **M-load-error** — `chat/load-error.tsx:22`,
    `(tabs)/index.tsx:382,418`, `chat/message-list.tsx:256`,
    `chat/message-search-list.tsx:136` → `StateMessage kind="error"`.
    Test: `message-list.test.tsx`.
28. **M-empty** — `chat/message-list.tsx:260`, `ais/tools-section.tsx:15`,
    `ais/routines-section.tsx:19`, `ais/ai-activity.tsx:20`,
    `ais/tool-detail-sheet.tsx:289,407`, `chat/topic-sheets.tsx:255,288`,
    `chat/invite-links-sheet.tsx:232`, `chat/group-roles-sheet.tsx:134`,
    `chat/sticker-panel.tsx:182`,
    `settings/stickers.tsx:346,520`, `settings/machines.tsx:296`,
    `settings/folders.tsx:85`, `settings/connections.tsx:196`,
    `app/explore.tsx:181` → `StateMessage kind="empty"`. Split into settings vs
    chat sub-batches when picked up.
