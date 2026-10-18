# UI consistency audit: one style and flow across phone and web

T-1947, 2026-10-18. Code-only audit: no app file was changed. The target values come from D24 (`docs/design/ui-style.md` and the approved boards in `docs/design/mockups/`), or from the Telegram pattern where D24 is silent. Line numbers are from this branch.

## 0. How to read the inventory

Current header patterns, as they exist today:

| Code | Pattern |
|---|---|
| `R20` | Root large title, 20/600 |
| `R28` | Root large title, 28/600 |
| `S20` | Sub-screen: back key and a 20/600 title on the same row, optional 14 px subtitle and right action |
| `S28` | Sub-screen: a 56 px back/action row, then a 28/600 title below |
| `S28i` | Sub-screen: back key and a 28/600 title on the same 56 px row |
| `S15` | Shaded bar (`bg-surface`, bottom border): back and a 15/600 title plus 12 px subtitle |
| `CH` | Chat header, 64 px: back, 36 px avatar, 15/600 title (17/600 for a topic), 12 px subtitle, right keys |
| `PH` | Profile-style header: back nav, then a 96–104 px avatar and a 22/600 name (group/channel info, own/public profile) |
| `NAV` | 56 px back-only nav row, title drawn by the body |
| `CARD` | Centred auth card with a 24/600 heading |
| `NONE` | No header |

Section-label shorthand: `SL` is the kit `SectionLabel`; `SL-m` = mobile 11/600/0.08em (`apps/mobile/src/components/ui/card.tsx:22`), `SL-w` = web 11/600/0.06em (`apps/web/src/components/ui/card.tsx:28`). "Local 12/500" means a hand-written label, not the kit.

---

## 1. Targets, one per element

Each target names its source: **D24** when the written spec or an approved board gives the value, **Telegram pattern** when D24 is silent.

### 1.1 Root tab title (phone)

- **Target:** 28/600, line-height 36, tracking `-0.02em`, 16 px gutters, 8 px below the safe area, then an 8 px gap to the first content block.
- **Source:** D24 (`ui-style.md:47`, `Mobile.dc.html:33`, `lean-settings/Phone.dc.html:24`).
- **Component:** `ScreenHeader variant="root"` (new, §3).
- **Applies to:** Chats, My AIs, Settings. Chat keeps its search well under the title (`Mobile.dc.html:39`).

### 1.2 Sub-screen header (phone)

- **Target:** one pattern, used by every pushed screen:
  - a 56 px nav row: back `IconButton` 40×40, radius 12, at the left (4 px inset); optional right action (40×40 `IconButton`, or `Button size="sm"` for a text action such as Save); 16 px right gutter;
  - below it, the title 28/600, line-height 36, tracking `-0.02em`, margin `4px 16px 16px`;
  - optional subtitle 14/400 `--muted-foreground`, one line, 2 px under the title.
- **Source:** D24 — the approved phone boards for Connections (`connections/Phone.dc.html:23-31`), Stickers (`stickers/Phone.dc.html:30-37`) and a pack (`stickers/PhonePack.dc.html`). This is also the pattern `SettingsScreenShell largeTitle` already approximates.
- **Exception, kept as-is:** chat (`CH`, 64 px, 36 avatar) and group header. D24 gives them their own header (`ui-style.md` §5), they are not "sub-screen" chrome, and they stay at 64 px.
- **Exception, kept as-is:** group/channel info and profile screens keep their `PH` body (96/104 px avatar, 22/600 name) because the D24 boards draw them (`group-info/Phone.dc.html:31-35`). Only the top nav row is shared (`ScreenHeader variant="sub" bare`).
- **Component:** `ScreenHeader variant="sub"`; `bare` for the `PH` screens.

### 1.3 Section label

- **Phone target:** 12/500, uppercase, tracking `0.06em`, `#8a8a8a`, 4 px left inset.
- **Web target:** 11/500, uppercase, tracking `0.06em`, `#737373`, 4 px left inset.
- **Source:** D24 phone (`lean-settings/Phone.dc.html:17`, `stickers/Phone.dc.html:24`) and web (`stickers/Main.dc.html:27`).
- **Component:** the existing `SectionLabel` in `components/ui/card.tsx` on both platforms; only its classes change. Group info's sentence-case 13/600 labels (`components/group-info/topics-section.tsx:267,285`) and the sub-page headings at 13/600 become `SectionLabel`.

### 1.4 Filter chips vs segmented control

- **Segmented control** for a small, single-select set that switches the content in place and fits one row: folders, sticker tabs, Explore's kind filter, the group listener's eagerness. Use the kit `SegmentedControl`: recessed well track, 3 px padding, 10 px track radius, 7 px tab radius, 34 px tabs on phone / 30 px on web, 13/500, active tab raised (`segment`).
  - **Source:** D24 (`ui-style.md` §5; `Mobile.dc.html:44-48`; `Main.dc.html:50-51`; `stickers/Phone.dc.html:16-18`).
  - With more than 4 folders the same control scrolls horizontally instead of shrinking below a readable label; the pager stays.
- **Chip** only for an open, multi-select or token-like set where the choice does not swap the page: reactions, scope chips in the composer, mention chips, quick actions. The outline chip is `rounded-full border border-border-strong px-3 py-1 text-[14px]` on phone and the `Chip` kit (`rounded-full px-2 py-0.5 text-[13px]`) on web.
- **Never** hand-roll a third pill style: today Chats draws filled folder pills (`components/chat/folder-tabs.tsx:143`) and Explore draws outlined ones (`app/explore.tsx:247`); both become `SegmentedControl` (folders) and `SegmentedControl mode="radio"` (Explore) respectively.

### 1.5 List row and avatar sizes

