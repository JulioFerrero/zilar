# Avatar seeds audit (T-1203)

> Since T-1334 the orb is seeded by the normalized display name (Julio,
> 2026-10-13); a rename changes the orb. The rules below describe the
> pre-T-1334 id seeds and stay as the audit record.

Audit only: no code changed. Every row traces the seed to where the value is
set and names the other ids available at that call site without a new request.

## 0. The two ball functions are the same picture

- `avatarSvg(seed)` (`packages/chat-core/src/avatar.ts:63-65`) returns
  `ballAvatarSvg(seed)` directly.
- `ballAvatarSvg(seed)` (`packages/ball-avatar/index.ts:39-83`) hashes the
  seed with FNV-1a (`hashSeed`, `index.ts:8-15`) and draws hue, light angle
  and rim deterministically from it.
- Same seed in, byte-identical SVG out: the only difference between call
  sites is the seed string, never the renderer.
- Web's `Avatar` renders `avatarDataUri(id)` as an `<img>`
  (`apps/web/src/components/Avatar.tsx:23`); `avatarDataUri` is
  `avatarSvg` URL-encoded (`packages/chat-core/src/avatar.ts:68-70`).
  Mobile's `Avatar` renders `avatarSvg(id)` as inline SVG
  (`apps/mobile/src/components/chat/avatar.tsx:80`). Both apps use
  `avatarSvg` from `@zilar/chat-core`; nothing calls `ballAvatarSvg`
  directly. `avatarGradient` (`packages/chat-core/src/avatar.ts:32-35`)
  has no call sites in either app (grep finds only its definition).
- Both apps also keep an `ai` prop on `Avatar`
  (`apps/web/src/components/Avatar.tsx:9`,
  `apps/mobile/src/components/chat/avatar.tsx:24`), but it only labels the
  row (badge/picker copy) — the ball never branches on it.

## 1. What each seed value really is

Seed kinds seen below, traced to their source:

- **user id** — the Better Auth id (`MyProfile.id`,
  `apps/mobile/src/lib/profile-api.ts:34-40`; web `user.id` from the auth
  session, `apps/web/src/components/ProfileSettingsSection.tsx:52-60`).
  Lowercased it becomes the XMPP localpart for normal ids; odd ids fall
  back to a `u<hash>` localpart
  (`apps/server/src/xmpp/provisioning.ts:29-35`). It is NOT a JID.
- **bare JID** — `local@domain`, no resource. A DM chat row's id IS the
  peer's bare JID ("A DM row's id is the peer's bare jid",
  `apps/mobile/src/components/chat/chat-header.tsx:18-22`; web matches
  `chat.id === contact.jid`,
  `apps/web/src/components/PeopleSearchResult.tsx:90`,
  `apps/web/src/components/ContactProfileRow.tsx:142`). Chat rows are
  built with `id: entry.chatJid`
  (`packages/client-core/src/store/chat-rows.ts:60`).
- **room JID** — a topic's room JID (`Topic.chatJid`,
  `packages/api-contract/src/topics.ts:192`). Every topic row is keyed by
  it ("One topic becomes its own chat row (T-0111), keyed by the topic's
  room JID", `packages/client-core/src/store/chat-rows.ts:103-108`), and
  the General topic keeps the group's old chat id
  (`packages/chat-core/src/types.ts:117-120`). It is NOT the group id.
- **group id** — the `groups` table UUID (`GroupDetail.id`,
  `apps/server/src/groups/schemas.ts:51-52`; seeded as
  `randomUUID()`, `apps/server/src/test-support/seed.ts:106`; directory
  entries carry it as `entry.id`,
  `apps/server/src/directory/service.ts:170`). It never appears on the
  wire as a JID.
- **AI JID** — `ai-<aiId>@<domain>` (`apps/server/src/test-support/seed.ts:62-63`;
  `isAiJid` checks the `ai-` localpart,
  `packages/protocol/src/jid.ts:35-37`). `PublicAi` carries both
  (`id` + `jid`, `packages/api-contract/src/ais.ts:115-131`); group AIs
  carry `aiId` + `jid` (`apps/server/src/groups/schemas.ts:86-93`); topic
  AIs carry only `id` (`apps/server/src/topics/access.ts:68-71`).
- **MUC occupant JID** — `roomJid/nick`, only as a fallback (see §3).

## 2. Call-site table

"Draws" = person (human), AI, group/channel row, or topic row. "Also
available" = in scope at the call site with no new request (props, store
slices, or the row/detail already loaded there).

