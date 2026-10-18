# Store phase 2 plan (T-2112, 2026-10-19)

Read-only plan for the phase 2 list in `docs/STORE_CORE_PLAN.md:427-433`: pins,
chat prefs, folders, groups, members, roles, settings, channels and topics in
`packages/client-core/src/store`. No code was changed. Line counts are `wc -l`
on branch `task/T-2112-store-phase2-plan`; every claim carries a `file:line`.

The app store effect files named in the task total 2,269 lines: web 1,192
(`apps/web/src/store/effects/`), phone 1,077 (`apps/mobile/src/store/effects/`);
core exports all five areas from `packages/client-core/src/store/index.ts:24-29`.

## 0. Bottom line

| Area | Core today | Left in the apps | Verdict | Task |
| --- | --- | --- | --- | --- |
| Pins | full lifecycle (`store/pins.ts:111-205`) | store adapters, cached pins, the permission rule | done except the rule; the rule has a phone bug | T2 |
| Chat prefs | optimistic write + rollback (`store/prefs.ts:36-59`) | the optimistic row, web's typed setters and backgrounds | small move, web already correct | T1 |
| Folders | sort + active fallback (`store/folders.ts:17-33`) | four one-line API writes in the UI (web) and the store (phone) | already shared; no task | — |
| Groups, members, settings, channels | detail load, change, create/leave/join (`store/groups.ts:30-107`, `store/group-actions.ts:164-235`) | the write-then-reload sequence in 10 web wrappers and 3 phone helpers; two join loops; two detail types | the real win | T3, T4 |
| Topics | routes and row repaint (`store/group-actions.ts:18-126`, `store/groups.ts:71-107`) | thin wrappers; one failure-refresh difference | done except one hook | T3 |
| Roles, invite links | HTTP shared in `client-core/src/groups-api.ts:40-60,102-132` | phone-only role cache and invite wrappers; web calls the API directly | no store state to share; no task | — |

Expected net saving: **about 260 lines** after the core additions (see §4).

## 1. Inventory

### 1.1 Pins

**Core.** `PinsApi` (`store/pins.ts:20-24`), `PinsStore` (`:31-37`),
`pinKindFor` (`:50-66`), `pinTextFor` (`:68-73`), `pinSnapshotFor` (`:75-84`),
`sanitizeMediaItems` (`:91-106`), `loadPins` (`:111-133`), `pinMessage`
(`:135-173`) and `unpinMessage` (`:175-205`). The optimistic insert, rollback,
fixed errors and the phone's removed-row echo are all here (`:151-203`).

**Web adds.** The state adapter `pinsStore` (`apps/web/src/store/effects/pins.ts:17-27`),
the best-effort refresh (`:30-34`), the pin/unpin wrappers (`:66-85`), the media
page (`:47-63`, unrelated to pins) and the player wiring (`apps/web/src/store/effects/chatActions.ts:152-155`).
The permission rule is `apps/web/src/store/realStore.ts:82-95`.

**Phone adds.** A map plus a revision counter and a sign-out epoch
(`apps/mobile/src/store/effects/pins.ts:53-57,80-94,169-174`), the cached-pin seed
(`:121-129`), the permission rule (`:96-113`), the action-level guard (`:133-141`)
and the same media sanitising with a native URL resolver (`:147-166`).

**Differences.**

- **Real difference, web is right: channels cannot pin on the phone.** Web allows
  any group owner/admin (`apps/web/src/store/realStore.ts:89-94`); phone also
  requires a topic row with a `groupId` (`apps/mobile/src/store/effects/pins.ts:106-109`).
  A channel row has no topic (`packages/client-core/src/store/chat-rows.ts:146-150`),
  and the server treats a channel General as a topic whose owner/admins may pin
  (`apps/server/src/pins/access.ts:75-95`). So the phone hides a legal action.
- **Real difference, phone is right for defence: only the phone checks permission
  again in the action** (`apps/mobile/src/store/effects/pins.ts:136-138`); web
  only hides the menu (`apps/web/src/components/message/bubbleFlags.ts:95,120`).
  The server rejects either way (`apps/server/src/pins/access.ts:95`).
- **Same behaviour, different code: storage and session.** Web keeps pins in the
  store state (`apps/web/src/store/effects/pins.ts:19-26`); phone keeps maps plus
  an epoch and seeds cached pins (`apps/mobile/src/store/effects/pins.ts:53-57,121-129`).
  This follows each store's model and must not move into core.

