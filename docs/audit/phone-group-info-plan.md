# Phone Group info — audit and plan (T-1542)

Facts only, each with `file:line`. Plan only: this task changes no code.
Board copy: `docs/design/mockups/group-info/` (README + `Phone.dc.html`, `Main.dc.html`).
Web reference: T-1494 (info pages), T-1508 (Leave/More/member rows), T-1519 (channel info).

## 1. The boards (phone)

`Phone.dc.html` (115 lines) is the phone twin of `Main.dc.html`; README lines 30-31 say the
phone root is "the same root page as web, full screen with a back key". Sections, in order:

- **Header** (`Phone.dc.html:26-30`): a back key (40x40, radius 12).
- **Identity** (`:32-36`): 96 px round picture, group name (22 px), `6 members`. AIs count as
  members (README:9, Julio 2026-10-15).
- **Four keys** (`:38-43`): Mute, Search, Add (members), More. Icon keys 40 px / radius 12.
- **People group** (`:46-62`): Members `6`, AIs `2`, Invite links `2`. Rows 48 px, 34 px tile,
  count in mono, chevron.
- **Content group** (`:64-90`): Shared media, Pinned messages `3`, Tools and routines `1 · 2`,
  Activity, Always allowed `0`.
- **Settings group** (`:92-98`): Settings.
- **Leave group** (`:100-103`): red row at the bottom.

Rules (README:42-49): no section headings inside the root lists, no hint paragraphs, a status is
an icon never a word, every row opens a page, counts come from data the panel already loads (a row
whose count isn't loaded shows no number), the red bottom row is Leave group (non-owners only), and
the owner deletes from More. **More** holds Group background (managers) and Delete group (owner);
a member with neither doesn't see the key. Web pages (README:7-28): Members (search, Add members,
Invite with a link, owner/admin as icons, role tags, Roles at the end), AIs, Invite links, Shared
media, Pinned messages, Tools and routines, Activity, Always allowed, Settings, plus the channel
board (`WebChannel`, `WebChannelSubscribers`) with `@handle`, subscriber count, description,
Admins/Subscribers/AIs/Invite links, Activity, Settings, Leave channel.

## 2. The phone today

Group topics screen: `apps/mobile/src/app/group/[id].tsx` (359 lines). Mount loads the group
detail (`:75-79`); a channel renders `ChannelScreen` instead (`:216-221`); the group view renders
`GroupHeader` (`:225-239`) over `GroupTopicList`. No info root, no Subscribers page.

- **Group header** `apps/mobile/src/components/chat/group-header.tsx` (66): back, avatar, title and
  a subtitle (`:36-50`), then three icon keys — Invite links (`:51-55`), Visibility (`:56-60`),
  Members and roles (`:61-63`). The subtitle is built by `topicsHeaderSubtitle`
  (`apps/mobile/src/lib/topics.ts:276-284`): "N members, N AIs, N topics" — AIs are shown
  **separately**, not counted as members.
- **Topic actions sheet** `apps/mobile/src/components/chat/topic-actions-sheet.tsx` (113):
  Pin/Unpin, Mute (durations + Unmute), Archive/Unarchive, and Archive topic for everyone for
  managers (`:68-110`).
- **New topic sheet** `apps/mobile/src/components/chat/new-topic-sheet.tsx` (273).
- **Invite links sheet** `apps/mobile/src/components/chat/invite-links-sheet.tsx` (378); wiring
  `use-group-invite-links.ts` (133).
- **Members/roles sheet** `apps/mobile/src/components/chat/group-roles-sheet.tsx` (338): every
  member with role chips (`:126-141`), a Roles section with CRUD/assign for managers
  (`:143-325`), then `GroupManageSection` (`:326-330`).
- **Manage section** `apps/mobile/src/components/chat/group-manage-section.tsx` (301): owner →
  Make owner + Delete group (typed name, `:212-261`); non-owner → Leave group (`:263-293`).
- **Visibility sheet** `apps/mobile/src/components/chat/visibility-sheet.tsx` (251); wiring
  `use-group-visibility.ts` (186).
- **Channel screen** `apps/mobile/src/components/chat/channel-screen.tsx` (257): title + megaphone,
  subscriber subtitle, description (`:170-181`), the Feed row (`:183-198`), then
  `ChannelMembers` (`:200-211`), then either Invite links (managers) or Leave channel (subscribers)
  (`:213-234`).
- **Channel members** `apps/mobile/src/components/chat/channel-members.tsx` (142): ADMINS (or
  SUBSCRIBERS for managers) with per-row Promote/Demote for the owner (`:91-140`). Wiring
  `use-channel-invites.ts` (147).

