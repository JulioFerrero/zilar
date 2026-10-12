# Social graph and permissions audit (2026-10-11)

Scope: contacts, contact requests, blocks, invites and sign-up, handles, people search,
presence, groups/channels/topics and their roles, joining and leaving, the public directory,
MUC affiliations on ejabberd, topic visibility, what each client lists and how changes
propagate. Code read today at `8f476be72`; nothing was run. Message delivery, read state and
push mechanics are in `docs/audit/message-pipeline-audit.md` and are not repeated here.

Severity: P0 security/privacy breach or data loss; P1 wrong state or behaviour users notice;
P2 degraded or edge. "confirmed" = traced in code; "suspected" = needs the runtime check named.

## 1. Summary

- SG-1 P0 both: a block is a database row only. The blocked person stays a contact on both
  sides, keeps the `both` roster subscription, keeps the DM in both chat lists, and every DM
  they send is delivered, shown and pushed. Only group messages are hidden, and only in the
  client. Confirmed.
- SG-2 P0 server: any user can DM any other user over XMPP without being a contact: the JID is
  the lower-cased user id, user ids are returned by people search and handle lookup, and
  ejabberd has no stranger or server-side block filter. The message is archived in the
  recipient's MAM and surfaces when a contact row appears later. Confirmed.
- SG-3 P1 server: a removed member keeps their affiliation in every topic room of the group
  when the best-effort topic sync fails; nothing re-syncs until the next membership change.
  Suspected (runtime check: kill ejabberd between the two calls).
- SG-4 P1 both: a group owner can neither leave, hand over nor delete a group; a group cannot
  be deleted at all. Confirmed.
- SG-5 P1 both: being removed from a group reaches the other devices only through the 60 s
  chat-list poll; the MUC kick (status 321) is not parsed, so the open room keeps a live
  "joined" state until then. Confirmed.
- SG-6 P1 both: nobody can remove a contact. There is no endpoint, no UI and no roster
  removal, so a block is the only way to stop a contact and it does not work (SG-1). Confirmed.
- SG-7 P2 server: people search enumerates every user with a handle by display-name prefix,
  10 rows per call, 120 calls per 10 minutes, and runs up to 4 relation queries per row.
  Confirmed.
- SG-8 P2 server: a blocked user can join the blocker's public group or invite link and a
  removed member can rejoin at once; groups have no ban list. Confirmed.
- SG-9 P2 server: the sign-up `before` hook burns an invite use even when the user insert
  fails afterwards. Confirmed.
- SG-10 P2 both: presence (online dot) is roster-driven and never withdrawn on block (part of
  SG-1); in non-anonymous public rooms every occupant sees every other occupant's real JID and
  availability. Confirmed, by design for groups, a gap for blocks.
- SG-11 P2 web: a DM from a stranger (SG-2) is held in `messagesByChat` with no chat row; the
  in-tab notification is skipped only because `chat === undefined`. Harmless today, fragile.
  Confirmed.

Not found (checked): private group/topic reads by non-members (every route 404s through
`getMembership` / `requireVisibleTopic`); public-directory leaks of private groups
(`g.visibility = 'public'` in every read); roster push spoofing (`parseRosterPush` trusts only
our domain); in-band room creation (`access_create: muc_create` = admin only); account deletion
(no `deleteUser` in `apps/server/src/auth/auth.ts`, and every social table cascades on user
delete: `apps/server/drizzle/0003_shocking_boom_boom.sql:34-41`,
`0035_handles-contact-requests.sql:32-37`, `0039_workable_sunspot.sql:9-10`).

## 2. Findings by sub-area

### 2.1 Blocks

**SG-1 (P0, both, confirmed) — blocking does not stop the blocked person.**

What `blockUser` does: inserts `user_blocks` and cancels pending requests
(`apps/server/src/blocks/service.ts:117-134`). It never touches `contacts`, never calls
`deleteRosterItem`, never sets an ejabberd block list.

What stays:

- Contact list and chat list on both sides: `listContacts` has no block filter
  (`apps/server/src/contacts/service.ts:78-85`), and `/api/chats` maps every contact to a DM
  row (`apps/server/src/chats/api.ts:77-110`).