| Element | Phone | Web | Source |
|---|---|---|---|
| Settings row (`ListRow`) | 48 px min height, 12 px horizontal / 10 px vertical padding, 34 px `IconTile` radius 10, title 15/500, subtitle 13, chevron 18 | 40 px min, `px-3 py-2.5`, 32 px key tile radius 10, title 14/500, subtitle 13, chevron 16 | D24 §5 + `lean-settings/Phone.dc.html:17-18` |
| Chat row | 52 px avatar, title 16/600, preview 14, 76 px min height, `#1a1a1a` hairline | 52 px avatar narrow / 44 px wide, title 14/600, preview 13 | D24 §5 (`ui-style.md:49`), `Mobile.dc.html:53-83`, `ChatListItem.tsx:119-169` |
| Group info row | `ListRow` with the 34 px tile; the People row uses `leading` for the avatar stack | `ListRow` with 32 px tile | D24 group-info boards |
| Contact / blocked / request settings row | 44 px avatar, title 15/500, subtitle 13 | 36 px avatar, title 14/500 | Telegram pattern (D24 silent) |
| Directory / Explore row | 40 px avatar, title 15/500 | 36 px avatar, title 15/500 | Telegram pattern |
| Chat and group header avatar | 36 px | 36 px | D24 §5 |
| Group / channel info avatar | 96 px | 84 px | D24 group-info boards |
| Settings profile card / own profile | 64 px card, 104 px body | 48 px card, 104 px body | D24 + existing boards |
| Settings row tile | 34 px | 32 px | D24 kit |

Only the sizes in this table are allowed. `44` next to a 52 px chat row is the current request-row bug; it becomes 52.

### 1.6 Header action buttons (profile, group and channel info)

- **Target:** one `ActionTiles` row of equal columns (3–5): a 40 px `IconButton` (radius 12) with a 12/400 `--muted-foreground` label below, 6 px gap, 8 px between columns, 16 px gutters. Web: 36 px key (radius 10), 64 px column, 12 px label.
- **Source:** D24 group info (`group-info/Phone.dc.html:41-46`, `.qa` at 64 px / 36 px key on web, 40 px on phone; Connections README fixes the key sizes).
- **Applies to:** own profile (`Set photo`, `Edit info`, `Settings`), public profile, group info (`Mute`, `Search`, `Add`, `More`), channel info (`Mute`, `Search`, `Share`, `More`). The wide gradient `ActionKey` tiles on the own profile (`components/profile/profile-view.tsx:45-72`) go away.

### 1.7 Request rows

- **Target (phone):** the chat-row geometry — 52 px avatar, 16/600 name, 14 px muted preview, 76 px min height, same hairline — with `Accept` as a primary `Button size="sm"` and `Decline` as an outline `Button size="sm"` at the trailing edge; at 320 px the two keys stack to icon keys.
- **Target (web):** 36 px avatar, title 14/500, subtitle 13, the same two `Button size="sm"` keys on the right.
- **Source:** Telegram pattern (D24 is silent). The 52 px choice is D24 §5's mobile chat-row avatar, so requests read as chats rather than as a second list species.
- **Files:** `apps/mobile/src/components/chat/request-rows.tsx:228-231` and `apps/mobile/src/app/settings/requests.tsx:237`; web `routes/RequestsPage.tsx`.

### 1.8 Share card and dialog header (web)

- **Target:** the kit `Dialog` owns the header: 18/600, tracking `-0.02em`, plus the close key (`components/ui/dialog-parts.tsx:31`). The visible title names the thing — the group or channel on a share card, `Add contact` on a person — never a generic verb. A group or channel card draws a centred 56 px `EntityAvatar`, then the `@handle` at 14, the description at 15, the member count at 14, and one full-width `Button size="lg"` in the footer (`routes/GroupHandleRoute.tsx:217-243`). The Add contact fallback and the error dialog use the same header.
- **Source:** Telegram pattern (D24 is silent on dialogs), built from the existing kit `Dialog`.
- **Applies to:** `/u/:handle`, `/@handle`, the Explore overlay. No new component and no batch: a batch that touches a dialog renders `Dialog title=...` and leaves this header alone.

---

## 2. Phone inventory (`apps/mobile/src/app/**`)

`R20`/`R28`/`S20`/… as in §0. Section labels: `SL-m` = the kit label; `local` = hand-written.

