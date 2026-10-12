# Telegram parity audit: features and flows (2026-10-11)

Docs only. Read from `main` at `54d08c1a6`; nothing was run. Telegram behaviour is from
memory of the product, not checked online. Bugs are in the other 10-11 audits
(`message-pipeline-audit.md` MP-x, `social-graph-audit.md` SG-x, `security-audit.md` SEC-x,
`features-ui-audit.md` UI-x) and their fixes are planned in `fix-plan-2026-10-11.md`; this
audit only points at them where they change a feature's status. Owner's direction applied:
Telegram-like, topics + task strip, user stickers + Telegram importer + GIFs, AI chats, no
inbox/catch-up feature, web first.

Status words: **solid** = present on that client and works as a Telegram user expects;
**weak** = present but a Telegram user notices the gap (reason given); **missing** = not
there (`not found: grep X` names what was searched). "web" is `apps/web/src`, "mobile" is
`apps/mobile/src`, "contract" is `packages/api-contract/src`.

## 1. Summary: the 10 gaps that most hurt a switcher

1. Unread, last message and read state live only in client memory: every launch starts at
   zero, no cross-device read sync, no catch-up after reconnect (MP-5, MP-6; `chats.ts:83`
   returns no preview or unread). Planned as MP-F3 (`chat_reads` table). Highest impact.
2. No delivered tick, "sent" means "written to the socket" (MP-4, `packages/chat-core/src/types.ts:7`
   has no `delivered`). T-1153 and MP-F8 are the fix.
3. No link previews: a pasted URL is just a link (`LinkText.tsx`, not found: grep `og:|unfurl|linkPreview`).
4. No text formatting for humans: markdown renders only for AI senders
   (`packages/chat-core/src/markdown.ts:15-21`); no bold, italic, code, spoiler, no formatting bar.
5. Video is a file on the web: no `<video>` outside `GifMessage.tsx` and `GifPanel.tsx`; mobile
   plays inline (`attachment-video.tsx:4`). No albums, no multi-select in the mobile picker
   (`attachment-picker.ts:98-101`), no full-screen viewer anywhere (`ImageMessage.tsx:54-55` opens a tab).
6. No composer drafts: text is lost on chat switch on both apps (UI-F6 planned), nothing
   syncs across devices; "drafts" in the server are AI streaming drafts (`apps/server/src/drafts/api.ts:36`).
7. No "delete for me", "clear history", "delete chat" or "leave group"; a group owner cannot
   leave, transfer or delete (SG-4). not found: grep `deleteForMe|clearHistory|leaveGroup|deleteChat`.
8. Contacts are weak as a graph: no contact list page on either client, no remove contact
   (SG-6), block does not block (SG-1), strangers can DM (SG-2). All planned in waves 2-4.
9. Mobile notifications: no settings page (`settings-items.ts:34-99` has no row; T-0186 never
   built), no app-icon badge (not found: grep `setBadgeCount`), no sounds; native push is the
   T-1129 plan, not a shipped feature.
10. Account hygiene: no sessions/devices list, no delete account, no data export, no bio
    (`auth.ts:40` patches `name` only; not found: grep `listSessions|deleteUser|export`).

Counts over the matrix below (web / mobile): solid 29 / 25, weak 15 / 17, missing 34 / 36.

## 2. Parity matrix