### Mobile — direct `avatarSvg` calls (no `Avatar` wrapper)

| File:line | Draws | Seed | What the seed is | Also available |
|---|---|---|---|---|
| `apps/mobile/src/components/profile/profile-view.tsx:113` | person (self) | `profile.id` | user id (`MyProfile`, `apps/mobile/src/lib/profile-api.ts:34-40`) | own JID from `getMe()` (`XmppToken.jid`, `apps/mobile/src/lib/chat-api.ts:45-52`); own bare JID via `jidFor(localpartFor(id))` — needs the domain |
| `apps/mobile/src/components/nav/floating-tab-bar.tsx:93` | person (self) | `profile.id` | user id (`TabProfile.id`, `floating-tab-bar.tsx:56-62`, set from `me.id`, `apps/mobile/src/app/(tabs)/_layout.tsx:43-47`) | same as above |
| `apps/mobile/src/components/chat/avatar.tsx:80` | whatever the caller passes | `id` prop | the caller's seed (see rows below) | the caller's scope |

### Mobile — `Avatar` call sites

| File:line | Draws | Seed | What the seed is | Also available |
|---|---|---|---|---|
| `chat-list-item.tsx:83-84` | DM peer / AI chat / legacy group row | `chat.id` | DM: peer bare JID; AI chat: AI JID; legacy group row: General room JID (`chat-rows.ts:60`, `chat-header.tsx:18-22`) | `chat.groupId` when it is a topic (`types.ts:175-176`); contact JID via `chat.id` itself |
| `chat-header.tsx:128-129` | same chat as above | `chat.id` | same as above | `dmHandleFor` already resolves the contact from `chat.id` (`chat-header.tsx:24-34`); `chat.groupId` on topics |
| `group-list-item.tsx:96` | group | `groupId` prop = `row.groupId` (`chat-rows.tsx:36-38`) | group id UUID (`chat-list.ts:15`, `chat-list.ts:41-43`) | the group's topic rows (`topicsOfGroup(chats, groupId)`, `group-list-item.tsx:55`); the General room JID via `topics.find(isGeneral).id` — needs the same lookup `group/[id].tsx:78-81` already does |
| `group-header.tsx:39` | group | `avatarId` prop | General topic's chat id = General room JID ("The General topic's chat id", `group-header.tsx:11-12`; set as `groupChatId`, `group/[id].tsx:81`) | `groupId` (the screen holds it, `group/[id].tsx:73-76`); member `userId`s from the detail |
| `topic-info-sheet.tsx:134` | topic | `chat.id` | topic room JID (`chat-rows.ts:103-108`) | `chat.groupId` on the row (`types.ts:175-176`) |
| `topic-info-sheet.tsx:155` | person (member) | `member.userId` | user id (`GroupMember`, `chat-api.ts:41`) | member's bare JID only via `jidFor(localpartFor(userId), domain)` — needs the XMPP domain; handle when set |
| `topic-info-sheet.tsx:170` | AI | `ai.id` | AI id (`Topic.ai.ais: TopicAi[]`, contract `topics.ts:164-166`; mobile reads `ai.id`) | AI JID is NOT in `TopicAi` (only `id`+`name`, `topics/access.ts:68-71`); the group detail's `ais[].jid` has it when loaded (`groups/schemas.ts:86-93`) |
| `message-bubble.tsx:244` | person / AI (group sender) | `message.senderId` | real bare JID, else occupant JID fallback (see §3; `ledger-incoming.ts:121`, `resolve-sender.ts:27-88`) | `senderName`; the member's `userId` is NOT on the message — needs the roster/detail lookup |
| `message-bubble-tombstone.tsx:30` | same as above | `message.senderId` | same as above | same as above |
| `mention-picker.tsx:39` | person / AI (member) | `member.jid` | bare JID built as `${localpart}@${domain}` for humans, AI JID for AIs (`groupMembers.ts:28-40`) | member `userId` is NOT in `MentionMember` (only `jid`/`name`/`handle`, `types.ts:37-43`) — needs the detail |
| `channel-members.tsx:40` | person (admin/subscriber) | `member.userId` | user id (`ChannelMember`, `channel-members.tsx:9-13`) | bare JID only via domain; nothing else |
| `forward-sheet.tsx:120` | DM / AI / group-topic target | `chat.id` | DM: peer bare JID; topic: room JID (same as chat-list-item) | `chat.groupId` on topics |
| `new-group-sheet.tsx:217` | person (contact) | `contact.userId` | user id (`Contact`, contract `contacts.ts:9-16`) | `contact.jid` on the same row (contract `contacts.ts:12`) |
| `new-topic-sheet.tsx:205` | person (group member) | `member.userId` | user id (detail member) | bare JID only via domain |
| `new-topic-sheet.tsx:235` | AI | `ai.jid` | AI JID (`GroupAi.jid`, `groups/schemas.ts:86-93`) | `ai.aiId` on the same row |
| `message-search-list.tsx:40` | chat/topic of a hit | `item.chatJid` | room JID or DM peer bare JID (`SearchItem.chatJid`, contract `search.ts:42-51`) | the chat row (`byId.get(item.chatJid)`, `message-search-list.tsx:202`); `chat.groupId` on topics |
| `message-search-list.tsx:196` | same (group header) | `group.chatJid` | same as above | same as above |
| `group-roles-sheet.tsx:124,290` | person (member) | `member.userId` | user id | bare JID only via domain |
| `ai-actions-sheet.tsx:51` | AI | `ai.id` | AI id (`PublicAi.id`, contract `ais.ts:115-131`) | `ai.jid` on the same object |
| `ai-row.tsx:35` | AI | `ai.id` | AI id (same) | `ai.jid` on the same object |
| `contacts/profile-card.tsx:80` | person | `profile.userId` | user id (`HandleProfile`, contract `contact-requests.ts:92-98`) | contact JID via the store contact (`ContactProfileRow.tsx:136`; mobile contact has `jid`, contract `contacts.ts:12`) |
| `(tabs)/settings.tsx:86` | person (self) | `profile?.id ?? me?.id ?? 'me'` | user id, or the literal `'me'` fallback | own JID as in profile-view |
| `explore.tsx:279` | group/channel | `item.id` | group id (`DirectoryEntry.id`, contract `directory.ts:24-35`) | `item.handle`; the General room JID only after joining (needs `groupIdForChat`/detail) |
| `at/[handle].tsx:181` | group/channel | `view.entry.id` | group id (same, entry from `lookupGroupByHandle`, `at/[handle].tsx:72`) | same as above |
| `settings/requests.tsx:231` | person | `request.other.userId` | user id (`ContactRequestPerson`, `contacts-api.ts:30-35`) | bare JID only via domain |
| `settings/blocked.tsx:185` | person | `person.userId` | user id (`BlockedPerson`, `contacts-api.ts:64-70`) | `person.jid` is ON the row (nullable, same lines) |
| `channel-screen.tsx:189` | channel feed (= General topic) | `feedId` | General room JID (`feed.id`, `group/[id].tsx:202-203`) | `groupId` (the screen holds it, `channel-screen.tsx:50-58`) |
| `settings/avatar-control.tsx:156` | person (self) | `ownerId` | user id (passed `profile.id`, `settings/profile.tsx:69-71`) | same as profile-view |