| # | Route | Header file:line | Header pattern | Section label | Chips / segmented | List row and avatar | Header actions |
|---|---|---|---|---|---|---|---|
| 1 | `/` (Chats tab) | `components/chat/search-header.tsx:53`; route `app/(tabs)/index.tsx:194` | `R28` + search well; search-open state is a 15/400 field + Cancel (`search-header.tsx:36`) | none | Filled folder pills, 34 px (`components/chat/folder-tabs.tsx:143`) | `ChatListItem` 52 (`components/chat/chat-list-item.tsx:93`); `GroupListItem` 52 (`group-list-item.tsx:100`); request rows 44 (`request-rows.tsx:228`) | none |
| 2 | `/ais` (My AIs tab) | `components/ais/screen-shell.tsx:46`; route `app/(tabs)/ais.tsx:244` | `R20` + right 40 px `+` key (`(tabs)/ais.tsx:246-250`) | none | none | `AiRow` 40 px avatar, 16/600 (`components/ais/ai-row.tsx:38-87`) | 40 px `IconButton` (New AI) |
| 3 | `/settings` (Settings tab) | `components/settings/screen-shell.tsx:52`; route `app/(tabs)/settings.tsx:238` | `R20`, no back, no right | `SL-m` (`(tabs)/settings.tsx:144`, `:251`) | none | `ListRow` + 34 `IconTile`; profile card 64 (`(tabs)/settings.tsx:121`) | none |
| 4 | `/chat/[id]` | `components/chat/chat-header.tsx:211`; route `app/chat/[id].tsx:98,138,174` | `CH` 64 px, 36 avatar, 15/600 (17 topic) at `chat-header.tsx:166` | none | Reaction chips (`components/chat/reaction-chips.tsx:64`) | message rows; media/sticker bubbles | Back, media, search, more (`chat-header.tsx:247-272`) |
| 5 | `/group/[id]` | `components/chat/group-header.tsx:26`; route `app/group/[id].tsx:226` | `CH`-like 56 px: back, 36 avatar, 15/600 + 12 subtitle (`group-header.tsx:36-53`) | none | none | `GroupTopicList` 52 px rows | none (tap opens info) |
| 6 | `/group-info/[id]` | `components/group-info/root-page.tsx:122-127` | `PH` 56 nav (back only), 96 avatar, 22/600 + 14 subtitle (`root-page.tsx:135-143`) | Local 13/600 sentence case (`topics-section.tsx:267,285`; `members-page.tsx:165,178`) | none | Hand-made `InfoRow` 48 px + 34 tile (`info-row.tsx:31-77`); People row `AvatarStack` | `InfoKeys` 40 px keys + 12 labels (`info-keys.tsx:74-103`) |
| 7 | `/group/new` | `app/group/new.tsx:123` | `S20` + 14 subtitle + ghost Next/Save (`:129-145`) | none | none | chat picker rows 52 | Text `Next` / `Save` |
| 8 | `/ais/[id]` | `components/ais/screen-shell.tsx:46`; route `app/ais/[id].tsx:262` | `S20` + footer Cancel/Save (`:265-277`) | none | none | form fields | Footer buttons |
| 9 | `/at/[handle]` | `app/at/[handle].tsx:141` | `CARD` 20/600 inside a centred card; 56 avatar (`:181`) | none | none | none | Join/Close buttons |
| 10 | `/explore` | `app/explore.tsx:209` | `S15`: shaded bar, back + 15/600 + 12 subtitle (`:212-220`) | none | Outlined filter pills (`:247`) | `EntityAvatar` 40 + Join button (`:283`) | Back only |
| 11 | `/me` | `app/me.tsx:224` | `S28i`: back + 28/600 on one row (`:226-231`) | none | none | `ProfileView` body, 104 avatar, 22/600 (`profile-view.tsx:119-128`) | `ActionKey` wide tiles (`profile-view.tsx:45-72`) |
| 12 | `/u/[handle]` | `app/u/[handle].tsx:256` | `NAV` back only (`:257-261`), body `PH` 104/22 (`profile-header.tsx:23-30`) | none | none | profile body | `ProfileActions` buttons (`profile-actions.tsx:30`) |
| 13 | `/share` | `app/share.tsx:25` | `S15`: back + 15/600 (`:28-34`) | none | none | target picker rows | Back only |
| 14 | `/stickers/[packId]` | `app/stickers/[packId].tsx:156` | `NAV` + back/share (`:158-166`), then 28/600 title in body (`:192`) | none | none | sticker grid | 40 px Share key |
| 15 | `/settings/profile` | `app/settings/profile.tsx:54` → `settings/screen-shell.tsx:52` | `S20` + 14 subtitle + `Save` (`:56-67`) | none | none | form fields | Text `Save` |
| 16 | `/settings/contacts` | `app/settings/contacts.tsx:152` | `S20` + 14 subtitle (`:155-167`) | none | none | `ContactRow` 44 (`components/contacts/contact-row.tsx:39`) | Back only |
| 17 | `/settings/blocked` | `app/settings/blocked.tsx:108` | `S20` + 14 subtitle (`:111-123`) | none | none | `EntityAvatar` 44 (`:191-197`) | Back only |
| 18 | `/settings/devices` | `app/settings/devices.tsx:207` | `S20` + 14 subtitle (`:210-222`) | none | none | hand-made rows, no avatar | Back only |
| 19 | `/settings/requests` | `app/settings/requests.tsx:118` | `S20` + 14 subtitle (`:121-133`) | `SL-m` (`:169,184`) | none | `EntityAvatar` 44 (`:237`) | Back only |
| 20 | `/settings/folders` | `app/settings/folders.tsx:88` | `S20` + 14 subtitle | none | none | `FolderRow` hand-made (`:173`) | Back only |
| 21 | `/settings/folder/[id]` | `app/settings/folder/[id].tsx:169` | `S20`, no subtitle | none | none | form fields, local 16/600 headings (`:180,227,240`) | Back only |
| 22 | `/settings/stickers` | `app/settings/stickers.tsx:155` → `screen-shell.tsx:80` | `S28`: back row + 28/600 title + right `+` (`:158-165`) | Local 12/500 uppercase (`components/stickers/packs-tab.tsx:99`) | `SegmentedControl` (`:166`) | `PackCard` hand-made | 40 px `+` |
| 23 | `/settings/sticker-pack` | `app/settings/sticker-pack.tsx:47` → `screen-shell.tsx:80` | `S28`, no subtitle (`:48-51`) | local 16/600 headings (`:108`) | none | sticker grid | Back only |
| 24 | `/settings/notifications` | `app/settings/notifications.tsx:278` | `S20` + 14 subtitle (`:279-282`) | `SL-m` (`:296,344,366`) | none | `ListRow` / switches | Back only |
| 25 | `/settings/routines` | `app/settings/routines.tsx:157` → `ais/screen-shell.tsx:46` | `S20`, no subtitle | Local 11/500 uppercase (`:243`) | none | routine rows hand-made | Back only |
| 26 | `/settings/approvals` | `app/settings/approvals.tsx:51` → `ais/screen-shell.tsx:46` | `S20` + 14 subtitle (`:52-54`) | none | none | `ApprovalCard` | Back only |
| 27 | `/settings/integrations` | `app/settings/integrations.tsx:103` | `S20` + 14 subtitle (`:104-106`) | none | none | integration cards | Back only |
| 28 | `/settings/machines` | `components/machines/machines-header.tsx:33`; route `app/settings/machines.tsx:82` | `S28` + right `+` (`machines-header.tsx:19-35`) | none | none | `MachineRow` hand-made | 40 px `+` |
| 29 | `/settings/connections` | `components/connections/connections-header.tsx:30`; route `app/settings/connections.tsx:104` | `S28` + right `+` (`connections-header.tsx:18-32`) | none | none | connection rows hand-made | 40 px `+` |
| 30 | `/topic-tools/[id]` | `components/group-info/tools-page.tsx:111` | `S28i`: back + 28/600 on one row (`:113-117`) | none | none | tool/routine rows | Back only |
| 31 | `/login` | `apps/mobile/src/auth/AuthFlow.tsx:168`; route `app/login.tsx` | `CARD` 24/600 | none | none | none | auth buttons |
| 32 | `/invite/[code]` | `apps/mobile/src/auth/AuthFlow.tsx:168`; route `app/invite/[code].tsx` | `CARD` 24/600 | none | none | none | auth buttons |
| 33 | `/welcome/name` | `apps/mobile/src/auth/NameForm.tsx:79`; route `app/welcome/name.tsx` | `CARD` 24/600 | none | none | none | Continue |
| 34 | `/welcome/handle` | `app/welcome/handle.tsx:155` | `CARD` 24/600 | none | none | none | Continue |
| 35 | `/join/[token]` | `components/chat/join-link.tsx:144,153,176,191`; route `app/join/[token].tsx` | `CARD` 18/600 error, 24/600 preview | none | none | preview card 56 | Join/Cancel |
| 36 | `/profile` | `app/profile.tsx:9` | `NONE` (redirect to `/me`) | — | — | — | — |
| 37 | `/+not-found` | `app/+not-found.tsx:11` | `NONE` (centred `StateMessage`) | none | none | none | Back to chats |
| 38 | `/+native-intent` | `app/+native-intent.tsx:1` | `NONE` (native intent handler, no UI) | — | — | — | — |
| 39 | `/dev/blocks` | `app/dev/blocks.tsx` | dev screen, no app chrome | none | none | block gallery | none |
| 40 | `/dev/kit` | `app/dev/kit.tsx` | dev screen, no app chrome | `SL-m` (`mock/dev-kit-screen.tsx:78` etc.) | `SegmentedControl` (`dev-kit-screen.tsx:189`) | kit gallery | none |
| 41 | `/dev/topic-header` | `app/dev/topic-header.tsx` | dev screen (topic header board) | none | none | chat header preview | none |
| 42 | `/dev/whistle` | `app/dev/whistle.tsx:184` | dev screen, 20/600 `variant="h3"` | none | none | spike controls | none |