### 2.1 Messaging basics

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Send text, Enter to send, Shift+Enter newline | solid | solid | `Composer.tsx:355`; mobile `composer.tsx` |
| Edit own message (48 h window), ArrowUp edits last | solid | solid | `MessageActionsMenu.tsx:90`, `Composer.tsx:335`; `message-actions-sheet.tsx:123`; `packages/chat-core/src/edits.ts:11` |
| Delete for everyone | solid | solid | `MessageActionsMenu.tsx:94`; `message-actions-sheet.tsx:131` |
| Delete for me | missing | missing | not found: grep `deleteForMe\|hideMessage` |
| Reply with quote, swipe to reply | weak | weak | quote empty on the other device (UI-1); mobile `swipe-to-reply.tsx` exists |
| Forward (single, multi-select, with comment) | solid | solid | `ForwardPicker.tsx`, `SelectionBar.tsx`; `selection-bar.tsx`, `message-actions-sheet.tsx:107-115` |
| Pin messages (banner + list, 20 cap) | solid | solid | `PinnedBanner.tsx`, `PinsPanel.tsx`; `pinned-banner.tsx`, `pins-sheet.tsx`; contract `pins.ts:91-102` |
| Reactions (quick bar + chips) | solid | solid | `MessageActionsMenu.tsx:71`, `ReactionChips.tsx`; `message-bubble-actions.tsx:120`, `reaction-chips.tsx` |
| @mentions with picker, highlight of me | solid | solid | `MentionPicker.tsx`; `mention-picker.tsx` |
| Link previews (title, image) | missing | missing | `LinkText.tsx` autolinks only; not found: grep `og:\|unfurl\|linkPreview` |
| Formatting (bold, italic, code, spoiler) for human text | missing | missing | `packages/chat-core/src/markdown.ts:15-21` renders markdown only for AI senders; not found: grep `spoiler` |
| Copy text | solid | solid | `MessageActionsMenu.tsx:91`; `message-actions-sheet.tsx:129` |
| Scheduled messages | missing | missing | not found: grep `scheduled` in clients (only routines/sweepers) |
| Silent (no-sound) send | missing | missing | not found: grep `silent` as a send option |
| Message search (global + in chat, typo tolerant) | solid | solid | contract `search.ts:18-19` (`q`, `chat`); `MessageSearchResults.tsx`; `message-search-list.tsx` |
| Jump to date | missing | missing | `search.ts` has no date param; not found: grep `jumpToDate` |
| Sent / delivered / read ticks | weak | weak | `types.ts:7`: `sending\|sent\|read\|failed`, no delivered; "sent" is not acked (MP-4) |
| Typing indicator | weak | weak | `TypingDots.tsx`; one name per group (UI-5) |
| Unread divider, unread counts | weak | weak | `UnreadDivider.tsx`; counts reset on every launch (MP-6) |
| Big emoji, date separators | solid | solid | `message/BigEmoji.tsx`, `DateSeparator.tsx`; `date-separator.tsx` |
| Message info (who read it, in groups) | missing | missing | first reader marks read for all (MP-9); not found: grep `readBy` in UI |

### 2.2 Media

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Photos (pick, paste, drag, retry) | solid | weak | `composer/ComposerControls.tsx:179`; mobile picker takes one file, `quality: 1`, no resize (`attachment-picker.ts:98-101`) |
| Photo viewer (full screen, swipe, save) | missing | missing | `ImageMessage.tsx:54-55` opens a new tab; `image-message.tsx:11` has no press handler |
| Albums (several photos as one message) | missing | missing | not found: grep `album`; picker has no `allowsMultipleSelection` |
| Video (send, inline play) | weak | solid | send accepted in `packages/chat-core/src/media.ts:105-121`; web renders a file card (no `<video` in `AttachmentBody.tsx`); mobile `attachment-video.tsx:4` (expo-video) |
| Video notes (round) | missing | missing | not found: grep `videoNote` |
| Voice notes (hold, waveform, speed, transcript) | solid | solid | `VoiceMessage.tsx`, `ComposerControls.tsx:2` (Mic); `voice-recorder.tsx`, `voice-transcribe-confirm.tsx` |
| Files | solid | solid | `FileMessage.tsx`; `attachment-message.tsx` |
| Camera capture | n/a | solid | `attachment-picker.ts:133` |
| Stickers (packs, create, favorites, Telegram import) | solid | solid | `StickerPanel.tsx`, `PackEditor.tsx`, `TelegramImportDialog.tsx`; `sticker-panel.tsx`, `telegram-import-sheet.tsx`; import needs `TELEGRAM_BOT_TOKEN` (`config.ts:161`) |
| GIFs (search, send) | weak | weak | works only with `GIF_PROVIDER` + key (`config.ts:167`); `GifPanel.tsx`, mobile `emoji-sheet.tsx:16` |
| Emoji picker | weak | weak | a fixed `COMMON_EMOJI` list, no search, no categories (`StickerPanel.tsx:16,48-50`; `emoji-sheet.tsx:16`) |
| Media gallery per chat (Media / Files / Links / Voice) | solid | solid | `ChatMediaPanel.tsx`; `media-sheet.tsx`; contract `media.ts:57` |
| Chat backgrounds | solid | weak | `ChatBackgroundDialog.tsx`; mobile renders (`chat-background.tsx`) but has no picker (not found: grep `background` in mobile `settings/`) |