Member lists, invite links, roles, visibility, leave and delete all exist **but only inside
sheets** reached from the group header or the channel screen. There is no Search key on either
screen, and no per-group Shared media / Pinned messages / Tools / Activity / Always allowed
surface. Channel subscribers: the manager sees the audience from the detail (`channel-screen.tsx:145-153`);
a subscriber loads the admins slice (`:138-143`) — no standalone page.

## 3. Web reference (T-1494 / T-1508 / T-1519)

Hosts: `apps/web/src/components/GroupPanel.tsx` (359) and `ChannelPanel.tsx` (341) hold the `page`
state and switch the subpage; both refresh the detail on mount (`GroupPanel.tsx:152-154`).

- `group-info/GroupInfoRoot.tsx` (293): picture/name/`memberCount` + Mute/Search/Add/More, the three
  groups, `LeaveGroupRow`, `DeleteGroupDialog`. `memberCount = members.length + ais.length`
  (`GroupPanel.tsx:57-58`).
- `group-info/GroupInfoPage.tsx` (38): back + close + title shell, reused by the channel.
- `group-info/GroupExit.tsx` (180): red `LeaveGroupRow` (T-1508) and `DeleteGroupDialog`
  (typed name; reused with `noun="channel"`, `:89-105`).
- `group-info/MemberRow.tsx` (158): owner/admin as icons (`:69-78`), role tags (`:80-86`), ⋮ menu
  with Make owner / Remove (`:89-146`).
- `apps/web/src/components/GroupMembersSection.tsx` (175): search, Add members + Invite with a link
  rows for managers (`:104-117`), one rounded list of `MemberRow`.
- Channel: `channel-info/ChannelInfoRoot.tsx` (363) Mute/Search/Share/More + lists;
  `channel-info/ChannelPeople.tsx` (201) Admins page and Subscribers page with search and a ⋮ menu
  ("Make admin" / "Remove admin", `:164-198`); `channel-info/ChannelAisPage.tsx` (120).
- Pages behind rows: `panels/GroupAiSection.tsx` (210), `panels/GroupRolesSection.tsx` (266),
  `panels/GroupPictureSection.tsx` (39), `panels/GroupSettingSwitch.tsx` (148, topic setting +
  listener), `apps/web/src/components/VisibilitySection.tsx` (284),
  `apps/web/src/components/InviteLinksSection.tsx` (278),
  `apps/web/src/components/ais/AiActivity.tsx` (226, group scope `{groupId}`),
  `apps/web/src/components/approvals/AlwaysAllowedList.tsx` (239, group scope).

Data calls (web): `lib/api/groups.ts` — `getGroup`, `addGroupMembers` (`:196`),
`changeGroupMemberRole` (`:166`), `removeGroupMember` (`:176`), `transferGroupOwner` (`:182`),
`deleteGroup` (`:190`), `addGroupAi`/`removeGroupAi` (`:53`,`:57`), `setMembersCanCreateTopics`
(`:104`), `setGroupListener` (`:120`), `setGroupBackground` (`:140`), `setGroupVisibility` (`:310`),
`listGroupRoles`/`listGroupInviteLinks` (`:69`,`:232`). Plus `lib/tools.ts:30 listGroupToolDetails`,
`lib/tools.ts:92 listGroupRoutines`, `lib/api/ais.ts:258 listGroupApprovalRules`, and
`listAudit({groupId})` from `AiActivity.tsx:66`.

## 4. Data on the phone

The phone's derived contract client (`apps/mobile/src/lib/effect/api-client.ts:20`) exposes every
contract endpoint; a piece is "missing" only when no mobile module wraps it.