`app/_layout.tsx` and `app/(tabs)/_layout.tsx` are layouts, not screens; both were read and neither draws a header.

Cross-cutting phone findings:
- The root tab title has three sizes: Chats 28 (`search-header.tsx:53`), Settings 20 (`screen-shell.tsx:52`), My AIs 20 (`ais/screen-shell.tsx:46`).
- Sub-screen headers use five patterns: `S28i` (`me.tsx:224`, `tools-page.tsx:111`), `S20` (`settings/screen-shell.tsx:52`, five settings pages, group/new, Ais), `S28` (`screen-shell.tsx:80`, connections, machines, sticker pack), `S15` (`explore.tsx:209`, `share.tsx:25`), `NAV`+`PH` (`u/[handle].tsx:256`, group/channel info).
- 29 files draw their own `<ChevronLeft>` back key (`grep -rl "<ChevronLeft" apps/mobile/src | wc -l`); `apps/mobile/src/components/ui/` has no shared header. The list is the back-key rows above plus the group/channel sub-pages below, `components/chat/chat-header.tsx`, `components/chat/group-header.tsx`, `components/chat/voice-recording-row.tsx`, `components/ui/bottom-sheet.tsx` and the dev mock.

**Sub-pages that are not their own route** (mounted inside `/group-info/[id]`, `/chat/[id]` and `channel-screen.tsx`):

| Screen | Header file:line | Current pattern | Section label | List row / avatar |
|---|---|---|---|---|
| Group info root | `components/group-info/root-page.tsx:122-127` | `PH` (96 avatar, 22/600) | local 13/600 | `InfoRow` + 34 tile |
| Group info > People and AIs | `components/group-info/members-page.tsx:148-157` | `S28i` (back + 28 on one row) | local 13/600 (`:165`) | member rows, 40 px avatar |
| Group info > Settings | `components/group-info/settings-page.tsx:80-90` | `S28i` | local 13/600 | switches + `SegmentedControl` (`:133`) |
| Group info > Tools and routines | `components/group-info/tools-page.tsx:108-117` | `S28i` | local 13/600 | tool/routine rows |
| Group info > Activity | `components/group-info/activity-page.tsx:19-24` | `S28i` | local 13/600 | activity rows |
| Group info > Always allowed | `components/group-info/allowed-page.tsx:152-157` | `S28i` | local 13/600 | rule rows |
| Channel info root | `components/channel-info/root-page.tsx:104-110` | `PH` (96 avatar, 22/600) | none | `InfoRow` + 34 tile |
| Channel info > Subscribers | `components/channel-info/people-page.tsx:76-85` | `S28i` | local 13/600 | member rows, 40 px avatar (`:116`) |
| Channel info > Settings | `components/channel-info/settings-page.tsx:22-31` | `S28i` | local 13/600 | switches |
| Topic tools route | `app/topic-tools/[id].tsx` → `tools-page.tsx:108` | `S28i` | local 13/600 | tool/routine rows |

---

## 3. Web inventory (`apps/web/src/routes/**` and the panels)