- XMPP delivery: ejabberd routes any `chat` stanza between two local accounts; `mod_blocking`
  and `mod_privacy` are loaded (`deploy/ejabberd/ejabberd.yml:277,283`) but no client code
  ever sends a XEP-0191 list (no `urn:xmpp:blocking` anywhere in `packages/` or `apps/`).
- Rendering: web hides blocked senders only when `chat.kind === 'group'`
  (`apps/web/src/components/MessageList.tsx:76`), and the shared preview rule says "DMs and AI
  chats are never filtered" (`packages/chat-core/src/blocked.ts:27`); mobile is the same
  (`apps/mobile/src/lib/blocked-users.ts:107`).
- Push: the archive scan's DM scope is every contact (`apps/server/src/search/service.ts:91-94`,
  `108-113`), no block check, so a blocked contact's DM buzzes the phone.
- Presence: the `both` subscription stays, so the blocked person keeps the online dot
  (`packages/client-core/src/store/incoming.ts:243-255`).
- The blocked side sees no change at all: `relationFor(blocked -> blocker)` answers `contact`
  (`apps/server/src/contact-requests/reads.ts:88-90`) because the pair row is still there.

The only places a block applies: contact requests (`contact-requests/service.ts:97-104`),
request listing (`reads.ts:33-45`), handle lookup and search (`reads.ts:137-148`,
`search.ts:61-64`), group-message hiding in the two clients, and file/media listings
(`apps/server/src/files/api.ts:204`, `apps/server/src/media/api.ts:225`).

Repro: A and B are contacts. A blocks B. B opens the DM, sends "hi". A's web and phone show
"hi", A's phone gets a push, A's chat list still lists B, B sees A online.

Smallest fix (server, `apps/server/src/blocks/service.ts` plus a new
`apps/server/src/blocks/roster.ts` to stay under 400 lines):

1. In `blockUser`, after the insert: delete both `contacts` rows for the pair in the same
   transaction; after commit call `adminClient.deleteRosterItem` in both directions (best
   effort, log on failure). `unblockUser` leaves the pair gone: re-adding goes through a request.
2. Filter `listContacts` and the chat list with `NOT EXISTS (SELECT 1 FROM user_blocks ...)`
   in either direction as a belt-and-braces until the rows are gone.
3. Add the same either-direction block predicate to `allowedArchives`
   (`apps/server/src/search/service.ts:91`) so push and search skip a blocked peer.
4. Server-side delivery: the simplest real stop is `mod_block_strangers`-style behaviour from
   the roster: once the roster item is removed and no subscription exists, enable
   `mod_block_strangers: { drop: true, allow_local_users: false }` in both ejabberd configs.
   That also closes SG-2. (Runtime check: confirm the module ships in the deployed image;
   it is in stock ejabberd since 18.x.)

Tests: one in `blocks` (permissions area): block removes the pair and both roster calls fire.

**SG-8 (P2, server, confirmed) — no group ban and no block check on joins.**
`joinPublicGroup` (`apps/server/src/groups/join.ts:59-61`) and `joinByInviteLink`
(`apps/server/src/invite-links/join.ts:100-106`) check only visibility, link validity and the
cap. `removeGroupMember` deletes the row (`groups/members.ts:163-164`), so the removed person
can rejoin a public group or by a still-valid link at once; a blocked user can sit in the
blocker's public group. Telegram keeps a per-group ban list. Fix: a `group_bans` table
(hand-written migration), written by `removeGroupMember` when the actor is not the target,
checked by both joins (same 404 as private), with an admin "unban" via the existing member
route. Keep `members.ts` under 400 lines by putting the ban reads in `groups/bans.ts`.

### 2.2 Contacts, requests, roster

**SG-6 (P1, both, confirmed) — contacts cannot be removed.** The contacts contract has one
endpoint, `GET /contacts` (`packages/api-contract/src/contacts.ts:23`); there is no
`removeContact` anywhere in `apps/web/src`, `apps/mobile/src` or the contract. `syncRoster`
only adds (`contacts/service.ts:156-176`). Fix: `DELETE /contacts/:userId` that deletes both
rows and both roster items (same helper as SG-1 step 1), plus a menu item on web
(`ChatListMenu`) and mobile (`use-chat-actions`). Test in `contacts` (permissions): removing
deletes both directions.