### 1.2 Chat prefs

**Core.** `PrefsApi` (`store/prefs.ts:8-10`), `PrefsStore` (`:12-17`),
`withPrefRow` (`:22-29`) and `updatePref` (`:36-59`). The rollback re-paints the
saved rows, so a background write that landed mid-flight survives (`:31-35,52-58`).

**Web adds.** `optimisticRow` (`apps/web/src/store/effects/prefs.ts:18-48`), the
adapter with badge sync (`:50-63`), `applyPrefs` (`:69-73`), reloads
(`:76-97`), the typed setters (`:109-166`) and the web-only default background
(`:169-204`). All setters funnel into core `updatePref` (`:99-107`).

**Phone adds.** One generic `setChatPref` (`apps/mobile/src/store/effects/events.ts:129-138`),
the same adapter (`:103-112`), `markChatRead` (`:139-150`) and
`optimisticPrefRow` in `apps/mobile/src/lib/chat-prefs.ts:23-44`. The state reset
in `apps/mobile/src/store/effects/user-state.ts:51-72` is user state, not prefs.

**Differences.**

- **Real difference, web is right: the two optimistic rows disagree on the
  background columns.** Web keeps `backgroundPreset`, `backgroundImageId` and
  `backgroundDim` from the saved row (`apps/web/src/store/effects/prefs.ts:36-45`);
  phone rebuilds only five fields (`apps/mobile/src/lib/chat-prefs.ts:30-43`).
  Phone has no background UI (no `backgroundPreset` under `apps/mobile/src`), so
  nothing visible breaks today, but the shared rule should be web's.
- **Same behaviour, different code: web has typed setters, phone one generic
  setter** (`apps/web/src/store/effects/prefs.ts:109-166` vs
  `apps/mobile/src/store/effects/events.ts:129-138`); web's default background
  (`apps/web/src/store/effects/prefs.ts:169-204`) has no phone screen.
- **Real difference, web is right: web can reload prefs on demand**
  (`apps/web/src/store/effects/prefs.ts:76-85`); phone loads them only at boot
  (`apps/mobile/src/store/effects/history.ts:45-54`). A pref changed on another
  device reaches the phone only after a restart. Fixing it adds a request, not
  lines, so it is not in this phase; record it as a follow-up.

### 1.3 Folders

**Core.** `FoldersPatch` and `FoldersAccess` (`store/folders.ts:5-13`),
`foldersAfterSet` (`:17-29`) and `setFolders` (`:31-33`): sort by position, keep
the active id while it exists, otherwise reset to `all`.

**Web adds.** The store action (`apps/web/src/store/effects/chatActions.ts:223-227`),
the list sync on focus (`apps/web/src/lib/useChatFolders.ts:13-18`), the reorder
with a rollback (`apps/web/src/routes/FoldersPage.tsx:39-43`) and create/update/
delete in the editor (`apps/web/src/components/FolderEditorDialog.tsx:57-86`).

**Phone adds.** The shared `setFolders` (`apps/mobile/src/store/effects/events.ts:151-159`),
the boot load (`apps/mobile/src/store/effects/history.ts:56-67`) and the four API
writes (`apps/mobile/src/store/effects/events.ts:160-189`).

**Differences.**

- **Same behaviour, different code: the writes are four call-then-set pairs in
  both apps** (`apps/web/src/components/FolderEditorDialog.tsx:57-86` vs
  `apps/mobile/src/store/effects/events.ts:160-189`). The HTTP shapes are already
  shared (`client-core/src/chats-api.ts:163-193`); there is no duplicated decision.
- **Real difference, web is right: web reorders optimistically and rolls back**
  (`apps/web/src/routes/FoldersPage.tsx:39-43`); phone waits for the server
  (`apps/mobile/src/store/effects/events.ts:183-188`). Same end state, better
  feedback on web.
- **Verdict: no task.** Moving the writes would add a core adapter and four web
  store actions for a net zero or a small loss (folders are 33 core lines).

### 1.4 Groups, members, roles, settings and channels

**Core.** `GroupsApi`/`GroupDetailStore`/`ensureGroupDetail`
(`store/groups.ts:9-56`), `TopicRowStore`/`applyTopicRow` (`:58-107`), `topicIdFor`
(`store/group-actions.ts:18-32`), `changeTopic` (`:34-47`), `createTopic`
(`:60-83`), `leaveTopic` (`:100-126`), `leaveChannel` (`:134-148`),
`changeGroup` (`:164-185`), `createGroupChannel` (`:201-216`), `joinPublicGroup`
(`:223-235`) and `createInvite` (`:239-246`).

