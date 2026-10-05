# Brief: bottom bar, configurable chat folders, Settings and Profile

Owner ask (Julio): the All / Personal / AIs / Work strip must be fully editable like Telegram; move My AIs and Settings to a floating bottom bar; redo Settings and Profile. Mockup: `telegram-nav-folders-settings.html` (same folder). Telegram references: chat list, Settings, Profile screenshots in Downloads. Emulator screenshots of today's app: `/Users/julio/.claude/jobs/fcd95e40/tmp/design/{home,settings,settings-profile,ais}.png`.

Rules: lucide icons only (no emoji, folder icons included), dark only, Zilar tokens (`apps/mobile/src/global.css:11-45`: page #000, background #0a0a0a, surface #111, surface-raised #171717, border #1f1f1f, foreground #ededed, muted #a1a1a1, accent #ededed, danger #ef4444, radius 12). Zilar is monochrome; keep it that way. Web first: every server and web piece lands before the mobile piece.

## What exists today (verified)

- Home header: "Chats" + three icon buttons My AIs `router.push('/ais')`, Search (opens inline search), Settings `router.push('/settings')`: `apps/mobile/src/app/index.tsx:245-256`. Search is a header icon that swaps the header for an input (`index.tsx:204-243`). FAB `NewChatButton` is last child at `index.tsx:~462`, 56 px, bottom-right (`components/chat/new-chat-button.tsx`).
- Folders: segmented control `components/chat/folder-tabs.tsx`, hard-coded `CHAT_FOLDERS` in `lib/filter.ts:3-8`, type `ChatFolder = 'all'|'personal'|'ai'|'work'` in `lib/types.ts:6`. Active folder lives in the chat store (`index.tsx:56-57`). Unread per folder `filter.ts:23-32` (muted chats excluded). Web twin: `apps/web/src/components/FolderTabs.tsx:7-12`.
- Server stores nothing about folders. `chat_prefs` (user, chat jid, muted_until, archived, pinned_at) is the nearest table: `apps/server/src/db/schema.ts:582-598`, routes `apps/server/src/chat-prefs/routes.ts`.
- CAVEAT: `space` is hard-coded `'personal'` for every chat in `apps/mobile/src/store/real-store.ts:261-268`. So today "Work" is always empty and "Personal" is everything that is not an AI. There is no real work space data. Do not build folder rules on `space`.
- Root layout is a plain `<Stack screenOptions={{ headerShown: false }} />` (`apps/mobile/src/app/_layout.tsx:~72`). There is no tabs navigator.
- No Contacts screen. `lib/contacts-api.ts` only does `/api/users/by-handle` lookup and contact requests; people are found through search (`@handle`, `index.tsx` PeopleSearchResult) and requests live at `settings/requests`. Contacts list exists only as `store.contacts` for the new-message sheet.
- Settings hub: `apps/mobile/src/app/settings/index.tsx`, rows from `lib/settings-items.ts` (profile, ais, requests, approvals, machines, connections, integrations, stickers; `merge=union` file, append-only). Sub-screens: `settings/{profile,requests,connections,integrations,machines,approvals,stickers,sticker-pack}.tsx`. Web has also `/settings/notifications` (`NotificationsPage.tsx`) with no mobile twin. Web reaches settings from the ChatList menu (`apps/web/src/components/ChatList.tsx:150-290`).
- Profile data (`lib/profile-api.ts:21-38`): `id, email, name, handle|null, avatarUrl?`. No bio, phone or birthday exist. Avatar upload/remove, name save, handle claim/check exist.

## a. Bottom floating tab bar (mobile)

Tabs (4): **Chats** (message icon, unread badge = total unread of non-muted chats, same rule as `filter.ts:23`), **AIs** (bot; the My AIs list, `app/ais/index.tsx`), **Settings** (settings icon), **Profile** (own avatar, initials fallback). No Contacts tab: there is no contacts screen and people are added via search and requests. Add a later "Contacts" only if a contacts list is built (not needed now). Contact requests get a badge on the Settings row (see c).

Leaves the home header: My AIs and Settings buttons. Header becomes: title "Chats" (left) and the new-chat entry stays the FAB. Search moves to a Telegram-style search bar under the title (full-width pill, "Search chats, messages, @username"); tapping it opens the existing search mode (`searchOpen` state, same screens and PeopleSearch). In search mode the bar and folder chips hide as today.

Bar look: floating pill, 16 px side margin, 12 px above the safe-area bottom inset, height 64, radius 32, fill `surface` (#111) with `border` hairline and the existing raised shadow; selected tab = `surface-raised` pill with foreground icon + label, others muted. Labels always shown (11 px). Badge: `accent` fill, `accent-foreground` text.

Compose FAB: stays 56 px, right edge 16 px, sits 12 px above the bar top (bottom offset = inset + 12 + 64 + 12). List `contentPaddingBottom` raises from 96 to about 180 so the last row clears both.

Hiding: the bar shows only on the four tab roots. Chat, group, topic, settings sub-screens, `ais/[id]`, `ais/new`, `u/`, `at/`, join, invite are pushed above it and cover it (full-screen Stack screens). Keyboard open: the bar must not ride up (Android `tabBarHideOnKeyboard: true`).

Safe area: use `useSafeAreaInsets().bottom` for the bar offset; tab screens keep `SafeAreaView edges={['top']}` and add bottom padding for the bar. Android gesture-nav: the 12 px gap goes above the inset, not inside it.

expo-router change: this is a route-group move, not a tweak. Create `apps/mobile/src/app/(tabs)/_layout.tsx` (a `Tabs` navigator with a custom floating `tabBar` component) and move four files into the group: `index.tsx` -> `(tabs)/index.tsx` (Chats), `ais/index.tsx` -> `(tabs)/ais.tsx`, `settings/index.tsx` -> `(tabs)/settings.tsx`, new `(tabs)/profile.tsx`. URLs stay `/`, `/ais`, `/settings` (group names are not in the URL), so deep links and `router.push('/settings')` keep working. `ais/[id]`, `ais/new`, `settings/*` sub-screens, `chat/[id]` etc. stay where they are and are siblings of `(tabs)` in the root Stack. Root `_layout.tsx` Stack gets `<Stack.Screen name="(tabs)" />`. Danger: `ais/index.tsx` and `ais/[id].tsx` live in one folder today; moving only `index` needs the folder to keep `[id]` and `new` (use `ais/_layout`-less siblings, or move the list to `(tabs)/ais.tsx` and delete `ais/index.tsx`, otherwise `/ais` is ambiguous). `lib/routes-dir.test.ts` checks the route dir, update it. Back from a sub-screen must land on its tab (default Stack behaviour).

## b. Chat folders, fully configurable

Chips row (replaces the segmented control): horizontally scrollable chips under the search bar, each chip = lucide icon + name + unread count (count hides at 0; muted chats excluded as today). First chip "All chats" always exists and always shows; it cannot be deleted, renamed or reordered. Swipe left/right on the list switches folder (later). Selected chip = `surface-raised` fill + foreground, others muted.

Long-press a chip: sheet with Edit folder, Reorder (enters drag mode), Delete (danger, confirm). Last chip is a "+" chip opening the editor (hidden when 20 folders). "All chats" long-press: only "Edit order of folders" opens the Chat Folders screen.

Folder editor (Telegram parity): name (1-24 chars), icon (grid of ~24 lucide icons, fixed set: `folder, message-circle, user, users, megaphone, bot, briefcase, house, star, heart, bookmark, flag, bell, globe, graduation-cap, gamepad-2, music, camera, shopping-bag, plane, coffee, dumbbell, code, wallet`), "Included chats": toggles for types Personal chats (dm with a person), Groups, Channels, AIs; plus "Add chats" picker for individually included chats. "Excluded chats": picker. Toggles "Exclude muted" and "Exclude read" (unread = 0). Archived chats never appear in folders (they stay in the Archived block). No "Work space" type: `space` is not real data (see caveat); do not offer it.

Matching rule (one pure function used by web and mobile, in `packages/chat-core`): chat is in folder if not excluded by id, and (included by id OR matches an enabled type), and not (excludeMuted and muted) and not (excludeRead and unread = 0). Types come from existing fields: dm = `kind === 'dm'`, AI = `isAI` or `kind === 'ai'`, group = `chatKind !== 'channel'` of kind group, channel = `chatKind === 'channel'`.

Chat Folders settings screen (`settings/folders`): list of folders with drag handle, icon, name, summary ("Personal chats, 3 chats"), tap to edit; "Create new folder" row; "Recommended" section is skipped. Defaults: every user gets Personal (types: personal chats), AIs (type: AIs), Work (no rule, empty, user fills it). Defaults are ordinary rows, editable and deletable. Seed them in a migration for existing users and lazily on first `GET` for new ones.

Server data model: table `chat_folders`: `id uuid pk`, `user_id` fk user cascade, `name text` check 1-24 chars, `icon text` check in the fixed set (validated in zod, free text in DB), `position int not null`, `include_types text[]` (subset of `dm|group|channel|ai`), `include_chats text[]` (chat jids, max 100), `exclude_chats text[]` (max 100), `exclude_muted bool default false`, `exclude_read bool default false`, `created_at`, `updated_at`. Unique `(user_id, position)` deferrable, index on `user_id`. Limits: 20 folders per user, 100 included and 100 excluded chats per folder, jid length 1-255 like `chat_prefs`. A chat jid that no longer exists is ignored at match time and pruned on write.

REST (session auth, same style as `chat-prefs/routes.ts`, rate limit 60 writes/min):
- `GET /api/chat-folders` -> `{ folders: Folder[] }` ordered by position; seeds defaults if the user has none.
- `POST /api/chat-folders` create (body without id/position; appended last). 409 over 20.
- `PATCH /api/chat-folders/:id` partial update, strict body.
- `PUT /api/chat-folders/order` body `{ ids: string[] }` full ordered list; 400 if it is not exactly the user's folders.
- `DELETE /api/chat-folders/:id`.
Sync: clients refetch on app focus and on a `chat-folders` realtime event if the existing event channel has a place for it (check `apps/server/src/xmpp` and the store's refresh hooks while writing the task); otherwise refetch on focus only. Active folder id stays local per device.

Web: replace `FolderTabs.tsx` with the same chips (scrollable, right-click or "..." menu for Edit / Reorder / Delete), a Chat Folders page under `/settings/folders`, and a menu entry in `ChatList.tsx`. Store: `folderUnread` and `FolderId` in `apps/web/src/store/store.ts` become id-based.

## c. Settings screen redesign

Header (tab screen, no back button): big avatar (72), name, "@handle" (or email while unclaimed), a small camera badge on the avatar that opens the picture picker (existing `avatar-native.ts`). Below, grouped cards (radius 16, `surface`, hairline `border` dividers inside the card), rows = icon tile 36x36 radius 10 + title + one-line subtitle + chevron. Telegram's tiles are coloured; Zilar is monochrome, so tiles are `surface-raised` with a foreground icon and a 1 px `border-strong`, one tint per group optional (see open question 1).

Groups and rows (all point to existing screens):
1. Account: Profile and username (`/settings/profile`), Contact requests with count badge (`/settings/requests`).
2. AIs and tools: My AIs (`/ais`), Approvals (`/settings/approvals`), Machines (`/settings/machines`), Connections (`/settings/connections`).
3. Chats: Chat Folders (new, `/settings/folders`), Stickers (`/settings/stickers`).
4. Server: Integrations (`/settings/integrations`).
Later (do not build now, mark in UI as absent): Notifications (web page exists, mobile twin needed), Privacy and Security, Data and Storage, Devices, Language, Power Saving. Only the first is realistic soon.

My AIs appears both as a tab and as a Settings row; keep the row (it is where the AI config lives) or drop it, see open question 4. `SETTINGS_ITEMS` stays the single source; add `group` and `iconTile` fields and a `folders` row.

## d. Profile screen (new tab)

Telegram's Profile is "me as others see me". Content, using only existing data:
- Big avatar (120) centred, name (22 px semibold), status line "online" (static) or the @handle.
- Three action tiles in a row (radius 16, `surface`, icon over label): Set Photo (picker, `avatar-native.ts`; label "Change Photo" when one exists), Edit Info (`/settings/profile`: name and @username fields as today), Settings (switch to the Settings tab).
- Info card (`surface`, rows with value on top and muted label below, tap to copy): `@handle` (Username; copy; "Claim a username" row when null), Email (`profile.email`, label "Email"), and a share row "Share my profile link" only if a link form exists (`/u/<handle>` route exists, `apps/mobile/src/app/u/[handle].tsx`; confirm the public URL before building).
- Not available, so not shown: phone, birthday, bio, Posts. Do not invent. A bio would need a server field (later).
`settings/profile.tsx` stays as the edit screen; restyle it to the same cards (avatar block, name field, username field with availability text).

## e. Task split (small, in order)

1. Server: migration + `chat_folders` table, service (list/seed defaults, create, patch, order, delete, limits), routes, tests. (one schema task)
2. chat-core: `Folder` type + pure `folderMatches` / `folderUnread` with tests, shared by web and mobile.
3. Web: folders API client + store (id-based), chips row, folder editor dialog (name, icon grid, types, include/exclude pickers, toggles), long-press/menu, `/settings/folders` page with drag reorder.
4. Mobile: folders API client + store wiring, chip row component replacing `folder-tabs.tsx`, `filter.ts` moves to the shared matcher (no unit change in unread rules).
5. Mobile: folder editor screen and `settings/folders` screen with drag reorder; chip long-press sheet.
6. Mobile: route-group move to `(tabs)` with the plain tab bar and the four screens (no restyle); fix `routes-dir.test.ts`; keep header buttons until 7.
7. Mobile: floating bar look, Chats badge, FAB offset, search bar replaces header icons, remove My AIs/Settings buttons, keyboard hide.
8. Mobile: Settings hub redesign (header, grouped cards, tiles, new `settings-items` fields, Folders row).
9. Mobile: Profile tab + restyle `settings/profile.tsx`.
10. Later: Notifications settings on mobile; swipe between folders; Contacts only if a contacts list is built.

Steps 1-3 can start at once after 2 is merged; 6-9 are independent of 4-5 apart from the Settings Folders row (8 links to a route made in 5; add the row in 5).

## Decisions (Julio, 2026-10-05)
1. Icon tiles: monochrome D24 keys (no colours).
2. Work: NOT created. Defaults are only Personal (type: personal chats) and AIs (type: AIs); the user creates Work or any other folder. This overrides "Defaults" in section b.
3. Tabs: Chats, AIs, Settings, Profile. No Contacts tab.
4. Desktop (web): a slim folder rail on the left like Telegram Desktop (folders with counts, New; My AIs, Settings and the avatar at its foot). Chat folders settings page = one centered column; the editor opens in a dialog (sections: Name and icon, Show these chats, Hide; Delete apart from Save). See mockup v3.
5. My AIs leaves the Settings list on mobile (it is a tab); the web rail has a My AIs key.
6. Look: the approved D24 recipes (`docs/design/ui-style.md`, `apps/web/src/index.css` key-primary, key-icon, well-surface, segment-raised). The mockup `telegram-nav-folders-settings.html` v3 is the reference.