### 2.3 Chat organisation

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Folders (editor, chips, reorder) | solid | solid | `FoldersPage.tsx`, `FolderRail.tsx`; `settings/folders.tsx`, `settings/folder/[id].tsx` |
| Archive | solid | solid | `ChatActionsMenu.tsx:123`; `chat-actions-sheet.tsx:102` |
| Pin chats | solid | solid | `ChatActionsMenu.tsx:83`; `chat-actions-sheet.tsx:66` |
| Mute with durations (1 h, 8 h, 1 d, 1 w, forever) | solid | solid | `packages/chat-core/src/chat-prefs.ts:13-17`; `ChatActionsMenu.tsx:92`; `chat-actions-sheet.tsx:76-94` |
| Mark as unread | missing | missing | not found: grep `markUnread\|markAsUnread` |
| Saved Messages (self chat) | missing | missing | not found: grep `savedMessages` |
| Composer drafts per chat, synced | missing | missing | text lost on switch (UI-F6); server `drafts/` is AI streaming (`drafts/api.ts:36`) |
| Delete chat / clear history | missing | missing | `chats.ts:83` has `list` only; not found: grep `deleteChat\|clearHistory` |
| Swipe actions on the chat list | n/a | missing | not found: grep `Swipeable` in `chat-list-item.tsx`, `chat-list.tsx` |
| Chat list first paint from cache | solid | missing | `store/chatListCache.ts:6-8`; mobile `store/` has no cache file |
| Explore public groups and channels | solid | solid | `ChatList.tsx:181`, contract `directory.ts:48-52`; `explore.tsx` |

### 2.4 Contacts and privacy

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Usernames (@handle, profile card, `/u/:handle`) | solid | solid | `HandlePage.tsx`, `ProfileSettingsSection.tsx:135-141`; `u/[handle].tsx`, `settings/handle-field.tsx` |
| Find people by name or handle | weak | weak | `contact-requests.ts:106,143` (`/users/search`); enumerates every user by prefix (SG-7); web `SearchBar.tsx:9-11` filters chats, people only via `@handle` |
| Contact requests (send, accept, decline, cancel) | solid | solid | `contact-requests.ts:118-135`; `RequestsPage.tsx`; `settings/requests.tsx` |
| Contact list page | missing | missing | `contacts.ts:23` feeds the chat list only; no `/contacts` route in `AppRoutes.tsx`; no screen in `app/` |
| Remove contact | missing | missing | SG-6; planned wave 4 |
| Blocking | weak | weak | `BlockedPage.tsx`, `settings/blocked.tsx`; a block only inserts a row (SG-1, wave 2) |
| Who can message me (contacts only, everybody) | missing | missing | SG-2, Julio decides; not found: grep `privacy` in clients |
| Last seen and online | weak | weak | presence dot and "last seen" flicker (UI-4); no privacy switch (not found: grep `lastSeenPrivacy`) |
| Phone-less sign-up (email + code) | solid | solid | `auth/AuthFlow.tsx:66`; `auth/OtpInput.tsx`. Better than Telegram for privacy |
| Invite a friend (link that pre-connects) | solid | solid | `InviteDialog.tsx:12,37`; `invite-sheet.tsx`; contract `auth.ts:86-99` |

### 2.5 Groups, channels, topics

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Create group, add members, remove members | solid | solid | `NewGroupDialog.tsx`, `GroupPanel.tsx:184`; `new-group-sheet.tsx`, `group/[id].tsx` "Members and roles"; contract `groups.ts:156-180` |
| Roles and permissions | weak | weak | named roles with private-topic access + approver (`roles.ts:63-81`); no per-permission grid (pin, add members, change info) as in Telegram admins |
| Group settings switches | weak | weak | only "Members can create topics" and "Let AIs answer without @mention" (`GroupSettingSwitch.tsx:73,118`); no "who can send media/links" |
| Invite links (expiry, max uses, revoke, preview, join) | solid | solid | `invite-links.ts:101-120`; `InviteLinksSection.tsx`, `JoinPage.tsx`; `invite-links-sheet.tsx`, `join/[token].tsx` |
| Public groups with @handle, open join | solid | solid | `groups.ts:198`, `directory.ts:52`; `GroupHandleRoute.tsx`; `at/[handle].tsx` |
| Join requests (admin approval) | missing | missing | not found: grep `joinRequest`; public = open, private = link only |
| Leave group / owner transfer / delete group | missing | missing | SG-4; `groups.ts:156-198` has no leave or delete; mobile `group/[id].tsx` has no "Leave" |
| Ban list | missing | missing | SG-8 |
| Slow mode | missing | missing | not found: grep `slowMode` |
| Admin log (recent actions) | missing | missing | `audit/` is the AI action log; not found: grep `admin log` for groups |
| Polls | missing | missing | not found: grep `poll` (hits are HTTP polling) |
| Channels (admins post, subscribers read) | solid | solid | `groups.ts:16` (`ChannelKind`); `ChannelPanel.tsx`; `channel-screen.tsx`, `new-channel-sheet.tsx` |
| Topics (public/private, General, task strip, per-topic AIs) | solid | solid | `topics.ts:228-280`; `TopicPanel.tsx`, `TaskStrip.tsx`; `group-topic-list.tsx`, `task-strip.tsx`. Richer than Telegram topics |
| Group picture | solid | weak | `panels/GroupPictureSection.tsx`; not found: grep `picture\|avatar` setter in mobile `group/` |