Wide (`≥900 px`) has two panels; the left panel is the chat list, and only the narrow list shows the 28 px `Chats` title (`components/ChatList.tsx:149`). Settings pages all use `SettingsShell` (`components/SettingsShell.tsx:29-48`): 64 px-ish header (`py-3`), 36 px back key, 20/600 title, optional 14 subtitle and action. The chat and info panels have their own headers.

| # | Route / panel | Header file:line | Header pattern | Section label | Chips / segmented | List row and avatar | Header actions |
|---|---|---|---|---|---|---|---|
| 1 | `/` (wide) | `components/ChatList.tsx:144` | no title above the search field (sidebar) | none | `FolderRail` icons + `FolderTabs` (`components/FolderTabs.tsx:56`) | `ChatListItem` 44 wide / 52 narrow (`ChatListItem.tsx:119-121`) | Search field, new chat |
| 2 | `/` (narrow) | `components/ChatList.tsx:149` | `R28` `Chats` | none | Outlined folder pills, 30 px (`FolderTabs.tsx:73-80`) | 52 avatar; 14/600 name | none |
| 3 | `/c/:chatJid` | `components/ChatHeader.tsx:163`; route `routes/ChatView.tsx:245` | Chat header 64 px: back (narrow), 36 avatar, 15/600 + 12 subtitle (`ChatHeaderLines.tsx:11`) | none | reaction chips | message rows | Search, media, more menu |
| 4 | `/settings` | `routes/SettingsHubPage.tsx:75` | `SettingsShell` 20/600 + back | `SL-w` (`:94`) | none | `ListRow` 32 tile; profile card 48 (`:84`) | Back |
| 5 | `/settings/profile` | `routes/ProfilePage.tsx:10` | `SettingsShell` 20/600 + 14 subtitle | none | none | `ProfileSettingsSection` | Back |
| 6 | `/settings/ais` | `routes/AisPage.tsx:59` | `SettingsShell` 20/600 + `New AI` button (`:60-69`) | none | none | AI rows hand-made | `New AI` |
| 7 | `/settings/connections` | `routes/ConnectionsPage.tsx:43` | `SettingsShell` 20/600 + action | none | none | connection rows hand-made | Add key |
| 8 | `/settings/machines` | `routes/MachinesPage.tsx:102` | `SettingsShell` 20/600 | none | none | `MachineListRow` | Add machine |
| 9 | `/settings/approvals` | `routes/ApprovalsPage.tsx:82` | `SettingsShell` 20/600, no subtitle | none | none | `ApprovalCard` | Back |
| 10 | `/settings/routines` | `routes/RoutinesPage.tsx:50` | `SettingsShell` 20/600, no subtitle | `SL-w` (`:113`) | none | routine rows | Back |
| 11 | `/settings/notifications` | `routes/NotificationsPage.tsx:65` | `SettingsShell` 20/600 + 14 subtitle | `SL-w` (`:76,92,115,157`) | none | `Card` + rows | Back |
| 12 | `/settings/stickers` | `routes/StickersPage.tsx:155` | `SettingsShell` 20/600 | Local 11/500/0.06em (`:236`) | `SegmentedControl` (`:194`) | pack rows hand-made | Add pack |
| 13 | `/stickers/:packId` | `routes/StickerPackPage.tsx:112` | Own 64 px header: back, 17/600 title (`:113-117`), share | none | none | sticker grid | Share, panel key |
| 14 | `/settings/requests` | `routes/RequestsPage.tsx:43` | `SettingsShell` 20/600 + 14 subtitle | `SL-w` (`:51,69`) | none | request rows 36 | Back |
| 15 | `/settings/folders` | `routes/FoldersPage.tsx:76` | `SettingsShell` 20/600 + 14 subtitle | none | none | folder rows hand-made | Back |
| 16 | `/settings/blocked` | `routes/BlockedPage.tsx:33` | `SettingsShell` 20/600 + 14 subtitle | none | none | `EntityAvatar` 36 (`:106-112`) | Back |
| 17 | `/settings/contacts` | `routes/ContactsPage.tsx:60` | `SettingsShell` 20/600 + 14 subtitle | none | none | `EntityAvatar` 36 (`:152`) | Back |
| 18 | `/settings/devices` | `routes/DevicesPage.tsx:60` | `SettingsShell` 20/600 + 14 subtitle | none | none | `Card` + rows, no avatar | Back |
| 19 | `/settings/integrations` | `routes/IntegrationsPage.tsx:47` | `SettingsShell` 20/600 + 14 subtitle | none | none | integration cards | Back |
| 20 | `/u/:handle` | `routes/AddContactRoute.tsx:36` | no page chrome; opens `AddContactDialog` (`components/AddContactDialog.tsx:86`, kit `Dialog` head) | none | none | dialog | — |
| 21 | `/@handle` | `routes/GroupHandleRoute.tsx:78`; group card `:217-243` | no page chrome; a public group opens `GroupHandleCard` in a `Dialog` whose title is the group name (`:220`), 56 avatar (`:239`), Join/Open footer (`:225-236`); a person falls back to `AddContactDialog` (`:133`); a failed lookup opens the `Couldn't open this link` `Dialog` (`:137-155`) | none | none | dialog card, 56 avatar | Join/Open, Retry |
| 22 | `/j/:token` | `routes/JoinPage.tsx:130,196,250` | `CARD` 24/600, 56 avatar preview (`:200`) | none | none | preview card | Join/Cancel |
| 23 | `/invite/:code` | `routes/InvitePage.tsx:6` | `CARD` via `AuthFlow` 24/600 | none | none | none | auth buttons |
| 24 | `/login` | `routes/LoginPage.tsx:33` (setup branch) / `AuthFlow` | `CARD` 24/600 | none | none | none | auth buttons |
| 25 | `/setup` | `routes/SetupPage.tsx:166` (error at `:111`) | `CARD` 24/600 | none | none | none | setup steps |
| 26 | `/welcome/name` | `routes/NamePage.tsx:63` | `CARD` 24/600 | none | none | none | Continue |
| 27 | `/welcome/handle` | `routes/HandlePage.tsx:117` | `CARD` 24/600 | none | none | none | Continue |
| 28 | Explore overlay | `components/ExplorePage.tsx:169-175` | `Dialog` title `Explore` (18/600 dialog head, `components/ui/dialog-parts.tsx:31`), 14 subtitle (`:182`) | none | `SegmentedControl mode="radio"` (`:195`) | `EntityAvatar` 36 (`:240`) | `Close` |
| 29 | Group info panel | `components/group-info/GroupInfoRoot.tsx:118` | 56 px nav, close key only; 84 avatar, 20/600 title (`:127`) | none (topic section labels are local) | none | `ListRow` 32 tile (`:198-260`) | `PanelKey` 36 keys (`:136-166`) |
| 30 | Group info sub-page | `components/group-info/GroupInfoPage.tsx:29-34` | 64 px: back, 16/600 title, close | `components/channel-info/*` local 13/600 sentence case | none | `ListRow` | Close |
| 31 | Channel info panel | `components/channel-info/ChannelInfoRoot.tsx:148` | 56 px nav, close key; 84 avatar, 20/600 title (`:157-160`) | none | none | `ListRow` 32 (`:237-323`) | `PanelKey` 36 |
| 32 | Channel people / AIs | `components/channel-info/ChannelPeople.tsx:106,120`, `ChannelAisPage.tsx:48` | `GroupInfoPage` 16/600 | local 13/600 sentence case | none | member rows hand-made | Close |
| 33 | Topic info sheet | `components/TopicPanel.tsx:268` | Sheet with a 13/600 `Topic` heading | local 13/600 | none | `ListRow` | Close |
| 34 | `AppRoutes.tsx` | `routes/AppRoutes.tsx:119-296` | router only | — | — | — | — |
| 35 | `/` and `/c/:chatJid` shell | `routes/ChatShell.tsx:20` | layout only: folder rail, chat list and chat view; no header of its own (rows 1–3 own the headers) | — | — | — | — |