Roster sync is sound otherwise: `add_rosteritem subs=both` on both sides, retried on every
token fetch (`apps/server/src/xmpp/api.ts:72-79`), nick refresh on rename
(`apps/server/src/auth/api.ts:165`), and the client refreshes the chat list on every trusted
roster push (`packages/client-core/src/store/lifecycle.ts:295`;
`packages/xmpp-core/src/stanza/parse-roster.ts:62-70`). An accepted request therefore shows on
every device of both users within one roster push. Incoming requests themselves have no
realtime channel: web polls the count every 60 s and on focus
(`apps/web/src/lib/useContactRequestCount.ts:10-13`), mobile only when the Requests screen is
opened. P2, acceptable.

Request state machine (`contact-requests/service.ts`) is well locked: sender advisory lock,
partial unique indexes as backstop, silent declines for blocked senders, idempotent accept
that repairs a half-finished pair. No finding.

### 2.3 Sign-up with an invite

**SG-9 (P2, server, confirmed).** `databaseHooks.user.create.before` runs `consumeInvite`
(`apps/server/src/auth/auth.ts:194-213`, `invites.ts:89-100` does `uses = uses + 1`) before
Better Auth inserts the user. A failed insert (duplicate email, DB error) keeps the use. With
`DEFAULT_INVITE_MAX_USES` small this locks an inviter out of a retry. Fix: move the consume to
the `after` hook and keep `findUsableInvite` in `before` (the middleware at `auth.ts:172`
already validates), or add a compensating `uses = uses - 1` on insert failure.

Inviter auto-contact is intended (known). `user_invites.invited_by` is recorded
(`contacts/service.ts:278-280`) and `setUpContactsFromInvite` is idempotent.

### 2.4 Handles and people search

**SG-7 (P2, server, confirmed) — enumeration and N+1.** `searchUsers` matches
`lower(u.name) LIKE 'xyz%'` and `'% xyz%'` over every user with a handle
(`apps/server/src/contact-requests/search.ts:65-69`), returns `userId`, `name`, `handle`,
`image` (`HandleProfile`, `packages/api-contract/src/contact-requests.ts:92-99`), 10 rows per
call, 120 calls per 10 minutes (`contact-requests/api.ts:52-53`). Three-letter prefixes walk
the whole user base in a few hours, and each row costs up to 4 extra queries in `relationFor`
(`search.ts:87`, `reads.ts:83-96`). Telegram searches strangers by username only. Fix: drop
the display-name clauses for non-contacts (keep them for the viewer's own contacts in a
`UNION`), compute relations in one query with three `LEFT JOIN`s, and consider returning the
`userId` only to the server-side flows that need it (see SG-2).

Handle claim, retire and the 14-day/30-day rules (`apps/server/src/handles/store.ts:151-266`,
`groups/visibility.ts:70-249`) are transactional under advisory locks with unique-violation
backstops; retired rows are reaped. No orphan found.

### 2.5 Presence and JIDs

**SG-2 (P0, server, confirmed) — stranger DMs.** `localpartFor` returns the lower-cased user
id whenever it matches `/^[a-z0-9._-]{1,64}$/` (`apps/server/src/xmpp/provisioning.ts:16,29-35`),
so `userId@domain` is every user's JID. User ids ship in search and handle results (SG-7), in
group member lists (`groups/queries.ts` member views) and in contact-request views. ejabberd's
c2s access is `allow: all` (`deploy/ejabberd/ejabberd.yml:88`), no `mod_block_strangers`,
no server-side privacy list, MAM `default: always` (`ejabberd.yml:229-232`). A stranger's
stanza is delivered to every online resource and archived.

Client behaviour: `handleMessage` adds it to `messagesByChat[chatJid]` but `chats.map` finds
no row (`packages/client-core/src/store/incoming.ts:140-151`); nothing is listed, and web's
in-tab notification bails on `chat === undefined` (`apps/web/src/lib/push/inTab.ts:44`), push
skips it (not in `dmPeers`). So today the harm is a hidden archive and wasted traffic, plus
the whole SG-1 path once the stranger is a contact-who-got-blocked. Harassment becomes
visible the moment the two become contacts: the MAM history loads with the old stranger
messages.