### 2.6 Notifications

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Per-chat mute (see 2.3) | solid | solid | as above |
| Settings page: devices, previews, test | solid | missing | `NotificationsPage.tsx:63-146`, contract `push.ts:150-161`; mobile `settings-items.ts:34-99` has no row (T-0186 never built) |
| Push when the app is closed | weak | weak | web: needs HTTPS + VAPID, stale pair after reload (MP-8); mobile: `lib/push/native.ts:3` (expo-notifications) under the T-1129 plan, group pushes missing until T-1154 (MP-3) |
| In-app notification while the tab is hidden | solid | n/a | `lib/push/inTab.ts:1-5` (T-1145) |
| Unread badge on the app icon or tab title | missing | missing | not found: grep `document.title\|setAppBadge\|setBadgeCount` |
| Notification sounds | missing | missing | not found: grep `sound` outside a fixture and the video player |
| Mention and reply exceptions when muted | missing | missing | not found: grep `mention` in `push/` |

### 2.7 Multi-device and sync

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Sign in on many devices at once | solid | solid | cookie and bearer sessions, carbons (`features-ui-audit` UI-3) |
| Active sessions list, terminate a session | missing | missing | `auth.ts:84-99`; not found: grep `listSessions\|revokeSession` |
| Read state synced across devices | missing | missing | MP-6; `chat_reads` planned (MP-F3) |
| Draft sync | missing | missing | see 2.3 |
| Catch-up after reconnect | missing | missing | MP-5, planned MP-F3 |
| Reply from the other device clears unread | weak | weak | UI-3 |

### 2.8 Account

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Display name, avatar (crop), @username | solid | solid | `ProfilePage.tsx`, `avatar/CropDialog.tsx`; `settings/profile.tsx`, `settings/avatar-control.tsx` |
| Bio | missing | missing | `auth.ts:40` `UpdateMePayload = { name }`; not found: grep `bio` |
| Sign out | solid | solid | `chatList/ChatListMenu.tsx`; `lib/settings-items.ts` |
| Delete account | missing | missing | social-graph audit "Not found": no `deleteUser` in `apps/server/src/auth/auth.ts` |
| Export my data / chat | missing | missing | not found: grep `export` as a feature |
| Passcode / biometric lock | missing | missing | not found: grep `passcode\|biometric` in clients |
| Theme (light/dark) | weak | weak | dark design system only (`index.css`, `lib/theme.ts`); no switch |
| Language | missing | missing | not found: grep `i18n` |

### 2.9 Zilar-only (nothing in Telegram)

| Feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Create AIs with own keys, caps, persona by chat | solid | solid | `ais/NewAiDialog.tsx`, `AiPanel.tsx`; `ais/new.tsx`, `ais/[id].tsx` |
| Streaming replies, AI in groups and topics on @mention | solid | solid | `drafts/api.ts:36`; `panels/GroupAiSection.tsx`; `topic-info-sheet.tsx` |
| AI memory ("What X remembers") | solid | solid | `ais/AiMemoryDialog.tsx`; `ais/ai-memory-sheet.tsx` |
| Approvals, always-allow rules, kill switch, audit log | solid | solid | `ApprovalsPage.tsx`; `settings/approvals.tsx` |
| Tools, routines, machines, connections | solid | solid | `tools/*`, `MachinesPage.tsx`; `ais/tools-section.tsx`, `settings/machines.tsx` |
| On-device voice transcripts | n/a | solid | `voice-transcribe-confirm.tsx` (Whistle) |
| Task strip on topics | solid | solid | `TaskStrip.tsx`; `task-strip.tsx` |