| Board piece | Phone today |
| --- | --- |
| Group detail (members, AIs, settings) | `store/effects/group-actions.ts:72` `ensureGroupDetail`; type `store/types-groups.ts:59-69` |
| Members list | `groupDetail.members` (`app/group/[id].tsx:96`) |
| AIs list | `groupDetail.ais` (`app/group/[id].tsx:97`) |
| Invite links | `lib/invite-links-api.ts:72`; store `types-groups.ts:103-113` |
| Roles | `lib/roles-api.ts:47`; store `types-groups.ts:179-198` |
| Mute | `lib/chat-prefs-api.ts:51` (`putPref`) via store `setChatPref` (`store/types.ts:217`, used by the topic sheet; no group/channel Mute key) |
| Shared media | `lib/media-api.ts:55,86` `listChatMedia` (chat-scoped) |
| Pinned messages | `lib/pins-api.ts:33,64` `listPins` (chat-scoped) |
| Tools and routines | `lib/tools-api.ts:114-116` AI-scoped only (`listForAi`) — **group scope missing** (contract `packages/api-contract/src/tools.ts:126`, `routines.ts:37`) |
| Activity | `lib/audit-api.ts:24-25,43` AI-scoped only — **group scope missing** (contract `audit.ts:14,58` takes `groupId`) |
| Always allowed | `lib/approvals-api.ts:153` `groupRules(groupId)` exists; **no per-group page** |
| Add members | **missing** (contract `groups.ts:197`; no `groups-api.ts` wrapper, no store action) |
| Remove member | `lib/groups-api.ts:57` exists; wired only for self-leave (`group-actions.ts:251`) — no store action for others |
| Add/remove group AI | **missing** (contract `groups.ts:206,211`; no wrapper/store action) |
| Group picture | **missing** (contract `groups.ts:84`; web `setGroupBackground` and `GroupPictureSection`) |
| Members can create topics | read-only (`app/group/[id].tsx:113`); **setter missing** |
| AI listener / eagerness | **missing** (detail carries `listener`, `groups.ts:124`; web `setGroupListener`) |
| Visibility | `lib/directory-api.ts:84-85`; `use-group-visibility.ts` |
| Search | message search exists (`lib/search-api.ts`, `use-message-search.ts`); no group-info Search key |
| Leave / Delete | `group-manage-section.tsx` over `leaveChannel` (`group-actions.ts:244`) and `deleteGroup` (`:272`) |
| Invite links / roles / visibility sheets | exist and can be reused as pages |

## 5. Gap table

| Board section | Phone today | What to build | Files |
| --- | --- | --- | --- |
| Header + identity | header shows members and AIs apart | Group info screen with back key; picture, name, `members + AIs` count | §6 T1 |
| Mute / Search / Add / More | none | 4 keys; Mute via `setChatPref`, Search opens message search, Add opens Members picker, More menu | §6 T1 |
| Members / AIs / Invite links rows | members+roles sheet; no AIs page; invite sheet | Rows open Members, AIs, Invite links pages | §6 T1/T2 |
| Members page | sheet list, no search/add/remove | search, Add members, Invite with a link, owner/admin icons, ⋮ Make owner/Remove | §6 T2 |
| AIs page | only topic AI add; no group AI page | list group AIs, add my AI, remove | §6 T2 |
| Shared media / Pinned / Tools / Activity / Always allowed | media+pins sheets on the chat; tools/activity AI-only; rules aggregated | one content page per row | §6 T3 |
| Settings | visibility sheet only | picture, Members can create topics, AI listener, visibility | §6 T4 |
| Leave group / Delete group | inside the members sheet | red Leave row; Delete in More | §6 T1 |
| Channel info + pages | `ChannelScreen` (info + admins, no root/pages) | channel root, Admins/Subscribers/AIs/links, content, settings, Leave/Delete | §6 T5/T6 |

## 6. Task list (phone, in order)

Every new/changed file stays under 400 lines. `apps/mobile/src/store/effects/group-actions.ts` is
already 393 lines, so T2 and T4 add their new effects in new files instead of growing it. Sizes are
estimates; split further if a file grows.

**T1 — Group info root and navigation** (~60 min). Board: header, identity, 4 keys, People/Content/
Settings rows, Leave, More.
- New: `apps/mobile/src/app/group-info/[id].tsx` (route + `page` state), `apps/mobile/src/components/group-info/root-page.tsx`, `apps/mobile/src/components/group-info/info-keys.tsx`, `apps/mobile/src/components/group-info/info-row.tsx`.
- Changed: `apps/mobile/src/components/chat/group-header.tsx` (add `onOpenInfo`; tap title opens the screen), `apps/mobile/src/app/group/[id].tsx` (wire the new prop, reuse the existing hooks/sheets).
- Depends: none. Reuses `GroupManageSection` (leave/delete) and `setChatPref`.

**T2 — Members and AIs pages** (~60 min). Board: Members page, AIs page, Add.
- New: `apps/mobile/src/components/group-info/members-page.tsx`, `apps/mobile/src/components/group-info/ais-page.tsx`, `apps/mobile/src/store/effects/group-membership-actions.ts`.
- Changed: `apps/mobile/src/lib/groups-api.ts` (wrap contract `addMembers`, `addAi`, `removeAi`; expose `removeGroupMember` for others), `apps/mobile/src/store/types-groups.ts`, `apps/mobile/src/store/effects/groups.ts` (compose the new membership actions; `group-actions.ts` is at 393, too close to grow).
- Depends: T1.