### Web — `Avatar` call sites

| File:line | Draws | Seed | What the seed is | Also available |
|---|---|---|---|---|
| `ChatListItem.tsx:90-97` | DM / AI / legacy group | `chat.id` | DM: peer bare JID; topic: room JID (`chat-rows.ts:60`; web matches `chat.id === contact.jid`, `PeopleSearchResult.tsx:90`) | `chat.groupId` on topics (`types.ts:175-176`) |
| `ChatHeader.tsx:150-157` | same chat | `chat.id` | same as above | same as above |
| `MessageBubble.tsx:182,243` | group sender | `message.senderId` | real bare JID else occupant JID (see §3) | same limits as mobile |
| `MentionPicker.tsx:50` | member / AI | `member.jid` | bare JID / AI JID (`groupMembers.ts:28-40`) | `userId` NOT in `MentionMember` |
| `PeopleSearchResult.tsx:103` | person | `entry.userId` | user id (`HandleProfile`, contract `contact-requests.ts:92-98`; comment: "The lookup profile carries no JID", `PeopleSearchResult.tsx:82-84`) | `contact.jid` from the store contact (same lines) |
| `PeopleSearchResult.tsx:123` | group | `entry.id` | group id (`DirectoryEntry`, contract `directory.ts:24-35`) | `entry.handle`; room JID only after join |
| `TopicRow.tsx:246` (`GroupHeaderRow`) | group | `groupId` prop | group id (`ChatGroup.groupId`, `chatGroups.ts:10-18`; passed `group.groupId`, `ChatListBody.tsx:127-131`) | first topic row's id = a room JID (`matching[0]`, `chatGroups.ts:75-80`); General room JID via the same find as `TopicRow.tsx:209` |
| `GroupPanel.tsx:150` | topic (panel opened for a topic row) | `chat.id` | topic room JID (`ChatView.tsx:236` passes the topic `chat`) | `chat.groupId` on the row |
| `MessageSearchResults.tsx:178` | chat/topic of a hit group | `group.chatJid` | room JID / DM bare JID (contract `search.ts:42-51`) | chat row via `chats.find(entry.id === item.chatJid)` (`MessageSearchResult.tsx:68`); `chat.groupId` on topics |
| `MessageSearchResult.tsx:79-85` | chat/topic of a hit | `item.chatJid` | same as above | same as above (`chat?.avatarUrl`, `chat?.isAI` already read there) |
| `AvatarUploader.tsx:203` | owner of the picture form | `ownerId` | user id / AI id / group id depending on `kind` (callers: `user.id`, `ProfileSettingsSection.tsx:58-62`; `ai.id`, `AiPictureSection.tsx:15-19`; `groupId`, `GroupPictureSection.tsx:27-31`) | the matching JID/room JID is NOT passed — only the id |
| `NewMessageDialog.tsx:146-149` | person (contact) | `contact.userId` | user id (Contact) | `contact.jid` on the same row |
| `ForwardPicker.tsx:117-123` | DM / AI / topic target | `chat.id` | DM: peer bare JID; topic: room JID | `chat.groupId` on topics |
| `NewGroupDialog.tsx:195-200` | person (contact) | `contact.userId` | user id | `contact.jid` on the same row |
| `AiPanel.tsx:217-223` | AI (or its chat) | `ai?.id ?? chat.id` | AI id, else the AI chat's id = AI JID (DM id is the peer bare JID) | `ai.jid` when `ai` is loaded; `chat.id` IS the AI JID in the fallback |
| `BlockedPage.tsx:106-111` | person | `person.userId` | user id (`BlockedPerson`, contract `blocks.ts:14-22`) | `person.jid` is ON the row (nullable) |
| `AisPage.tsx:181` | AI | `ai.id` | AI id (`PublicAi`) | `ai.jid` on the same object |
| `panels/TopicActionButtons.tsx:76` | person (member) | `member.userId` | user id (detail member; `GroupPanel.tsx:197` builds `{ userId: member.userId, ... }`) | bare JID only via domain |
| `panels/TopicActionButtons.tsx:142` | AI (picker) | `ai.jid` | AI JID (`PublicAi.jid`; `AddAiButton` takes `PublicAi`, `TopicActionButtons.tsx:118-125`) | `ai.id` on the same object |
| `panels/GroupAiRowView.tsx:37` | AI | `ai.jid` | AI JID (`GroupAi.jid`, `groups/schemas.ts:86-93`) | `ai.aiId` on the same row |
| `panels/GroupAiSection.tsx:204` | AI | `ai.jid` | AI JID (same) | `ai.aiId` on the same row |
| `panels/TopicAisSection.tsx:64` | AI | `ai.id` | AI id (`TopicAi.id`, contract `topics.ts:164-166`) | AI JID NOT in `TopicAi`; group detail `ais[].jid` has it when loaded |
| `panels/TopicMembersSection.tsx:77-82` | person | `member.userId` | user id (`TopicMember`, contract `topics.ts:211`) | bare JID only via domain |
| `GroupMembersSection.tsx:124-129,285-290` | person | `member.userId` / `contact.userId` | user id (`GroupMember`, contract `packages/api-contract/src/groups.ts:91-101`; Contact) | bare JID only via domain; contact has `jid` |
| `panels/GroupRolesSection.tsx:234-239` | person | `member.userId` | user id | bare JID only via domain |
| `NewTopicDialog.tsx:267-272` | person | `member.userId` | user id | bare JID only via domain |
| `NewTopicDialog.tsx:300` | AI | `ai.jid` | AI JID (`PublicAi`; filtered by `item.aiId === ai.id`, `NewTopicDialog.tsx:103`) | `ai.id` on the same object |
| `ContactProfileRow.tsx:153-158` | person | `profile.userId` | user id (`HandleProfile`; comment: "the lookup profile carries no JID", `ContactProfileRow.tsx:132-136`) | `contact.jid` from the store contact (same lines) |
| `ChannelPanel.tsx:286-292` | AI (picker) | `ai.jid` | AI JID (`GroupAi`) | `ai.aiId` on the same row |
| `panels/ChannelAdminsSection.tsx:54,102` | person | `member.userId` | user id (`GroupMember`) | bare JID only via domain |
| `panels/TopicHeader.tsx:28` | topic | `chat.id` | topic room JID | `chat.groupId` on the row |
| `panels/ChannelHeader.tsx:18` | channel feed | `chat.id` | General room JID | `chat.groupId` on the row |
| `routes/GroupHandleRoute.tsx:228` | group/channel | `entry.id` | group id (`DirectoryEntry`) | `entry.handle`; room JID only after join |
| `ExplorePage.tsx:240` | group/channel | `entry.id` | group id (same) | same as above |
| `Avatar.fixture.tsx:7-13` | fixture only | literals | n/a | n/a |