**Web adds.** `groupSettings.ts` (217 lines: leave, members, owner transfer, role,
settings, background, listener, visibility, join, AI), `groupCreate.ts` (142),
`groupMembers.ts` (151: detail apply, cache, ensure members, join),
`groupShared.ts` (65), `groupActions.ts` (140) and `topics.ts` (173). Key lines:
`groupSettings.ts:35-48,68-81,85-100,119-167`, `groupCreate.ts:24-64,78-136`,
`groupMembers.ts:20-52,95-115,127-151`.

**Phone adds.** `groups.ts` (280: caches, ensure detail/members, join, topic rows),
`group-actions.ts` (301: topics, invites, create/leave/transfer/delete),
`group-membership-actions.ts` (47), `group-roles-actions.ts` (126) and
`group-settings-actions.ts` (35). Key lines: `groups.ts:94-118,165-210,212-254`,
`group-actions.ts:62-184,185-299`.

**Differences.**

- **Real difference, split verdict: every group write repeats "call, then reload".**
  Web runs it through `changeGroup` for ten routes
  (`apps/web/src/store/effects/groupSettings.ts:35-217`); phone hand-rolls it in
  two helper files (`group-membership-actions.ts:28-35`,
  `group-settings-actions.ts:26-32`) and four actions
  (`group-actions.ts:251-274,278-299`). Web applies the returned `GroupDetail`
  without a second GET (`groupSettings.ts:35-48`); phone always re-reads
  (`group-membership-actions.ts:31-33`). **Web is right for routes that return a
  detail** (`packages/api-contract/src/groups.ts:160-203`) and **phone is right
  for routes that return `void`** (`apps/mobile/src/lib/groups-api.ts:62`); the
  helper should make the reload optional, as `changeGroup` already does
  (`store/group-actions.ts:158,178-180`). The missing piece is a group-id target
  (`apps/mobile/src/store/effects/group-actions.ts:251-267`).
- **Real difference, web is right: the phone loads twice at boot.** Web's
  `joinGroups` loads members, which already fetches the detail through
  `ensureGroupDetail` (`groupMembers.ts:143-145,95-115`). Phone also forks
  `ensureGroupDetail` before `ensureGroupMembers` (`groups.ts:197-202`), the same
  GET deduplicated by the in-flight mark (`store/groups.ts:40-48`). Remove the fork.
- **Same behaviour, different code: two `GroupDetail` spellings and two member
  maps.** Phone narrows `handle: null` to absent and maps every response
  (`apps/mobile/src/lib/chat-api.ts:31-35,74-82,96-97`); web uses the contract
  type (`apps/web/src/lib/api/groups.ts:17-29`). Web builds mention members and
  AIs at `groupMembers.ts:20-52`; phone stores names at `helpers.ts:91-97` and
  builds mentions at `:100-130`. One shared mapper belongs in core.
- **Real difference, no change: roles live in different layers.** Phone caches
  roles in the store (`group-roles-actions.ts:47-125`, `groups.ts:121-162`); web
  calls the API from the component (`GroupRolesSection.tsx:4,42-80`). The HTTP
  calls are shared (`client-core/src/groups-api.ts:40-60`); a shared cache would
  add core state and save no web lines.
- **Real difference, phone is right but low value: create validation.** Phone
  trims and rejects an empty title or a description over 300 before the call
  (`group-actions.ts:189-205,218-229`); web sends raw values
  (`groupCreate.ts:89-99,120-128`). The server enforces it, so no task.
- **Invite links have no shared store state.** HTTP is shared
  (`client-core/src/groups-api.ts:102-132`); phone returns from thin actions
  (`group-actions.ts:171-184`), web calls from panels
  (`GroupPanel.tsx:101`, `ChannelPanel.tsx:112`). No task.
- **Channels are not a separate path.** Core `createGroupChannel`
  (`store/group-actions.ts:201-216`) and `leaveChannel` (`:134-148`) serve both;
  web wraps at `groupCreate.ts:78-107` and `groupSettings.ts:19-32`, phone at
  `group-actions.ts:185-213,238-250`.

### 1.5 Topics