Cross-cutting web findings:
- Settings titles are 20/600, but the D24 boards draw 17/600 in a 64 px header (`lean-settings/Main.dc.html:24-28`, `connections/Main.dc.html:26-30`, `stickers/Main.dc.html:33-37`).
- Group info sub-pages are 16/600 (`GroupInfoPage.tsx:30`), channel people headings are 13/600 sentence case (`ChannelPeople.tsx:106,120`), and settings labels are 11/600 (`card.tsx:28`): three label/title scales for the same kinds of pages.
- The sticker pack page already matches the D24 64/17 header (`StickerPackPage.tsx:113`) and is the model for the web sub-header.
- Groups and channels already use `ListRow`; the mobile twins do not (§2 row 6).

---

## 4. Kit components the targets need

### 4.1 `ScreenHeader` (new, both platforms)

```ts
// apps/mobile/src/components/ui/screen-header.tsx
export type ScreenHeaderProps = {
  variant: 'root' | 'sub';
  title: string;
  /** One muted line under the title. Not drawn when `bare`. */
  subtitle?: string;
  /** A sub-screen's back key. Required for app-chrome sub-screens. */
  onBack?: () => void;
  /** A 40 px key or a small text button at the right end of the nav row. */
  right?: ReactNode;
  /** Sub only: draw the 56 px nav row and let the body own the title (group/channel info, a pack). */
  bare?: boolean;
  testID?: string;
};
```

Layout: `root` = 28/600 title, 16 px gutters, 8 px top; `sub` = 56 px row (back 40×40 r12 at 4 px, `right` at 16 px) + 28/600 title, margin `4px 16px 16px`, optional 14 subtitle; `bare` = the row only. Safe-area top is owned by the caller (the existing shells already wrap in `SafeAreaView edges={['top']}`).

```ts
// apps/web/src/components/ui/screen-header.tsx — the twin
export type ScreenHeaderProps = {
  variant: 'root' | 'sub';
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  bare?: boolean;
};
```

Layout: `root` = 28/600 (narrow `Chats`); `sub` = 64 px row, 36 px back key r10, 17/600 title tracking `-0.02em`, 14 subtitle, bottom border. `SettingsShell` keeps its column and body but renders `ScreenHeader` inside its `<header>`.

### 4.2 `ActionTiles` (new, both platforms)

```ts
// apps/mobile/src/components/ui/action-tiles.tsx
type ActionTile = {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
};
export function ActionTiles(props: { items: ActionTile[]; accessibilityLabel?: string }): JSX.Element;
```

`flex-row gap-2`, each tile `flex-1 items-center gap-1.5` with a 40 px `IconButton` (r12) and a 12/400 muted label. Web twin: 64 px column, 36 px key, same label. Absorbs mobile `InfoKeys` (`components/group-info/info-keys.tsx:74-103`), the profile's `ActionKey` (`components/profile/profile-view.tsx:45-72`) and web `PanelKey` (`components/ui/panel-key.tsx:9-35`); `PanelKey` stays as a thin re-export for one-off keys.

### 4.3 `SectionLabel` (exists; change the classes)

- Mobile `components/ui/card.tsx:18-27`: `text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground`, add `className?: string`.
- Web `components/ui/card.tsx:19-30`: `text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase` (drop 600 → 500).
- No new file. Replace the local labels in `packs-tab.tsx`, `routines.tsx`, `topics-section.tsx`, `members-page.tsx`, `StickersPage.tsx` and `ChannelPeople.tsx`.

### 4.4 Keep, fold, delete