## 3. Per kind: is there one id every call site can reach?

### People: YES — the bare JID lowercased

For incoming messages, a group message's `senderId` is the member's real
bare JID, not the occupant JID, whenever resolution succeeds. For
outgoing messages it is NOT a JID at all:

- `senderId: message.outgoing ? meId : message.fromJid`
  (`packages/client-core/src/store/ledger-incoming.ts:121`), where
  `meId` is `currentUserId = input.me.id` — the Better Auth user id
  (`apps/mobile/src/store/effects/lifecycle.ts:142`; `Me.id`,
  `apps/mobile/src/lib/auth-api.ts:8-12`), never a JID.
- Harmless today only because every sender avatar renders exclusively
  for incoming group messages: mobile `showAvatar = isGroup &&
  !outgoing && isLastInGroup` (`message-bubble.tsx:200`,
  `message-bubble-tombstone.tsx:19`); web `{!own && chat.kind ===
  'group' && ...}` (`MessageBubble.tsx:179,240`). But an own-avatar
  seeded from an outgoing `senderId` would draw the user-id ball —
  exactly the bug class audited here — so the person rule (§4) means
  the bare JID explicitly, never "senderId as-is".
- `fromJid` comes from `resolveSender`, called at
  (`packages/xmpp-core/src/stanza/decode.ts:39`) and assigned into
  `fromJid` at `decode.ts:83,130,148`, which prefers, in order:
  the JID carried by the message, the occupant-id against the roster, the
  nick against the roster — and only then falls back to the full occupant
  JID `roomJid/nick` with `resolved: false`
  (`packages/xmpp-core/src/stanza/resolve-sender.ts:27-88`).