**Core.** The routes and row repaint above: `topicIdFor`
(`store/group-actions.ts:18-32`), `changeTopic` (`:34-47`), `createTopic`
(`:60-83`), `leaveTopic` (`:100-126`) and `applyTopicRow` (`store/groups.ts:71-107`).

**Web adds.** `refreshGeneralTopic` (`apps/web/src/store/effects/topics.ts:20-32`,
web-only navigation helper), `createTopic` opening the row (`:34-55`), the quiet
archive marker in `patchTopic` (`:57-76`), AI/member/role wrappers (`:78-143`,
each 5-10 lines), `refreshTopicRow` (`:146-154`) and `leaveTopic` hooks (`:159-173`).
`removeTopicMember` does **not** refresh on failure (`:121-131`).

**Phone adds.** `createTopic` with fallback JID and role memo
(`apps/mobile/src/store/effects/group-actions.ts:62-78`), `patchTopic` role memo
(`:79-89`), `archiveTopic` (`:90-98`), the remaining wrappers (`:99-120`),
`leaveTopic` (`:122-149`), list/preview calls (`:150-170`) and
`removeTopicMember` through `failAfter` with a list refresh
(`group-actions.ts:121`, `groups.ts:245-254`).

**Differences.**

- **Real difference, phone is right: remove-topic-member refreshes after a
  failure.** Phone re-reads the list so a last seat whose removal archived the
  topic drops the row (`apps/mobile/src/store/effects/groups.ts:245-254`); web
  only does that inside `leaveTopic` (`apps/web/src/store/effects/topics.ts:159-173`).
  The refresh belongs in a core `changeTopic` failure hook; web can keep its
  narrower behaviour.
- **Real difference, both right for their platform: `createTopic` requires the
  row on web and falls back to the JID on phone** (`apps/web/src/store/effects/topics.ts:41-49`
  vs `apps/mobile/src/store/effects/group-actions.ts:62-73`). Web must open the
  row; phone may answer before the list catches up.
- **Same behaviour, different code: archive is a dedicated phone route
  (`group-actions.ts:90-98`) and a patch on web (`topics.ts:69-74`).** Both end at
  the same server effect (`apps/server/src/topics/api.ts:177,191-195`). Phone-only
  calls are topics member/role lists and previews (`group-actions.ts:150-170`,
  `group-roles-actions.ts:116-125`); web's `refreshGeneralTopic` (`topics.ts:20-32`)
  is its navigation helper. Neither is duplicated.

## 2. Tasks

Each task is 30–60 minutes, keeps the hot path untouched, and lists the full repo
paths it may edit. No new test is required: none changes auth, money or messages.

### T1 — Move the optimistic chat-pref row into core (40 min)

- **Core adds** `optimisticPrefRow<R extends ChatPrefRow>` in
  `packages/client-core/src/store/prefs.ts`: the five standard fields from
  `store/prefs.ts` plus an optional `extend` hook for web's background columns.
  `PrefsStore.optimisticRow` (`store/prefs.ts:16`) stays, so each app keeps its
  own read/paint.
- **Web shrinks** `apps/web/src/store/effects/prefs.ts:18-48` to a call with the
  background `extend`; the setters at `:109-166` are unchanged.
- **Phone shrinks** `apps/mobile/src/lib/chat-prefs.ts:23-44` to a call with no
  `extend`; `apps/mobile/src/store/effects/events.ts:110-111` changes its import.
- **Allowed files:** `packages/client-core/src/store/prefs.ts`,
  `apps/web/src/store/effects/prefs.ts`, `apps/mobile/src/lib/chat-prefs.ts`,
  `apps/mobile/src/store/effects/events.ts`.
- **Tests:** `apps/web/src/store/effects/history.test.ts:59-78` (a failed prefs
  read keeps the pinned row) and `apps/mobile/src/store/real-store.lifecycle.test.ts:188-230`
  (boot loads the prefs).
- **Estimate:** web −21, phone −18, core +19 → **−20 net**.

### T2 — Put the pin permission rule in core and fix channels (30 min)

- **Core adds** `canPinFor(chat, role)` in `packages/client-core/src/store/pins.ts`:
  a DM is always pin-able; otherwise the group owner/admin role decides. Drop
  the phone's extra topic/`groupId` gate, which wrongly excludes channels
  (`apps/mobile/src/store/effects/pins.ts:106-109`).
- **Web shrinks** `apps/web/src/store/realStore.ts:82-95` to the helper plus its
  role lookup.