**T3 — Content pages** (~60 min). Board: Shared media, Pinned messages, Tools and routines, Activity, Always allowed.
- New: `apps/mobile/src/components/group-info/content-page.tsx` (switch), `apps/mobile/src/components/group-info/tools-page.tsx`, `apps/mobile/src/components/group-info/activity-page.tsx`.
- Changed: `apps/mobile/src/lib/tools-api.ts` (wrap `tools.listForGroup`, `routines.listForGroup`), `apps/mobile/src/lib/audit-api.ts` (accept `groupId`), plus store accessors if not already reachable; reuse `MediaSheet`/`PinsSheet` and the approvals `groupRules` read.
- Depends: T1.

**T4 — Settings page** (~60 min). Board: Settings (picture, "Members can create topics", AI listener, visibility).
- New: `apps/mobile/src/components/group-info/settings-page.tsx`, `apps/mobile/src/components/group-info/picture-section.tsx`, `apps/mobile/src/components/group-info/setting-switch.tsx`, `apps/mobile/src/store/effects/group-settings-actions.ts`.
- Changed: `apps/mobile/src/lib/groups-api.ts` (wrap `groups.patch` for picture/background, add groups for `membersCanCreateTopics` and listener — confirm exact contract ops), `apps/mobile/src/store/types-groups.ts`, `apps/mobile/src/store/effects/groups.ts` (compose the new settings actions; `group-actions.ts` is at 393, too close to grow).
- Depends: T1. Reuses `VisibilitySheet`.
- Open: the server accepts PNG/WebP for avatars but phone photos are JPEG (AGENTS.md) — re-encode first.

**T5 — Channel info root and People/AIs/Invite links** (~60 min). Board: channel header (`@handle`,
count, description), Mute/Search/Share/More, Admins/Subscribers/AIs/Invite links rows and pages,
Leave channel, Delete channel.
- New: `apps/mobile/src/app/channel-info/[id].tsx`, `apps/mobile/src/components/channel-info/root-page.tsx`, `apps/mobile/src/components/channel-info/people-page.tsx`, `apps/mobile/src/components/channel-info/ais-page.tsx`.
- Changed: `apps/mobile/src/app/group/[id].tsx:216-221` (the channel branch returns `ChannelScreen`) and/or `apps/mobile/src/components/chat/channel-screen.tsx` to open the new root; reuse `use-channel-invites` and `listChannelMembers`.
- Depends: T1/T2 (shares the shell and the AIs page shape).

**T6 — Channel content, settings, Leave/Delete** (~60 min). Board: Shared media, Pinned messages,
Activity, Settings, Leave channel, Delete channel.
- New: `apps/mobile/src/components/channel-info/content-page.tsx`, `apps/mobile/src/components/channel-info/settings-page.tsx`.
- Changed: reuse T3's content pieces and T1's `GroupManageSection` with a channel (Leave channel) contract; wire `DeleteGroupDialog`-equivalent for the owner.
- Depends: T3 and T5.

## 7. Open questions for the lead

1. **Entry point.** How does the user open Group info on the phone? The web opens it from the chat
   header. Proposed: tapping the group header's avatar/title opens the screen; the three existing
   header keys (Invite links, Visibility, Members and roles) either move into the pages or stay.
   The header board shows none of them as header keys, only the four Mute/Search/Add/More keys
   inside the info root. Please confirm: header tap vs a new key, and whether the three current
   keys move.
2. **Mute scope.** What does the group/channel Mute key mute on the phone? The phone's chats are
   the group's topics. Proposed: mute every topic of the group through `setChatPref`; confirm, or
   say whether a group-level mute exists server-side that the phone lacks.
3. **At least, "AIs count as members":** confirm the root count is `members + AIs` (web does this,
   `GroupPanel.tsx:57-58`) while the Members row keeps the people count and the AIs row its own.
4. **Counts the phone loads.** The root shows counts for Members, AIs, Invite links (managers),
   Pinned. Invite-link and pin counts are loaded per chat by the existing clients; confirm it is
   fine for the root to load them (extra requests) or to hide the number when not loaded, as the
   README allows (README:49).
5. **Channel entry point** likewise: from `ChannelScreen`; confirm the current `ChannelScreen`
   becomes the info root rather than staying as a separate view.
6. I could not find a phone group-background API or a group-level `membersCanCreateTopics` /
   listener setter; the shared contract has them (`packages/api-contract/src/groups.ts:84,124`).
   Confirm T4 should add those wrappers.