- Every resolved branch returns `bareJid(...)` (lines 40, 44, 49, 62, 73);
  the roster path itself keys occupants by `roomJid/nick` and stores
  `realJid = bareJid(itemJid)` (`parse-presence.ts:45-55`). So a resolved
  group `senderId` IS the sender's bare JID; an unresolved one is the
  occupant JID `room/nick` (`resolve-sender.ts:82-87`).
- Note: `bareJid` here does NOT lowercase
  (`packages/protocol/src/jid.ts:6-9`); the lowercasing helper is
  `normalizeJid` (`protocol/jid.ts:26-28`), and the server compares
  bare-and-lowercased (`apps/server/src/jid.ts:5-8`).

Reachability per person call site:

- Already bare JID: every DM `chat.id`, every `message.senderId`
  (resolved), every `MentionPicker` `member.jid`, every `Contact.jid`.
- User id only, JID derivable WITHOUT a new request: anywhere the XMPP
  domain is in scope, `jidFor(localpartFor(userId), domain)` rebuilds it
  (provisioning `provisioning.ts:29-38`; used exactly this way for
  contacts, `apps/server/src/contacts/service.ts:108`). The mention
  builder already does `jid = localpart@domain`
  (`groupMembers.ts:28-36`). Caveat: the `u<hash>` fallback ids
  (`provisioning.ts:29-35`) still round-trip through the same function,
  so the derived JID matches the DM `chat.id` as long as both sides use
  the same domain — but that must be verified per app (the mobile header
  comment at `chat-header.tsx:18-22` already relies on it).