Fix: `mod_block_strangers` with `drop: true, log: false, allow_local_users: false,
allow_transports: true` in `deploy/ejabberd/ejabberd.yml` and `infra/ejabberd/ejabberd.yml`
(a message from a JID with no roster subscription is dropped before routing and archiving;
the push component and AI gateway accounts need an explicit roster item or the
`allow_transports` path, verify with the local compose). Alternative without ejabberd changes:
the client-core drops incoming `chat` messages whose bare sender is not a chat row
(`incoming.ts:140`), which hides but does not stop the archive write. Runtime check: send a
DM from a non-contact test user and read the recipient's MAM.

**SG-10 (P2, both, confirmed).** Contact presence is purely roster-driven
(`packages/xmpp-core/src/stanza/parse-presence.ts:63-74`); nothing in the client auto-approves
`subscribe` (types other than `unavailable` are ignored), so non-contacts cannot subscribe.
Rooms are created `anonymous: false` (`groups/service.ts:223-229`,
`ejabberd.yml:218-224`), so in a public group of up to 5000 strangers every occupant sees
every other's real JID and online/offline through occupant presence. Acceptable for groups
(Telegram shows members), but combined with SG-2 it is the stranger's address book. Closing
SG-2 makes this harmless; otherwise make public rooms `anonymous: true` with
`occupant-id` already parsed (`parse-presence.ts` `occupantId`).

### 2.6 Groups, channels, roles

**SG-4 (P1, both, confirmed) — owner is stuck.** `removeGroupMember` refuses an owner target
(`apps/server/src/groups/members.ts:135-137`), including self. `changeMemberRole` is channel-
only and never sets `owner` (`members.ts:256-263`, role schema `admin|member`). The groups
contract has no delete or transfer endpoint (`packages/api-contract/src/groups.ts:156-198`);
`destroyRoom` is only called on create rollback (`groups/queries.ts:332-341`,
`topics/service.ts:376`). Repro: create a group, try to leave: 403 "The owner cannot be
removed". Fix: `PUT /groups/:id/owner` (owner only, target must be a member) that swaps the
two `group_members.role` values in one transaction and sets both room affiliations, then
`syncChannelVoice` / `syncGroupTopicRooms`; and `DELETE /groups/:id` (owner only) that deletes
the row (cascades handle members, topics, handles) and destroys every topic room, including
retiring the handle. Keep the two in a new `groups/ownership.ts`.

**SG-3 (P1, server, suspected) — stale topic-room affiliations.** `removeGroupMember` sets
`none` on the General room inside the transaction (`members.ts:154-164`) but the other topic
rooms are synced afterwards by `syncGroupTopicRooms`, which swallows every failure
(`apps/server/src/groups/ais.ts:285-296`). If ejabberd is unreachable for that call the
removed person keeps `member` on every other topic room (members-only, MAM on) and can keep
reading and posting there from the still-open client until the next membership change of
that group re-runs the sync. The same shape applies to `addGroupMembers` (`members.ts:105`),
where the new member simply does not get the topic rooms (P2). Runtime check: stop ejabberd
after the General `set_room_affiliation`, restart, call `get_room_affiliations` on a topic
room. Fix: record the group id in a small `pending_room_syncs` table (or in-memory set with a
retry fiber) when `syncGroupTopicRooms` fails, and drain it on the next token fetch of any
member or on a 60 s timer; `syncTopicRoom` is idempotent (`topics/room-sync.ts:21-88`).

Affiliation model otherwise matches the database: owner/admin/member mapping per room kind
(`topics/room-members.ts:42-117`), stale `topic_members` rows for ex-members are ignored
(`room-members.ts:94-99`), removed users are set to `none` (`room-sync.ts:61-74`), AIs are
derived live (`topics/access.ts:291-315`). Channel voice stays consistent through
`assertChannelKeepsAnAdmin` and `syncChannelVoice`.