- **Phone shrinks** `apps/mobile/src/store/effects/pins.ts:96-113` to the helper;
  the action guard at `:133-141` stays.
- **Allowed files:** `packages/client-core/src/store/pins.ts`,
  `apps/web/src/store/realStore.ts`, `apps/mobile/src/store/effects/pins.ts`.
- **Tests:** `packages/client-core/src/store/pins.test.ts:15-51` (media
  sanitising only; there is no permission test today) and
  `apps/mobile/src/store/real-store.lifecycle.test.ts:320-388` (pins clear and a
  late load after sign-out).
- **Estimate:** web −10, phone −16, core +14 → **−12 net**, plus the channel
  bug fix.

### T3 — One group write-then-reload path, and the topic failure hook (60 min)

- **Core extends** `packages/client-core/src/store/group-actions.ts`:
  `changeGroupForGroup(store, groupId, notAvailable, call, refresh)` for screens
  keyed by group id (`apps/mobile/src/store/effects/group-actions.ts:251-267`),
  reusing the optional `reloadDetail` that `changeGroup` already has
  (`store/group-actions.ts:158,178-180`), plus an optional `onFailure` effect on
  `changeTopic` (`:34-47`) for the phone's `removeTopicMember`
  (`apps/mobile/src/store/effects/groups.ts:245-254`).
- **Web shrinks** `apps/web/src/store/effects/groupSettings.ts:35-217`: one local
  helper builds the store adapter, and the ten routes become 2–4 lines each.
  `leaveChannel` (`:19-32`) and `joinPublicGroup` (`:171-185`) also use it.
- **Phone shrinks or deletes:**
  - delete `apps/mobile/src/store/effects/group-membership-actions.ts` (47 lines)
    and `apps/mobile/src/store/effects/group-settings-actions.ts` (35 lines), all
    of which repeat the same sequence;
  - shrink `apps/mobile/src/store/effects/group-actions.ts:251-274,278-299`
    (transfer, role change, delete, channel role) and use the new topic failure
    hook at `:121`;
  - shrink the wiring and helper removal in `apps/mobile/src/store/effects/groups.ts:245-277`.
- **Allowed files:** `packages/client-core/src/store/group-actions.ts`,
  `apps/web/src/store/effects/groupSettings.ts`,
  `apps/mobile/src/store/effects/group-actions.ts`,
  `apps/mobile/src/store/effects/group-membership-actions.ts`,
  `apps/mobile/src/store/effects/group-settings-actions.ts`,
  `apps/mobile/src/store/effects/groups.ts`.
- **Tests:** `apps/mobile/src/store/effects/group-actions.test.ts:74-102`
  (leave-topic 404 handling). There are no web group-write tests; the web mock
  screens below are the guard.
- **Estimate:** web −127, phone −129, core +70 → **−186 net**.

### T4 — One group detail type, member mapper and join loop (60 min)

- **Core extends** `packages/client-core/src/store/groups.ts` with
  `membersFor(detail, domain)` (the rule in `groupMembers.ts:20-52` and
  `helpers.ts:91-130`) and `ensureGroupMembers`/`joinGroups` over a small store
  adapter, using `JoinGroupsHooks` (`store/ctx.ts:61-65`); it accepts the contract
  `GroupDetail` so the phone can drop its mapped type.
- **Web shrinks** `apps/web/src/store/effects/groupMembers.ts:20-52,95-115,127-151`
  to its cache adapter and core calls; the loop and member construction go.
- **Phone shrinks** `apps/mobile/src/store/effects/groups.ts:165-210` (drop the
  extra eager detail fork, use core members and join), `helpers.ts:91-130`
  (use `membersFor`) and `apps/mobile/src/lib/chat-api.ts:31-35,74-82,96-97`
  (drop `toGroupDetail` and the narrowed types; keep null handling in the shared
  mapper).
- **Allowed files:** `packages/client-core/src/store/groups.ts`,
  `apps/web/src/store/effects/groupMembers.ts`,
  `apps/mobile/src/store/effects/groups.ts`,
  `apps/mobile/src/store/effects/helpers.ts`,
  `apps/mobile/src/lib/chat-api.ts`.
- **Tests:** `apps/mobile/src/store/real-store.lifecycle.test.ts:188-230`
  (boot), `apps/mobile/src/store/real-store.sign-out.test.ts:91-140` (user reset)
  and `apps/mobile/src/store/effects/group-actions.test.ts:74-102` (group rows).
  Group naming/membership has no direct unit test; the mock screens are the guard.