### 2.10 Onboarding, invites, offline

| Telegram feature | Web | Mobile | Evidence |
| --- | --- | --- | --- |
| Sign-up: email, code, name, handle | solid | solid | `AuthFlow.tsx:66,167-168`; `welcome/name.tsx`, `welcome/handle.tsx` |
| Invite link opens the app, code pre-filled | solid | solid | `InvitePage.tsx`; `app.json:22-29` App Links for `/c/` and `/invite/`; `invite/[code].tsx` |
| Empty state that offers an invite | solid | solid | `NewChatButton.tsx`; `new-message-sheet.tsx` |
| Offline: cached chats readable | weak | missing | web `sw.js:10,54` only serves `offline.html` for navigations; `chatListCache.ts` holds the list, not messages; mobile has no persistence beyond the session (`auth/secure-session-storage.ts`) |
| Offline: queued sends that go out later | missing | missing | not found: grep `outbox`; T-1153 (running) adds one |
| Installable (PWA / APK) | solid | solid | `manifest.webmanifest`, `sw.js`; Android build in `docs/RELEASING.md` |

## 3. Flow walkthroughs

### 3.1 New user from an invite to the first message

1. Friend taps "Invite" (`InviteDialog.tsx:12`), copies the link. Solid; mobile has Share too.
2. New user opens `/invite/<code>` on the web: email, 6-digit code, name, handle
   (`AuthFlow.tsx:66,167-168`). Four screens; Telegram has two. The handle step is skippable
   only if `welcome/handle` allows it (not checked).
3. The chat list shows the inviter already connected (contacts follow invites). Solid.
4. Friction: the first chat has no last-message preview until a message arrives (`chats.ts:83`),
   the composer has no formatting hint, and a pasted link stays a bare link.
5. On the phone the link opens the app (`app.json:28-29`) only with the new APK; an older
   install opens the browser.

### 3.2 Add a friend

1. There is no contacts page. The user must know the exact `@handle`, type it in the search
   bar (`SearchBar.tsx:9-11`) or open `/u/<handle>`.
2. Name search exists in the API (`/users/search`, `contact-requests.ts:143`) but the web
   search bar only matches chats; mobile has `people-search-result.tsx`.
3. Send a request, the other side accepts in Settings > Contact requests. Two screens away;
   Telegram shows a request in the chat itself.
4. Friction: no way to remove the contact later (SG-6), no "share my profile" link or QR
   (not found: grep `qr`), and a stranger can DM anyway (SG-2), which makes requests feel pointless.

### 3.3 Create a group and invite

1. `+` > New group, pick contacts, name it (`NewGroupDialog.tsx`; `new-group-sheet.tsx`). Solid.
2. Group panel: members, roles, invite links with expiry and max uses, visibility and handle.
   Solid and richer than Telegram's defaults.
3. Friction: no group picture on mobile, no "who can send what" permissions, no join
   requests for private groups, no way to leave or delete the group (SG-4), and a removed
   member can rejoin by link (SG-8).

### 3.4 Share a photo

1. Web: paperclip, paste or drop (`ComposerControls.tsx:179`), preview bar, send. Solid.
2. Mobile: attach sheet, one photo at a time, full size (`attachment-picker.ts:98-101`), no
   caption on the preview checked (not verified), no compression toggle.
3. Receiver: web opens the photo in a new tab (`ImageMessage.tsx:54-55`); mobile shows the
   thumbnail with no full-screen viewer (`image-message.tsx:11`). No save-to-gallery.
4. Several photos become several bubbles: no albums.

### 3.5 Find an old message

1. Search bar, typo tolerant, results jump to the message (`search.ts:18-19`). Solid on both.
2. Friction: no filter by sender, date or type; no jump to date; no calendar. The media
   gallery (`ChatMediaPanel.tsx`) covers photos, files and links by chat.

### 3.6 Mute and organise chats

1. Chat menu: Pin, Mute with five durations, Archive (`ChatActionsMenu.tsx:83-123`;
   `chat-actions-sheet.tsx:66-102`). Folders in Settings with chips in the list. Solid.