| Existing component | Decision |
|---|---|
| `components/settings/screen-shell.tsx` | Keep the `ScrollView`/footer plumbing in the short term; replace its header with `ScreenHeader`. Delete once every settings page and `/me` use `ScreenHeader` (after M4). |
| `components/ais/screen-shell.tsx` | Same: fold into `ScreenHeader` + the scroll/footer body. It is used by `/ais`, `/ais/[id]`, `/settings/routines`, `/settings/approvals`; keep until M8. |
| `components/connections/connections-header.tsx` | Fold into `ScreenHeader variant="sub"` (its 28/600 + Add is exactly the target); delete in M8. |
| `components/machines/machines-header.tsx` | Same; delete in M8. |
| `components/profile/profile-header.tsx` | Keep as the `PH` body (avatar + name + status); put `ScreenHeader variant="sub" bare` above it. |
| `components/group-info/root-page.tsx`, `channel-info/root-page.tsx` | Keep the `PH` body; use `ScreenHeader bare` for the nav row; keep the 22/600 name. |
| `components/group-info/info-row.tsx` | Fold into `ListRow` + `Card`; delete the file in M6 when its last caller moves. |
| `components/group-info/info-keys.tsx` | Fold into `ActionTiles`; delete in M5. |
| `components/profile/profile-view.tsx` `ActionKey` | Fold into `ActionTiles`; remove in M5. |
| `components/ui/list-row.tsx`, `card.tsx`, `segmented-control.tsx`, `icon-button.tsx`, `icon-tile.tsx`, `chip.tsx` | Keep. They are the target primitives. |
| `components/SettingsShell.tsx` (web) + `SETTINGS_COLUMN` | Keep; header delegates to `ScreenHeader`. |
| `components/ui/panel-key.tsx` (web) | Keep as a re-export of `ActionTiles`'s tile. |
| `components/group-info/GroupInfoPage.tsx` (web) | Keep the file; adopt the 64/17 values, or render `ScreenHeader variant="sub"` with `right={<CloseKey/>}`. |

---

## 5. Fix plan in batches

Rules: each batch changes one platform, at most 6 app files and at most 1 new kit file. Acceptance for every batch is a lead screenshot check of the routes named. "Parallel" means no shared file with the other batches in the same group.

### Phone

**M1 — root tab titles (first; everything else depends on it)**
- New: `apps/mobile/src/components/ui/screen-header.tsx`.
- Edit: `apps/mobile/src/components/chat/search-header.tsx`, `apps/mobile/src/components/settings/screen-shell.tsx`, `apps/mobile/src/components/ais/screen-shell.tsx`.
- Accept: `/`, `/ais`, `/settings`; the three titles are 28/600 on the same baseline.
- Parallel with: none (it creates the kit file).

**M2 — section labels and sticker tabs (after M1)**
- Edit: `apps/mobile/src/components/ui/card.tsx`, `apps/mobile/src/components/stickers/packs-tab.tsx`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/app/settings/routines.tsx`, `apps/mobile/src/app/settings/stickers.tsx`.
- Accept: `/settings` (`ACCOUNT`, `THIS APP`), `/settings/notifications`, `/settings/requests`, `/settings/stickers` (`ADDED`), `/settings/routines`; all labels 12/500/0.06em.
- Parallel with: M3, M4, M5 (distinct files).

**M3 — one tap away headers (after M1)**
- Edit: `apps/mobile/src/app/me.tsx`, `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/share.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/app/settings/contacts.tsx`, `apps/mobile/src/app/settings/blocked.tsx`.
- Accept: `/me`, `/explore`, `/share`, `/settings/profile`, `/settings/contacts`, `/settings/blocked`; all use `ScreenHeader variant="sub"` (56 row + 28 title + optional subtitle + right Save).
- Parallel with: M2, M4, M5.

**M4 — remaining settings headers (after M1)**
- Edit: `apps/mobile/src/app/settings/devices.tsx`, `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/app/group/new.tsx`.
- Accept: `/settings/devices`, `/settings/folders`, `/settings/folder/new`, `/settings/integrations`, `/settings/sticker-pack`, `/group/new`; headers match M3.
- Parallel with: M2, M3, M5.

**M5 — profile and info action tiles (after M1; new kit file)**
- New: `apps/mobile/src/components/ui/action-tiles.tsx`.
- Edit: `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/profile/profile-actions.tsx`, `apps/mobile/src/components/group-info/info-keys.tsx`, `apps/mobile/src/components/group-info/root-page.tsx`, `apps/mobile/src/components/channel-info/root-page.tsx`, `apps/mobile/src/app/u/[handle].tsx`.
- Accept: `/me`, `/u/<handle>`, `/group-info/<id>`, a channel's info screen (mounted from `components/chat/channel-screen.tsx:273`); action rows are the same 40 px key + 12 label tiles.
- Parallel with: M2, M4.

**M6 — info rows and info sub-pages (after M5)**
- Edit: `apps/mobile/src/components/group-info/info-row.tsx`, `apps/mobile/src/components/group-info/topics-section.tsx`, `apps/mobile/src/components/group-info/members-page.tsx`, `apps/mobile/src/components/group-info/tools-page.tsx`, `apps/mobile/src/components/group-info/settings-page.tsx`, `apps/mobile/src/components/channel-info/people-page.tsx`.
- Accept: group info root rows use `ListRow`/`Card`; `Your topics`/`Other topics` are 12/500 uppercase; the group/channel info sub-pages use the same header.
- Parallel with: M7, M8, M9 (M8 uses the shell, not these files).

**M9 — the last info sub-pages (parallel with M6)**
- Edit: `apps/mobile/src/components/group-info/activity-page.tsx`, `apps/mobile/src/components/group-info/allowed-page.tsx`, `apps/mobile/src/components/channel-info/settings-page.tsx`.
- Accept: group info > Activity, group info > Always allowed, channel info > Settings; same header and labels as M6.
- Parallel with: M6, M7, M8.

**M7 — folders and request rows (after M2 and M3)**
- Edit: `apps/mobile/src/components/chat/folder-tabs.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/request-rows.tsx`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/app/explore.tsx`.
- Accept: `/` folder tabs are the kit segmented control (raised active tab, 13/500); `/explore` uses the same control in radio mode; `/settings/requests` and the Chats requests block use 52 px avatars and 16/600 names.
- Parallel with: M6, M8.