**SG-5 (P1, both, confirmed) — removal propagates slowly.** No code parses MUC status 321/307
(no match for `321`, `307` or `kick` in `packages/xmpp-core/src` or
`packages/client-core/src`); `parseMucPresence` only records an occupant leaving
(`xmpp-core/src/core-effect/presence.ts:70-77`). Other devices learn about a removal only
when `/api/chats` is re-read: on focus, every `TOPIC_REFRESH_INTERVAL_MS` = 60 s
(`packages/client-core/src/store/polling.ts:15,82-98`), or on a roster/invite push, and
`refreshChats` then keeps only server rows (`apps/web/src/store/effects/history.ts:117-122`).
Additions are faster because the direct invitation triggers `scheduleChatsRefresh`
(`lifecycle.ts:294`). Fix: in `parseMucPresence` detect a self-presence `unavailable` with
status 321 or 307 and emit a `removed` event; client-core drops the row and runs the existing
removed-while-open flow (`apps/web/src/store/effects/locals.ts:29`).

Role checks are correct: add/remove need owner/admin (`members.ts:35-37,132-134`), role
change is owner-only and answers 404 to everyone else (`members.ts:253-258`), visibility is
owner-only (`visibility.ts:93-97`), detail/members 404 for non-members
(`groups/api.ts:149-160`, `queries.ts:137-145`), channel subscribers never see the audience
(`api.ts:158-160`, `queries.ts:157-159`).

### 2.7 Topics

`canSeeTopic` (`apps/server/src/topics/access.ts:135-154`) requires group membership, not
archived, and for private topics a `topic_members` row or a role. Every topic route goes
through `requireVisibleTopic` or `requireManagedTopic`; the member list too
(`topics/queries.ts:57`). The chat list fetches topics per group after membership
(`chats/api.ts:154-163`). Private-to-public needs `confirmExposeHistory`
(`topics/service.ts:215-221`); public-to-private requires `memberIds` with the actor and
clears nothing it should keep. Going public clears members, role access and approver
(`service.ts:295-309`). Draining a private topic archives it (`topics/members.ts:211-234`).
No finding beyond SG-3 (room sync failure) and SG-5 (propagation): topic visibility changes
reach other devices through the same 60 s poll.

### 2.8 Public directory

Both reads filter `g.visibility = 'public'` (`apps/server/src/directory/service.ts:113,239`)
and private/unknown share one 404. Joining checks the cap under a per-group advisory lock
(`groups/join.ts:93-103`). Only SG-8 applies.

## 3. Fix plan

| # | Task | Closes | Files |
| - | ---- | ------ | ----- |
| 1 | Block really blocks: delete the pair and both roster items on block, filter contacts, chat list and `allowedArchives` by either-direction block; one permissions test | SG-1, part of SG-10 | `apps/server/src/blocks/service.ts`, new `apps/server/src/blocks/roster.ts`, `apps/server/src/contacts/service.ts`, `apps/server/src/search/service.ts`, `apps/server/src/blocks/blocks.test.ts` |
| 2 | Drop stranger stanzas at ejabberd: `mod_block_strangers` in both configs, verified against the push component and AI gateway on the local compose | SG-2, SG-10, SG-11 | `deploy/ejabberd/ejabberd.yml`, `infra/ejabberd/ejabberd.yml`, `docs/LEAD_HANDOFF.md` (note) |
| 3 | Remove contact: `DELETE /contacts/:userId` (both rows, both roster items, reuses task 1's helper) + menu entry on web and mobile | SG-6 | `packages/api-contract/src/contacts.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/contacts/service.ts`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts` |
| 4 | Owner transfer and group delete endpoints, with UI on the group detail screens | SG-4 | new `apps/server/src/groups/ownership.ts`, `apps/server/src/groups/api.ts`, `packages/api-contract/src/groups.ts`, web/mobile group detail |
| 5 | MUC kick handling: parse self-presence status 321/307, emit `removed`, drop the row at once | SG-5 | `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/types.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/incoming.ts` |
| 6 | Retry failed topic-room syncs: remember failed group ids, drain on token fetch and on a timer | SG-3 | `apps/server/src/groups/ais.ts`, new `apps/server/src/groups/room-sync-retry.ts`, `apps/server/src/xmpp/api.ts` |
| 7 | Group bans: `group_bans` table, written on admin removal, checked by both joins | SG-8 | new migration, new `apps/server/src/groups/bans.ts`, `apps/server/src/groups/members.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/invite-links/join.ts` |
| 8 | Search hardening: username-only for strangers, one relation query, consume the invite in the `after` hook | SG-7, SG-9 | `apps/server/src/contact-requests/search.ts`, `apps/server/src/contact-requests/reads.ts`, `apps/server/src/auth/auth.ts` |