- **Estimate:** web −51, phone −76, core +70 → **−57 net**.

### Order and parallel groups

| Wave | Tasks | Why they cannot collide |
| --- | --- | --- |
| 1 | T1, T2, T3 | T1: prefs + mobile `events.ts`; T2: pins + web `realStore.ts`; T3: groups + mobile `groups.ts`. Disjoint file sets. |
| 2 | T4 | T4 and T3 both edit `apps/mobile/src/store/effects/groups.ts`; run T4 after T3 is merged. |

T1 and T2 are independent of T3, so a second worker can take either while T3 runs;
T4 waits, and no task edits a file another has open.

## 3. Risks and checks

**Hot path.** None of T1–T4 edits `packages/client-core/src/store/send*.ts`,
`ledger*.ts`, `incoming.ts`, `history.ts`, `prune.ts` or `send-failure.ts`, and
none changes an XMPP stanza. Pins and prefs paint the chat list beside messages,
but do not touch the ledger. T4 does change the boot join loop
(`apps/web/src/store/effects/lifecycle.ts:225-231`,
`apps/mobile/src/store/real-store.ts:250`); a bug there can leave rooms unjoined,
so it is the highest-risk task even though the message pipeline is untouched.

**What the lead must check by hand after each task.**

- **T1 (prefs):** web mock `?mock=1`, `/` row menu (mute, archive, pin, unread),
  `/c/:chatJid` mute/archive; phone `(tabs)/index` long-press, `chat/[id]` mute,
  then sign out and in to confirm the boot prefs.
- **T2 (pins):** web mock `/c/:chatJid` pin/unpin a DM, a topic and a **channel**
  message (the fixed case); phone `chat/[id]` pins on the same three, then sign
  out (pins must clear).
- **T3 (group writes):** web mock `/c/:chatJid` group panel: People (add/remove,
  owner transfer), Settings (members-can-create, visibility, background,
  listener), leave, create channel/group, join via Explore; phone `group/[id]`
  (members, roles, links, leave/delete), `chat/[id]` (leave topic), `group/new`
  (empty title, 301-character description), `topic-tools/[id]` (roles).
- **T4 (detail/boot):** web mock fresh load `/` and `/c/:chatJid`: mention names,
  group info, topic rows; send one group message and confirm it arrives. Phone
  fresh sign-in: `(tabs)/index`, `chat/[id]` mentions, `group/[id]` members, one
  group message. Run `pnpm phone:smoke` and the emulator screens at
  `(tabs)/index`, `chat/[id]`, `group/[id]`, `topic-tools/[id]`,
  `settings/folders`, `settings/folder/[id]`.

**Security.** No task adds a route, table or secret. Permission decisions stay on
the server (`apps/server/src/pins/access.ts:75-95`); the client only hides
controls. No audit or log line changes, and no SQL is in scope.

## 4. Total

| Task | Web | Phone | Core | Net |
| --- | --- | --- | --- | --- |
| T1 prefs | −21 | −18 | +19 | −20 |
| T2 pins | −10 | −16 | +14 | −12 |
| T3 group writes | −127 | −129 | +70 | −186 |
| T4 detail and join | −51 | −76 | +70 | −57 |
| **Phase 2** | **−209** | **−239** | **+173** | **−275** |

A conservative total is **about 260 lines net** after the four tasks, roughly 11%
of the 2,269 lines. T3 carries it: ten web wrappers and three phone helpers collapse.

What deliberately stays: the phone's role cache and invite wrappers, web's direct
role/invite calls, the phone's pin map/epoch, web's pin adapter and the web-only
default background. Moving those adds core state without deleting a second copy.

## 5. Decisions for the lead

1. **T3 request policy:** apply the returned detail for routes that answer
   `GroupDetail`, reload for routes that answer `void`
   (`apps/mobile/src/lib/groups-api.ts:62`); one GET per write.
2. **T4 boot policy:** drop the phone's eager `ensureGroupDetail` fork in
   `joinGroups` (`apps/mobile/src/store/effects/groups.ts:197-202`) because
   `ensureGroupMembers` loads the same detail. Confirm no screen reads a detail
   before the user opens the group; group info calls `ensureGroupDetail` itself.
3. **Roles and invite links stay:** the shared HTTP module is already the one
   copy, and there is no second store state to delete.