2. Friction: no swipe actions on mobile, no mark as unread, no delete chat, no mute
   exceptions for mentions, unread counts vanish on restart (MP-6).

## 4. Fix plan (ordered by user impact, then size)

Rule: no task grows a file past 400 lines; tests only for the message pipeline parts.
Tasks 1 and 2 are already in `fix-plan-2026-10-11.md` and are listed for order only.

| # | Task | Web / mobile | Size | Files (new or touched) |
| --- | --- | --- | --- | --- |
| 1 | Server-side unread + last message + read sync (MP-F3, `chat_reads`) | both | L | `apps/server/src/chats/*`, `packages/api-contract/src/chats.ts`, `packages/client-core/src/store/*` |
| 2 | Delivered tick (MP-F8) after T-1153's outbox | both | M | `packages/chat-core/src/types.ts`, `MessageTicks.tsx`, `chat/ticks.tsx` |
| 3 | Link previews: server `GET /api/link-preview?url=` (OG title, description, image, 24 h cache, private-address guard reused from the sandbox), a `LinkPreviewCard` under the bubble on both clients | both | M | new `apps/server/src/link-preview/{api,fetch,parse}.ts`, contract `link-preview.ts`, `apps/web/src/components/message/LinkPreviewCard.tsx`, `apps/mobile/src/components/chat/link-preview-card.tsx` |
| 4 | Human formatting: render the same safe markdown subset for human text (bold, italic, code, strike, links); `**` and `` ` `` shortcuts in the web composer; one "Formatting" hint | both | S | `packages/chat-core/src/markdown.ts:15-21`, `MessageBubble.tsx:85`, `Composer.tsx` |
| 5 | Composer drafts per chat, in memory and `localStorage` / secure store, plus a "Draft:" preview line in the list (UI-F6 extended) | both | S | `packages/client-core/src/store/*` (new `drafts.ts`), `ChatListItem.tsx`, `chat-list-item.tsx` |
| 6 | Full-screen media viewer (zoom, swipe between the chat's images, save) and inline `<video>` on the web | both | M | new `apps/web/src/components/media/MediaViewer.tsx`, `message/AttachmentBody.tsx`; new `apps/mobile/src/components/chat/media-viewer.tsx`, `image-message.tsx` |
| 7 | Leave group, owner transfer, delete group; delete chat and clear history for DMs (SG-4 extended) | both | M | contract `groups.ts`, `chats.ts`; `apps/server/src/groups/api.ts`; `GroupPanel.tsx` danger zone; `group/[id].tsx`; `ChatActionsMenu.tsx`, `chat-actions-sheet.tsx` |
| 8 | Contacts page (list, remove, share-profile link) and name search in the web search bar (uses `/users/search`); with SG-6 | both | M | new `apps/web/src/routes/ContactsPage.tsx`, `SearchBar.tsx`; new `apps/mobile/src/app/settings/contacts.tsx` |
| 9 | Mobile notification settings (mirror `NotificationsPage.tsx` on `push.ts:150-161`), app-icon badge from the unread sum, one default sound | mobile | S | new `apps/mobile/src/app/settings/notifications.tsx`, `lib/settings-items.ts`, `lib/push/native.ts` |
| 10 | Mobile picker: multi-select, downscale to 2048 px / 85 % by default with a "send as file" switch; grouped bubbles for a multi-pick (albums, client-side grouping by a shared `batchId`) | mobile first, web renders groups | M | `apps/mobile/src/lib/attachment-picker.ts`, `attachment-native.ts`, `message-list-row.tsx`; `packages/chat-core/src/media.ts`; `MessageList.tsx` |
| 11 | Mark as unread and swipe actions on the mobile list (archive, mute, pin) | both | S | `chat-prefs.ts` (`unreadMark`), `ChatActionsMenu.tsx`, new `apps/mobile/src/components/chat/chat-list-swipe.tsx` |
| 12 | Account: bio field, sessions list with terminate (Better Auth `listSessions`/`revokeSession`), delete account with 7-day grace, export my messages as JSON from MAM | both | M | contract `auth.ts:40,84`, `apps/server/src/auth/*`, `ProfileSettingsSection.tsx`, `settings/profile.tsx` |

Not recommended now: polls, slow mode, admin log, join requests, scheduled and silent
messages, video notes, passcode lock, themes and languages. They matter to large public
communities, not to the private-group and AI use Zilar targets, and each is a schema plus
three clients.