**M8 — fold the last two headers (after M1 and M4)**
- Edit: `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/app/settings/approvals.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/connections/connections-header.tsx`, `apps/mobile/src/components/machines/machines-header.tsx`.
- Accept: `/ais/<id>`, `/settings/approvals`, `/settings/connections`, `/settings/machines`; no screen draws its own `ChevronLeft` header any more.
- Parallel with: M6, M7, M9.

**M10 — the pack link page (after M3)**
- Edit: `apps/mobile/src/app/stickers/[packId].tsx`.
- Accept: `/stickers/<packId>`; back + Share in the 56 px row, the 28/600 pack title in the body (D24 `stickers/PhonePack.dc.html`).
- Parallel with: M6, M7, M8, M9.

### Web

**W1 — shared shell header and labels (first)**
- New: `apps/web/src/components/ui/screen-header.tsx`.
- Edit: `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/ui/card.tsx`.
- Accept: every `/settings/*` page shows a 64 px header, 36 px back key, 17/600 title, 14 subtitle; section labels are 11/500/0.06em.
- Parallel with: none.

**W2 — one tap away settings pages (after W1)**
- Edit: `apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/ApprovalsPage.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/MachinesPage.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/routes/RequestsPage.tsx`.
- Accept: `/settings/ais`, `/settings/approvals`, `/settings/connections`, `/settings/machines`, `/settings/notifications`, `/settings/requests`.
- Parallel with: W3, W4, W5.

**W3 — remaining settings pages (after W1)**
- Edit: `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/ContactsPage.tsx`, `apps/web/src/routes/DevicesPage.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/routes/RoutinesPage.tsx`.
- Accept: those six routes.
- Parallel with: W2, W4, W5.

**W4 — stickers (after W1)**
- Edit: `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/routes/StickerPackPage.tsx`, `apps/web/src/components/PackEditor.tsx`.
- Accept: `/settings/stickers`, `/stickers/<packId>`; the pack page's 64/17 header is the model, its section labels use `SectionLabel`.
- Parallel with: W2, W3, W5.

**W5 — chat list and info panels (after W1; new kit file)**
- New: `apps/web/src/components/ui/action-tiles.tsx`.
- Edit: `apps/web/src/components/FolderTabs.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ui/panel-key.tsx`, `apps/web/src/components/group-info/GroupInfoPage.tsx`, `apps/web/src/components/group-info/GroupInfoRoot.tsx`, `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`.
- Accept: `/` folders are the segmented control; group and channel info panels and sub-pages share the 64/17 header and the 36 px `PanelKey` tiles.
- Parallel with: W2, W3, W4 (W5 owns the panels).

**W6 — info sub-page labels (after W5)**
- Edit: `apps/web/src/components/group-info/PeoplePage.tsx`, `apps/web/src/components/group-info/TopicsSection.tsx`, `apps/web/src/components/channel-info/ChannelPeople.tsx`, `apps/web/src/components/channel-info/ChannelAisPage.tsx`.
- Accept: group info > People, channel info > Admins/Subscribers/AIs; labels use `SectionLabel`.
- Parallel with: none.

---

## 6. Behaviour gaps against Telegram/WhatsApp (not fixed here)

These are flow gaps found while reading the code. Each is out of scope for this style audit and gets its own task if Julio wants it.

1. **No pull-to-refresh on most phone settings lists.** Chats, group topics, approvals and routines have one (`components/chat/chat-list-page.tsx:82`, `components/chat/group-topic-list.tsx:97`, `settings/approvals.tsx:76`, `settings/routines.tsx:180`). Contacts, Blocked, Devices, Requests, Connections, Machines, Folders, Integrations and Notifications do not (`settings/contacts.tsx:166`, `blocked.tsx:122`, `devices.tsx:221`, `requests.tsx:136`, `connections.tsx:110`, `machines.tsx:84`, and the shared `components/settings/screen-shell.tsx:67`). Telegram and WhatsApp both let you pull to resync.
2. **Re-tapping the active root tab does not scroll to top or pop to the root.** `components/nav/floating-tab-bar.tsx:55-87` only navigates. Telegram scrolls the active tab's list to the top, and WhatsApp pops an open chat back to the list.
3. **No edge-swipe back on Android.** `app/_layout.tsx:180` sets only `headerShown: false`; the native stack's iOS swipe is on by default, but Android has only the system back key. Telegram and WhatsApp support an edge swipe on both.
4. **Explore is a different flow per platform.** Phone has a full route with a back key (`app/explore.tsx:209`), web opens a `Dialog` overlay (`components/ExplorePage.tsx:169`), so web has no URL for it and browser Back closes the whole app view. Telegram desktop uses a page, like the phone.
5. **No horizontal swipe between the three root tabs.** `app/(tabs)/_layout.tsx:19-42` is a headless `Tabs` without a pager; Telegram pages between tabs with a horizontal swipe.
6. **No visible per-chat menu key on phone.** Row actions are long-press and swipe only (`app/(tabs)/index.tsx:218`, `components/chat/chat-row-swipe.tsx:68`); Telegram now also shows a "⋯" key on the row. Web already has both a hover menu and right-click (`components/ChatListItem.tsx:105`).

---

## 7. Verification

- No app file was changed. `git status` should show only `docs/audit/ui-consistency.md` and the task file.
- Every route in `apps/mobile/src/app/**` and `apps/web/src/routes/**` has a row above; the route lists came from `find apps/mobile/src/app -type f` and `ls apps/web/src/routes`.
- The line numbers were taken from this branch with `grep -n`; the D24 values were read from `docs/design/ui-style.md` and the named boards.