- User id only, JID NOT derivable locally: none found — every user-id
  site runs inside an authenticated client that holds the domain
  (`XmppToken.domain`, `apps/mobile/src/lib/chat-api.ts:45-52`).
- The odd ones: `BlockedPage`/`blocked.tsx` carry `person.jid` (nullable)
  alongside `userId`, and `ContactProfileRow`/`profile-card` can read the
  store contact's `jid`. `settings.tsx:86` falls back to the literal
  `'me'` when neither profile nor session is loaded — that seed must go
  away regardless of the rule.

### AIs: YES — the AI JID (`ai-<aiId>@<domain>`), lowercased

- Every AI row that shows a ball carries its JID already (`PublicAi.jid`,
  `GroupAi.jid`), or can read it from the same object (`ai-row`,
  `ai-actions-sheet`, `AisPage`, `AiPanel`, all AI pickers).
- Two exceptions carry only the AI id: `TopicAisSection.tsx:64`
  (`TopicAi` has no `jid`, `topics/access.ts:68-71`) and mobile
  `topic-info-sheet.tsx:170`. Both render inside a topic whose group
  detail (with `ais[].jid`, `groups/schemas.ts:86-93`) is usually loaded;
  when it is not, the JID needs one group-detail load — or the server
  adds `jid` to `TopicAiView`.
- `AiPanel.tsx:218` (`ai?.id ?? chat.id`) already falls back to the chat
  id, which for an AI DM IS the AI JID.

### Groups/channels/topics: YES — the General topic's room JID

- A group has no JID of its own: the `groups` row has `room_localpart`
  (`groups/schemas.ts:95-109`) but no client call site sees it. The only
  stable, everywhere-visible group identity is the General topic's room
  JID: it IS the group's old chat id
  (`packages/chat-core/src/types.ts:117-120`), it keys the pin stamp
  (`chatGroups.ts:88-94`), and both apps already resolve it the same way
  (`topics.find(isGeneral) ?? topics[0]`, web `TopicRow.tsx:209`,
  mobile `group/[id].tsx:78-81`).
- Reachability: every topic row carries `groupId`, and the group→topics
  lookup exists on both apps (`topicsOfGroup(chats, groupId)` mobile,
  `byGroup` map web `chatGroups.ts:37-60`). So any `groupId`-seeded site
  (both `GroupListItem`s, both directory/explore lists, both
  `@handle` cards) can reach the General room JID once the group's
  topics are loaded — which they are on any screen that lists groups.
  Before any topic loads (cold explore list), only the group id is
  available; the seed would need the topics or the detail first.
- Topic rows and channel feeds already use room JIDs (`chat.id`), so
  they do not change under this rule — the group rows change TO the
  General room JID, unifying group and topic seeds.

## 4. Proposed rule (one seed per kind)

Normalize every seed with `normalizeJid` (bare + lowercase,
`packages/protocol/src/jid.ts:26-28`) before drawing, then:

1. **Person → their bare JID lowercased** (`normalizeJid(jid)`).
2. **AI → its AI JID lowercased** (`normalizeJid(aiJid)`).
3. **Group, channel, or topic → the General topic's room JID**
   (for a topic row, its own room JID is already that family's seed;
   for the group's header rows, the General topic's room JID).

Why this rule and not user-id or group-id:

- DMs already ARE bare JIDs, senders already ARE bare JIDs (resolved),
  mentions already ARE bare JIDs — the person rule changes the FEWEST
  sites (only the user-id pockets) and matches what the message pipeline
  already produces.
- AI JIDs are stable across renames (the id is in the localpart,
  `seed.ts:62-63`) and already sit next to every AI id.
- The General room JID is the only group identity visible on both apps
  today without a new request; the group UUID never appears on the wire
  as a JID and no chat row is keyed by it.

### Call sites that would change

**Person: user id → bare JID (12 sites; all need `localpart@domain`,
no new request where the domain is in scope):**

- mobile `profile-view.tsx:113`, `floating-tab-bar.tsx:93`,
  `(tabs)/settings.tsx:86` (also kills the `'me'` fallback),
  `settings/avatar-control.tsx:156` (via `profile.id`),
  `topic-info-sheet.tsx:155`, `channel-members.tsx:40`,
  `new-group-sheet.tsx:217`, `new-topic-sheet.tsx:205`,
  `group-roles-sheet.tsx:124,290`, `contacts/profile-card.tsx:80`,
  `settings/requests.tsx:231`, `settings/blocked.tsx:185` (or use the
  `person.jid` already on the row when non-null)
- web `PeopleSearchResult.tsx:103`, `NewMessageDialog.tsx:146-149`,
  `NewGroupDialog.tsx:195-200`, `ContactProfileRow.tsx:153-158`,
  `panels/TopicActionButtons.tsx:76`,
  `panels/TopicMembersSection.tsx:77-82`,
  `GroupMembersSection.tsx:124-129,285-290`,
  `panels/GroupRolesSection.tsx:234-239`,
  `NewTopicDialog.tsx:267-272`,
  `panels/ChannelAdminsSection.tsx:54,102`,
  `BlockedPage.tsx:106-111` (or use `person.jid` when non-null),
  `AvatarUploader.tsx:203` when `kind="user"` (pass the JID or derive
  from `ownerId` + domain)

**AI: AI id → AI JID (5 sites; JID on the same object except the two
noted):**

- mobile `ai-actions-sheet.tsx:51`, `ai-row.tsx:35`,
  `topic-info-sheet.tsx:170` (needs group detail `ais[].jid` or a
  `TopicAi.jid` addition)
- web `AisPage.tsx:181`, `AiPanel.tsx:217-223` (drop the `?? chat.id`
  split: pass the JID), `panels/TopicAisSection.tsx:64` (same detail
  need as mobile), `AvatarUploader.tsx:203` when `kind="ai"`

**Group: group id → General room JID (6 sites; needs the group's topics
loaded, which list screens already have):**

- mobile `group-list-item.tsx:96`, `explore.tsx:279`,
  `at/[handle].tsx:181`
- web `TopicRow.tsx:246`, `ExplorePage.tsx:240`,
  `routes/GroupHandleRoute.tsx:228`, `PeopleSearchResult.tsx:123`
- mobile `group-header.tsx:39` and `channel-screen.tsx:189` already use
  room JIDs — no change; `AvatarUploader.tsx:203` when `kind="group"`
  needs the General room JID instead of the group id.

### Sites where the rule's id is NOT available today

- `TopicAisSection.tsx:64` (web) and `topic-info-sheet.tsx:170`
  (mobile): only the AI id is in scope; the AI JID needs the group
  detail (`ais[].jid`) or a server change adding `jid` to `TopicAiView`
  (`apps/server/src/topics/access.ts:68-71`).
- Cold directory/explore lists (`ExplorePage`, mobile `explore.tsx`,
  both `@handle` cards): only the group id + handle are in scope; the
  General room JID needs the group's topics (one list/detail load) or a
  server change adding the General room JID to `DirectoryEntry`
  (contract `directory.ts:24-35`).
- `MentionMember` (`types.ts:37-43`) has no `userId`: the reverse
  direction (JID → user id) needs the detail. The proposed rule goes the
  other way (user id → JID), so this is fine — noted only so a future
  task does not assume the member row has both.
- Unresolved senders (`resolved: false`, `resolve-sender.ts:82-87`):
  `senderId` is the occupant JID `room/nick`, which normalizes to a
  DIFFERENT seed than the same person's bare JID. The rule cannot fix
  that client-side; it needs the roster/detail loaded so resolution
  succeeds (the common case), and the audit flags it: a sender whose
  detail never loads keeps a different ball.
- Case: `bareJid` does not lowercase (`protocol/jid.ts:6-9`), and XMPP
  stanzas may carry mixed case (server `jid.ts:1-8` lowercases before
  comparing). Every seed MUST go through `normalizeJid`, or `Ana@…` and
  `ana@…` draw different balls.
