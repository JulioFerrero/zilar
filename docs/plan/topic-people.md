# Group and topic people: the approved flow, mapped and broken into tasks

T-1750, 2026-10-16. **Plan only: no source file changed.** Every claim cites
`file:line`. Julio approved the canvas on 2026-10-16
(`docs/design/mockups/topic-people/README.md:5`), and the nine `.dc.html` files
there are the copy workers read. His choice: AIs stay **per topic**, and adding
one from a topic is **one step** (`README.md:5`). This maps today's code, says
what is missing on web and phone, and lists the build tasks for the lead to turn
into specs.

The rules from the boards that this plan treats as the target (`README.md:23-28`):

- The header count is everyone in the topic: people plus AIs (`README.md:25`).
- The writing line replaces the stack and its text only, so the header height
  never changes (`README.md:26`).
- `+ joins ai test` marks an add that also puts the person or AI in the group;
  no other hint text (`README.md:27`).
- The "isn't in" line shows only to the sender (`README.md:28`).

**Round 2 (same evening).** Julio added join, leave and mute, and chose the new
public-topic membership rule. The updated boards and `README.md` are committed on
`main` (`b7c239dc5`), not on this branch; §2.5, §2.6, §3.6 and tasks S4/S5, W9/W10
cite that version (their `README.md` line numbers are from `main`).

## 1. Board by board: what exists, what is missing

| Board | Today | Missing |
|---|---|---|
| `Main.dc.html` (phone topic) | The header shows the title and one subtitle line, `chatSubtitle`/`typingLabel` (`apps/mobile/src/components/chat/chat-header.tsx:102-168`). No avatar stack, no count. No "isn't in" row exists (no match for "isn't in" anywhere in `apps/`). | The two-line header: title + an avatar stack (≤4) and `ai test · 4` (`Main.dc.html:39-45`); the centred "Deepseek isn't in Financial" + Add row (`Main.dc.html:55-59`). |
| `PhoneHeader.dc.html` | The writers' names exist (`chat-header.tsx:89-103`) but render as a plain subtitle with `TypingDots` (`:165-168`); no writer avatars, no pulsing dot. | The stack swaps to the writers' avatars and "Deepseek is writing…" / "JULITO, Deepseek writing…" / "3 writing…" (`PhoneHeader.dc.html:55,69,83`). |
| `PhoneMention.dc.html` | The `@` list is group-level: `mentionMembersFor` returns the whole group's people and AIs (`apps/mobile/src/store/effects/helpers.ts:131-159`), fed to the picker (`chat-composer-dock.tsx:76-85`, `use-composer-mentions.ts:64-68`, `mention-picker.tsx`). | Filter to who is in the topic (`PhoneMention.dc.html:57-60`), so a group AI that is not in the topic is never offered. |
| `PhonePeople.dc.html` | `topic-info-sheet.tsx` (371 lines) lists private members (`:172-182`), AIs by name only (`:184-209`), roles (`:217-341`) and the link/done rows (`:343`). No Add key, no owner label, no tools/routines row. | Topic picture + name + public/private icon + group, a settings key, one primary **Add people or AIs** (`PhonePeople.dc.html:51-54`), the AIs owner label ("yours"/"Marta's", `:62`) and options key, the People header text (`:69`), and **Tools and routines · 1 · 2** (`:82-89`). |
| `PhoneAdd.dc.html` | Nothing: the group Add lives in `members-page.tsx:180-181` and `ais-page.tsx:107`, each a separate flow. | A new **Add to <topic>** sheet: People/AIs segmented control and search (`PhoneAdd.dc.html:46-54`), "In ai test" rows with Add or a "Here" tick (`:57-68`), "Your other AIs" with `+ joins ai test` (`:73-79`), New AI (`:83-87`). |
| `PhoneGroup.dc.html` | `root-page.tsx` shows separate **Members** and **AIs** rows (`:136-137`) and no Topics list. | One **People and AIs** row with a stack and count, and a **Topics** list: each row with its stack and `4 people · Deepseek` (General: "Everyone"; private: a lock + `Julio, Marta · Claude`) and New topic (`PhoneGroup.dc.html:56-89`). |
| `WebTopic.dc.html` | `TopicPanel.tsx` renders members (`:163-180`), AIs (`:200-213`), tools and routines (`:239-260`) in a `Sheet` (`:152`). | The same header stack, and a single **Add people or AIs** (`WebTopic.dc.html:90`) plus a **Tools and routines · 1 · 2** row (`:106-113`). The board draws a 340 px right panel; today web opens a `Sheet` (`TopicPanel.tsx:152`) — see open question 1. |
| `WebAdd.dc.html` | Nothing on web: adding a person is `GroupMembersSection`, an AI is `GroupAiSection` (`GroupPanel.tsx:206,234`). | A new **Add to <topic>** dialog: segmented control, search, "Your contacts" with `+ joins ai test`, and Invite with a link + Copy (`WebAdd.dc.html:42-67`). |
| `WebGroup.dc.html` | `GroupInfoRoot.tsx` has separate Members/AIs rows (`:199-212`) and no Topics list. | The **People and AIs** row and the **Topics** list with stacks (`WebGroup.dc.html:60-89`). |

## 2. The server

### 2.1 The one-step add

Two routes already exist and are the right shape; change their handlers rather
than add a combined route, so the derived client and both stores keep working:

- `POST /api/topics/:id/ais` → `addTopicAi` (`apps/server/src/topics/ais.ts:27-98`,
  contract `packages/api-contract/src/topics.ts:299-303`).
- `POST /api/topics/:id/members` → `addTopicMember`
  (`apps/server/src/topics/members.ts:125-164`, contract `:281-285`).

Today neither is one-step:

- `addTopicAi` answers **400 `invalid_request` "The AI must be in the group
  first"** when the AI is not in `group_ais` (`ais.ts:55-67`); it only inserts
  `topic_ais` (`ais.ts:72-81`).
- `addTopicMember` answers **400 `not_private`** for a public topic
  (`members.ts:132-134`) and requires the target already be in `group_members`
  (`members.ts:135-138`); it only inserts `topic_members` (`:139-148`).

**Recommendation:** make each handler the one-step add.

- `addTopicAi`, in one `sql.withTransaction`: re-read `group_ais` inside the
  transaction; when the row is missing, also insert `group_ais`
  (`group_id, ai_id, added_by`) and call the group room's
  `adminClient.setAffiliation(..., 'member')`, then insert `topic_ais`. Mirror
  the transaction `addGroupAi` already builds around the same two writes
  (`apps/server/src/groups/ais.ts:96-114`).
- `addTopicMember`, in one `sql.withTransaction`: insert `group_members` when
  missing (with the affiliation call, the `groups/members.ts:66-94` shape) and
  insert `topic_members` for **any non-General topic of either visibility**
  (public is now accepted, §2.5), keeping the separate group-half owner/admin
  guard below. General keeps no `topic_members` rows (its people are the whole
  group).
- The **cap** `MAX_GROUP_MEMBERS` (people + AIs, `groups/schemas.ts:13`) must be
  re-read **inside** the transaction in both handlers, not before it as today
  (`groups/ais.ts:80-93`, `groups/members.ts:59-65`), **under the per-group
  advisory lock `groups/join.ts:104` already takes**, held before the count.
  Re-reading inside the transaction is not enough on its own: two concurrent
  one-step adds each read `MAX-1` in their own transaction and both commit,
  landing at `MAX+1`, which is still check-then-insert. Take
  `pg_advisory_xact_lock(hashtext('group-join:' + groupId))` — the same key
  `groups/join.ts:104` uses, so a concurrent join and a concurrent add also
  serialize — then count and insert (AGENTS security checklist: "unique index,
  or a transaction with an advisory lock").
- Keep the XMPP failure mapping (`mapXmppError`, `groups/schemas.ts`), the room
  resync (`syncTopicRoom`, `topics/rooms.ts`), the audit entry
  (`topics/ais.ts:91-95`, `members.ts:158-162`) and the events
  (`emitTopicAi`/`emitGroupAi`), so the panels update live.

### 2.2 Who may do what (today, and what the boards need)

- **AI → topic.** The actor must own the AI (`ais.ts:43-54`) and see the topic
  (`ais.ts:31-35`); the AI must already be an active member of the group
  (`ais.ts:65-70`). General refuses every AI change with 400
  `already_in_general` (`ais.ts:36-42`).
- **AI → group.** A group owner/admin only, and the actor must own the AI
  (`groups/ais.ts:45-56`); the group's AIs and people share the cap
  (`groups/ais.ts:91`).
- **Person → topic.** A topic manager (`requireManagedTopic`, `members.ts:131` =
  the creator, or a group owner/admin, `access.ts:170-206`); the target must
  already be in the group (`members.ts:135-138`). Applies to any non-General topic
  of either visibility (§2.5).
- **Person → group.** A group owner/admin only (`groups/members.ts:26-33`).

**Recommendation:** keep today's rules, with the one change the boards force.

- An AI already in the group stays addable by its owner (today). An AI that must
  **also** join the group needs the group rule: its owner, who is also a group
  owner/admin. The boards agree — Add is a manager key (`GroupInfoRoot.tsx:144`,
  `info-keys.tsx:72-76`).
- A person add is a group owner/admin action (the group rule) and, for any
  non-General topic, the add needs topic management, which a group owner/admin
  satisfies. The only change is **public topics now accept the add** (today a 400,
  `members.ts:132-134`), adding the person to the group **and** to the topic's
  `topic_members` (§2.5).
- A plain member can add neither people nor AIs; the boards show Add only to
  managers. `assertOwner`'s General special case (`members.ts:62-78`) is
  unchanged.

### 2.3 A read for the group screen

**Partly there today.**

- `GET /api/groups/:id/topics` returns `Topic[]`, each with `memberCount` and
  `ais` (`{id, name}`) — `apps/server/src/topics/views.ts:128-156`,
  `loadTopicViewParts` `:177-321`; contract `packages/api-contract/src/topics.ts:205-229`.
  So the "4 people · Deepseek" line's count and AI names are already there.
- `listTopicMembers` gives the people's names for one topic
  (`apps/server/src/topics/queries.ts:52-117`), and `listTopicAis` the AIs
  (`views.ts:144-156`); both back the existing per-topic routes
  (`topics.ts:277-298`).
- **Missing:** the topics list carries no **people identities** for a stack
  (only a count), and `TopicAi` has no `avatarUrl` (`topics.ts:165`).

**Recommendation:** add `memberIds: string[]` to `Topic` and `avatarUrl` to
`TopicAi`, filled in `views.ts`. For **every non-General topic of either
visibility** `memberIds` is its `topic_members` plus role holders; only **General**
keeps the whole group — the same sets `listTopicMembers`/`countTopicMembers` use
(`queries.ts:58-117`, `views.ts:14-55`, §2.5). The group screen already loads
`GroupDetail` for names and avatars (`groups.ts:91-113`), so it can join the ids
and draw the stacks with no extra request.

**A rule the boards change.** `countTopicMembers` adds `group_ais` to *every*
non-General public topic (`views.ts:14-26`, T-1492). The boards show "Financial"
(a public topic) with **one** AI while the group has two (`PhoneGroup.dc.html:45`
"4 people · 2 AIs" vs `:74` "4 people · Deepseek"). Julio chose "AIs stay per
topic", so recommend: a non-General topic's AIs are its `topic_ais` only;
**General** keeps `group_ais`, exactly as `assertOwner` already special-cases
(`members.ts:62-78`). This is a stated rule change for the spec (open question
2).

### 2.4 Per-topic tools and routines

Both already carry a topic, so **no new column is needed** and the answer is
"the topic's own tools and routines", not "tools used by this topic's routines":

- `ai_tools.topic_id` exists (`apps/server/drizzle/0021_eager_dark_beast.sql:3`,
  backfilled in `0022_topic-scope-backfill.sql:27-36`), and
  `GET /api/topics/:id/tools` already lists the topic's tools across its AIs
  (`packages/api-contract/src/tools.ts:131-134`, `tools/queries.ts:41-80`,
  `tools/access.ts:180-221`).
- `routines.topic_id` exists (`apps/server/drizzle/0023_classy_lester.sql:5`),
  with a CHECK that `group_id` and `topic_id` are set or null together
  (`:21`). `listRoutinesForTopic` reads by `topic_id`
  (`apps/server/src/routines/queries.ts:64-77`) and the group route already uses
  it per topic (`routines/api.ts:104-128`), but there is **no**
  `GET /api/topics/:id/routines`.

**Recommendation:** the "Tools and routines · 1 · 2" row counts the existing
topic tools (`N`) and the topic's routines (`M`); add `GET /api/topics/:id/routines`
(mirroring `listForGroup`'s per-topic visibility filter, `routines/api.ts:104-128`)
so the panel can list and count them for one topic.

### 2.5 The new membership rule: a public topic has members (Round 2)

Today a **public topic has no `topic_members` rows at all**: its people are
*implicitly* every group member, and `topic_members` exists only for private
topics.

- `topic_members` is `(topic_id, user_id)` with `added_by`/`added_at`
  (`apps/server/drizzle/0018_lethal_warhawk.sql:1-8`).
- `createTopic` inserts `topic_members` **only** when the topic is private
  (`apps/server/src/topics/service.ts:104-118`) and rejects `memberIds` for a
  public topic (`service.ts:63-65`).
- Every "who is in this topic" read special-cases public to the whole group: the
  header count (`views.ts:13-27`), the member list (`queries.ts:58-72`), the
  room's desired members (`room-members.ts:48-79`) and the gateway's turn gate
  (`agents/gateway/db.ts:342-349`).
- Visibility agrees: `canSeeTopic` answers true for any group member on a public
  topic (`access.ts:93-95`), and `visibleTopics` / `visibleTopicsForGroups` keep
  every public topic for every member (`access.ts:164`, `visible-batch.ts:88-96`).
- A topic that switches to public **deletes** its `topic_members`
  (`patch.ts:185-206`), because they were only the private invite list.

**Julio's rule** (`README.md` Round 2, `:29-32`): a new public topic includes
**nobody until people join**; any group member can see it under Other topics,
read it and join it; private stays invite-only; **General stays everyone**.

**Recommendation — `topic_members` holds a public topic's people too**, and
`isGeneral` (not `visibility`) selects the "whole group" rule:

- `createTopic` inserts the creator's `topic_members` row for a public topic as
  well (`service.ts:62-68,104-118`): the creator is the first member.
- The "whole group" branch is kept **only for General**: `countTopicMembers`
  (`views.ts:13-27`), `listTopicMembers` (`queries.ts:58-72`), `desiredMembers`
  (`room-members.ts:48-79`, keeping the General channel-feed voice handling
  `:57-78`) and the gateway gate (`agents/gateway/db.ts:342-349`).
- A **non-General topic of either visibility** reads its people from
  `topic_members` plus role holders — the private branch that already exists
  (`room-members.ts:81-116`, `views.ts:28-54`, `queries.ts:74-117`). This also
  retires T-1492's "a public topic adds `group_ais`" special case and answers
  Round 1's open question 2.
- `aiMayBeInTopic` / `allowedTopicAiIds` gate a non-General topic's AIs on their
  owner being a member regardless of visibility (`ai-access.ts:43-45`, `:75-77`).
- `patch.ts` must **stop deleting** `topic_members` when a topic goes public
  (`patch.ts:206`); those rows become its member list. Going private keeps them
  and adds the invitees (`:185-198`).
- `canSeeTopic` and the visible reads **do not change**: a topic you have not
  joined stays readable (the last bullet below) and shows under Other topics.
- Leaving the **group** still wipes the user's `topic_members` rows across the
  group's topics (`groups/members.ts:161-170`) — correct, they lost every topic.

**The backfill migration.** New hand-written file
`apps/server/drizzle/0069_topic-members-backfill.sql` (next number after
`0068_routine_last_message.sql`), run by `migrateSql`
(`apps/server/src/db/migrate.ts:9-19`; the folder is `effect/sql.ts:31-33`,
`:162`). It starts with `SET lock_timeout = '5s';` and, for every **non-General,
non-archived, public** topic, inserts one `topic_members` row per current
`group_members` row of its group, with `added_by = topics.created_by` and
`ON CONFLICT DO NOTHING`. Idempotent and expand-only; model it on
`0022_topic-scope-backfill.sql:1-36`. `db/rows.ts`: the migration is pure SQL and
needs **no** change; the new join/leave reads want a shared
`TopicMemberRow { topicId; userId; addedBy; addedAt }` beside `GroupMemberRow`
(`rows.ts:60-66`) — today only a local `TopicMemberRow { userId }` exists
(`agents/gateway/db.ts:65`).

**Who receives messages and pushes.**

- Room membership is `desiredMembers` (`room-members.ts:42-117`), applied by
  `syncTopicRoom` (`rooms.ts:19`); after the change a non-General room holds
  `topic_members` + role holders + the topic's AIs, not the whole group.
- Push subscriptions derive from the same `wanted` set
  (`room-push.ts:11-17,88-95`); each candidate is re-checked with `canSeeTopic`
  (`push/candidates.ts:93`) and muted by `chat_prefs` (`:116`, `isMuted`
  `:169-199`). A group member reading a public topic they have not joined holds
  no room subscription, so no push arrives; visibility stays true.
- A non-member **may** read a public topic: `canSeeTopic` keeps answering true
  (`access.ts:93-95`). The clients cannot get that text over XMPP (not a room
  member, so no MAM), so the phone/web preview reads it from S6's server endpoint
  (§2.7) with a Join key instead of the composer (§3.6, `PhoneJoin.dc.html:47-54`).

### 2.6 Join and leave

**Routes today.** `POST /topics/:id/members` adds a private member
(`packages/api-contract/src/topics.ts:281-285`; `addTopicMember`
`members.ts:125-164`), and `DELETE /topics/:id/members/:userId` removes one
(`topics.ts:286-289`; `removeTopicMember` `members.ts:166-270`).
`removeTopicMember` already lets a member remove themselves
(`members.ts:195-202`) — today's leave — but refuses a public topic
(`:179-181`) and never special-cases General.

**Recommendation.**

- **Join:** add `POST /api/topics/:id/join` (contract `topics.ts:250-311`) →
  `joinTopic`. Rules: the caller is a group member (`getGroupMembership`,
  `access.ts:43-58`); the topic is non-General, non-archived and public; a
  private (or missing) topic answers the same 404 (`requireVisibleTopic`,
  `access.ts:102-115`), General answers 400 `already_everyone`. Insert
  `topic_members (topic_id, user_id, added_by = self)` `ON CONFLICT DO NOTHING`,
  then `syncTopicRoom` (the S1 transaction shape). Audit `topic.member_joined`
  `{subjectUserId}` (ids only). A write needs a limit: reuse
  `TopicsCreateRateLimit` (`topics.ts:263`) or add a per-user cap.
- **Leave:** reuse `DELETE /topics/:id/members/:userId` with `userId = self`.
  Extend `removeTopicMember` to accept a **public non-General** topic for
  self-removal (drop the `not_private` guard at `members.ts:179-181`) but
  **self only**: on a non-General public topic any other target — managers
  included — gets 403 `forbidden`, so the manager-remove branch stays
  private-only. Today `canManageTopic` would otherwise let an owner/admin through
  (`members.ts:195-202`). Refuse **General** with 400 (leaving General is leaving
  the group). The audit row already exists (`members.ts:264-268`).
- **Drain-archive stays private-only.** `removeTopicMember` archives a topic whose
  direct rows and role holders drain (`members.ts:227`), and the route then
  answers a deletion-like 404 (`topics/api.ts:211-215`). A public topic must
  **not** be archived on drain: the last member leaving leaves it live and
  joinable, so the archive block is gated on `visibility === 'private'` (General
  never drains).
- **Idempotence / 404:** joining twice is a no-op; leaving a topic you are not in
  answers like `removeTopicMember` does today (`members.ts:192-194`).
- **Private re-join:** leaving a private topic is invite-only, so someone has to
  add you back (`addTopicMember`, `members.ts:125`); the board says so
  (`PhoneLeave.dc.html`).
- **The leaver's AIs and routines:** `removeTopicMember` already calls
  `emitDroppedTopicAis` (`members.ts:260-263`), which drops the leaver's AIs from
  the topic room without deleting rows (`topics/roles.ts:21-46`). **Routines**
  belong to an AI (`routines.ai_id`, `0023_classy_lester.sql:1-29`), not to a
  person, and nothing deletes them on leave. Recommendation: leave the rows
  untouched in this flow; a routine whose AI left the room can no longer post, so
  pausing the leaver's AIs' topic routines is a small follow-up (open question 3).

### 2.7 The read-only preview of a public topic you have not joined

The `PhoneJoin`/`WebTopic` board shows a not-joined member reading the topic's
recent messages behind a Join key. The clients cannot read those over XMPP: group
history is MUC MAM and "Group history (MUC MAM) only works once the rooms are
joined" (`packages/client-core/src/store/history-core.ts:63`), and topic rooms are
members-only (`queries.ts:30`). After §2.5 a non-member holds no affiliation, so
presence is rejected and MAM returns nothing; the preview needs a server read.

**Recommendation — `GET /api/topics/:id/preview`** (task S6): the last 30 archive
rows of a **public, non-General** topic, to a group member the topic is visible to
but who is **not** a member. Read-only. A private topic, an archived topic, a
non-member of the group, or a member who already joined all answer the same 404
(`toMissingTopic`, `access.ts:28-30`), so ids cannot be probed; the caller check
is `canSeeTopic` (`access.ts:93-95`) **and** "no `topic_members` row and no role".

- **Reuse the existing archive read.** The ejabberd MAM rows live in the `archive`
  table, already read by search: the pool and row type are
  `ArchivePool`/`ArchiveRow` (`apps/server/src/search/service.ts:15-33`), the
  windowed newest-first query is `buildFuzzyCandidatesQuery`
  (`search/archive-query.ts:105-131`, columns `owner`, `peer`, `barePeer`, `kind`,
  `nick`, `originId`, `timestamp`, `xml`, `body`), and the decoding helpers are
  `timestampToIso` and `senderNameFor` (`search/snippet.ts:48-70`); message text
  drops a reply's fallback quote exactly as `push/candidates.ts:207`
  (`textWithoutReplyFallback`) does. Scope `username` to the full room JID
  `<roomLocalpart>@<mucDomain>` — the value `search/service.ts:135-140` builds and
  `search/archive-query.ts:55-57` matches, never the bare localpart — and
  `LIMIT 30`, newest first.
- **Response shape:** the minimal fields a client message row draws (`UiMessage`,
  `packages/chat-core/src/types.ts:68-114`): `{ messages: Array<{ id: string;
  senderName: string; text: string | null; createdAt: string }> }`, oldest first
  (30 max). No attachments, cards, reactions or read state in v1 — the board's
  bubbles are text; a later task can widen it with `media/extract.ts:102`
  (`decodeAgentPayload`) if the preview needs media.
- **Rate limit:** a per-user limiter (`createRateLimiter`, `rate-limit.ts:15-40`),
  the way search guards its route (`search/api.ts:71-95`); wire it as a contract
  middleware beside `TopicsCreateRateLimit` (`topics.ts:263`).

## 3. The client

### 3.1 The header stack, the "group · N" line, the writing line

Both apps already receive the writers and the AI draft status; neither draws a
stack.

- **Writers.** `typing[chat.id].names` on web (`ChatHeader.tsx:63`, `:73`) and
  phone (`chat-header.tsx:89`, `:94`), formatted by `typingLabel`
  (`packages/chat-core/src/chat-labels.ts:53-69`). The AI draft reads through
  `drafts[chat.id]` (`ChatHeader.tsx:71-75`) and the AI status through
  `typing[...].status` (`:68-79`; `chat-header.tsx:90-101`).
- **The stack** does not exist: web's header title is text only
  (`ChatHeader.tsx:145-170`), phone's second line is the group name + subtitle
  (`chat-header.tsx:117-168`).
- **The count** N is the people plus AIs in the topic (`README.md:25`), read
  from §2.3.

**Recommendation:**

- Add `writingLabel(chat, names)` to the shared `chat-labels.ts`, with the
  board's D24 wording (`PhoneHeader.dc.html:55,69,83`): one name →
  "X is writing…"; two → "A, B writing…"; three or more → "N writing…".
  `typingLabel` stays for the chat list (`ChatListItem.tsx:87`).
- New per-app header-stack components (web `components/topic/TopicPeopleLine.tsx`,
  phone `components/chat/topic-people-line.tsx`): a ≤4 avatar stack + `group · N`
  when nobody writes; the writers' avatars + `writingLabel` + a 6 px pulsing dot
  while someone writes (`PhoneHeader.dc.html:55`). Swap only the second line, so
  the header height never changes (`README.md:26`). Avatars come from the
  `GroupDetail` the app already loads (`chat-header.tsx:113-135` web /
  `chat-header.tsx:117-168` phone); AI avatars from `GroupAi.avatarUrl`
  (`groups.ts:110`).

### 3.2 The @ list filtered to who's in the topic

Both pickers are fed the **whole group**, so they offer a group AI that is not
in the topic — the exact bug Julio hit (`README.md:3`).

- Web: `useMentions.ts:71-80` reads `groupMembers(chatId)` (rebuilt group-wide,
  `store/effects/groupMembers.ts:28-41`); the picker renders the candidates
  (`ComposerControls.tsx:112-119`, `mention-picker.tsx`).
- Phone: `mentionMembersFor` returns the whole group (`helpers.ts:131-159`),
  consumed by `chat-composer-dock.tsx:76-85` and `use-composer-mentions.ts:64-68`
  into `mention-picker.tsx`.

**Recommendation:** filter the candidates to the topic's people and AIs — the
same sets as §2.3. Once `Topic.memberIds` and the topic's `ais` ride on the
topic row (`TopicInfo`, `packages/chat-core/src/types.ts:158-173`), the composer
intersects `groupMembers(chatId)` with `memberIds` and keeps only the topic's AIs
— no new request. For a **public** topic `memberIds` is its own members (§2.5), so
an AI or person who is in the group but not in the topic is never offered — the
exact bug Julio hit. **General** keeps the whole group (its AIs are `group_ais`).
The per-topic sets the info panel already loads (`topicPanelOps.ts:49-62` web;
`use-chat-screen.ts:245-249` phone) stay as the panel's own reads.

### 3.3 The "isn't in" line

Nothing exists today (no "isn't in" string in `apps/`). It is a **client-only,
sender-only** row, so it needs no server state:

- After the sender's own message is sent, the app checks each mention in that
  message against the topic's people/AIs (§3.2's sets); for each mention that is
  not in the topic it shows one centred `role="status"` row: the entity's avatar,
  "<Name> isn't in <Topic>", and an **Add** key (`Main.dc.html:55-59`).
- "Shows only to the person who sent the mention" (`README.md:28`) falls out of
  it being derived from their own outgoing message and drawn locally — no
  broadcast.
- **Add** calls the §2.1 one-step add; the row clears when the add succeeds (or
  when the topic's sets refresh).
- Where it is decided: the send path already tracks the message's mentions
  (web `store/storeOptions.ts:24`, phone `store/send-types.ts:11-12`), so both
  apps key the row to the sent message id in the message list. Confirm the
  mention targets against the entity jids/ids (`UiMention`, `packages/chat-core`).

### 3.4 In this topic, and the Add sheet/dialog

**Phone.** `topic-info-sheet.tsx` is 371 lines and must be split **before** it
grows (task W6): move the roles block (`:217-341`) into
`components/chat/topic-info-roles.tsx`. Then:

- Add the topic header art (picture, name, public/private icon, group) and a
  settings key (`PhonePeople.dc.html:39-49`).
- Add one primary **Add people or AIs** (`:51-54`) opening a new
  `topic-add-sheet.tsx`: People/AIs segmented control and search, "In ai test"
  rows with Add or a "Here" tick, "Your other AIs" with `+ joins ai test`, and
  New AI (`PhoneAdd.dc.html:46-87`). The store methods the group pages use
  (`addGroupAi`, `ais-page.tsx:44`; `addTopicAi`) back the one-step add.
- Show the AIs owner label ("yours"/"Marta's", `PhonePeople.dc.html:62`): the
  topic AI list has no owner (`topics-api.ts:26-29`), so read `ownerId` from the
  group detail the sheet already has (`GroupAi.ownerId`, `groups.ts:109`) or
  extend `TopicAi` with `ownerId` in §2.3.
- People header text: just **"People"** with the member count
  (`PhonePeople.dc.html:69`) for every non-General topic — no "everyone in
  <group>" line; the round-2 board says "People".
- Add a **Tools and routines · N · M** row opening `tools-page.tsx` scoped to
  the topic (`PhonePeople.dc.html:82-89`; §2.4).

**Web.** `TopicPanel.tsx` (302 lines) already renders the members, AIs, tools and
routines sections (`:163-260`). Add:

- The one primary **Add people or AIs** button (`WebTopic.dc.html:90`) opening a
  new `panels/TopicAddDialog.tsx`: a `role="dialog"` 440 px panel with the
  segmented control, search, "Your contacts" rows with `+ joins ai test`, and
  Invite with a link + Copy (`WebAdd.dc.html:42-67`).
- A **Tools and routines · N · M** row that opens the existing sections
  (`WebTopic.dc.html:106-113`).
- Keep the `Sheet` container (`TopicPanel.tsx:152`); see open question 1.

### 3.5 The group screen's Topics list

**Phone.** `root-page.tsx` lists separate Members and AIs rows (`:136-137`).
Replace them with one **People and AIs** row (stack + count, `PhoneGroup.dc.html:56-61`)
and add a **Topics** section (a new `components/group-info/topics-section.tsx` to
keep `root-page.tsx` small): one row per topic with its glyph (or a lock for
private), the name, the subtitle ("Everyone" for General; "N people · <first AI>"
otherwise; private names the people and the AI, `PhoneGroup.dc.html:66-83`), an
avatar stack, and a chevron; then New topic (`:84-87`). The rows come from
`GET /groups/:id/topics` (§2.3), which the group screen must fetch (today the
chat list carries only the topic's `memberCount`, not its AIs — `TopicInfo` has
no `ais`, `packages/chat-core/src/types.ts:158-173`).

**Web.** `apps/web/src/components/group-info/GroupInfoRoot.tsx` (293 lines) has
the same separate rows (`:199-212`) and no Topics list. Add the **People and AIs**
row and a new `components/group-info/TopicsSection.tsx` with the same rows
(`WebGroup.dc.html:60-89`), opening the topic.

### 3.6 Round 2 on the clients: Your/Other topics, Join, Leave, Mute

The group screen now has two lists whose split is the new membership rule: **Your
topics** (General plus every topic the caller has a `topic_members` row or a role
in) and **Other topics** (the group's public topics the caller has not joined,
each with a **Join** key). The `GET /groups/:id/topics` row (§2.3) has to carry
the caller's membership and mute, so `Topic` gains `joined: boolean` and
`muted: boolean` — delivered by **S2** (§4): contract
`packages/api-contract/src/topics.ts:205-229`, `packages/chat-core/src/types.ts:158-173`,
`apps/mobile/src/lib/topics-api.ts`. The muted flag feeds the row's muted icon.

- **Phone group screen.** `apps/mobile/src/components/group-info/root-page.tsx`
  (180 lines) gains **Your topics** and **Other topics**; the rows live in a new
  `apps/mobile/src/components/group-info/topics-section.tsx` to keep `root-page.tsx`
  small. Each row: glyph (or a lock when private), name, the "Everyone" /
  "N people · <first AI>" subtitle, an avatar stack and a chevron; a muted icon
  when muted; Join on Other-topic rows (`PhoneGroup.dc.html:64-107`).
- **Web group screen.** `apps/web/src/components/group-info/GroupInfoRoot.tsx`
  and the group panel `apps/web/src/components/GroupPanel.tsx` (359 lines): the
  same two lists in a new `apps/web/src/components/group-info/TopicsSection.tsx`
  (`WebGroup.dc.html:67-107`).
- **The topic preview with a Join key.** On phone the composer is
  `apps/mobile/src/components/chat/chat-composer-dock.tsx` (197 lines); on web it
  is `apps/web/src/components/Composer.tsx` (239 lines). When the caller is a
  group member but not in a public topic (a not-joined state), show a primary
  **Join <Topic>** key where the composer goes (`PhoneJoin.dc.html:47-54`). The
  messages above it come from **S6's `GET /api/topics/:id/preview`** (§2.7),
  rendered **read-only** with the same message rows — MAM delivers nothing before
  the join, so the app must not try to open the room or load its history
  (`packages/client-core/src/store/history-core.ts:63`). Join calls §2.6's route,
  then the room sync and history load re-render the composer.
- **The Leave confirmation sheet.** Phone: a new
  `apps/mobile/src/components/chat/leave-topic-sheet.tsx` (D24 sheet, the shape of
  `chat-actions-sheet.tsx`, 208 lines), opened from In this topic
  (`PhonePeople.dc.html:99`); General shows no Leave; the private copy is
  "Someone in it has to add you back." (`PhoneLeave.dc.html`). Web: the same
  confirmation in the In this topic panel `apps/web/src/components/TopicPanel.tsx`
  (302 lines), reusing `apps/web/src/components/ConfirmDialog.tsx` (62 lines),
  with no Leave on General. Both call the leave route (§2.6).
- **Mute.** A topic's **own room id can already be muted on both apps**: web
  `setMuted(chat.id, …)` (`apps/web/src/components/ChatActionsMenu.tsx:105-128`,
  `store/store.ts:72`, `store/effects/prefs.ts:126-137`), phone
  `saveChatPref(chat.id, { mutedUntil })` (`chat-actions-host.tsx:47-53`,
  `lib/chat-prefs.ts`), and push already honors it (`push/candidates.ts:116`,
  `isMuted:169-199`). **Missing:** the Mute switch inside In this topic, on both
  apps, reading `chat.muted` and calling the same setter — `TopicPanel.tsx` (web)
  and `topic-info-sheet.tsx` (phone, split in W6) — and the muted icon in the new
  group-screen topic lists.

**Files stay ≤ 400 lines** (`packages/devtools/src/gate/size.ts:10-39`):
`topic-info-sheet.tsx` (371) is split in W6 before it grows; `GroupPanel.tsx`
(359) and `TopicPanel.tsx` (302) take only the new rows, with the lists in the
new `TopicsSection.tsx` / `topics-section.tsx`; `views.ts` (347) may cross 400 as
it gains the joined/mute reads, so move the count helpers to a small
`topics/member-counts.ts` if it does.

## 4. Task breakdown

Ordered: the server first, then web and phone in pairs. One worker each, 20–45
min, every file ≤ 400 lines. Tests only where a change touches permissions — at
most two per task (AGENTS "Tests"). The lead assigns the real ids.

### Wave 1 — the server

1. **S4a [server+contract] the membership writes + backfill** — **T-1754,
   merged.** `topic_members` now holds a public topic's people (§2.5):
   `createTopic` inserts the creator (`service.ts:62-68,104-118`) and `patch.ts`
   stops deleting `topic_members` on going public (`:206`). The hand-written
   `apps/server/drizzle/0069_topic-members-backfill.sql` (`SET lock_timeout =
   '5s';`, one member row per current group member of every non-General public
   topic, `ON CONFLICT DO NOTHING`) and the shared `TopicMemberRow` in
   `db/rows.ts:60-66` landed with it.
2. **S4b [server] the read rule + the AI sweep** — **T-1757, done.** Switch every
   "who is in this topic" read to "**General is the whole group**":
   `countTopicMembers` / `listTopicMembers` (`views.ts:13-27`, `queries.ts:58-72`),
   `desiredMembers` (`room-members.ts:48-79`) and the gateway gate
   (`agents/gateway/db.ts:342-349`) keep the whole-group branch only for General,
   and the new `isTopicMember` helper in `topics/access.ts` is the one caller
   check for join, preview and `joined`. `aiMayBeInTopic` / `allowedTopicAiIds`
   drop the public shortcut (`ai-access.ts:43-45,75-77`). Extend
   `emitDroppedGroupTopicAis` (`groups/topic-rooms.ts:62-83`) to **every
   non-General topic** — today it skips `visibility !== 'private'` (`:64-66`), so
   a removed member's AIs in public topics would leak live sessions. It also
   re-backfills with `apps/server/drizzle/0070_*.sql`: between T-1754's and
   T-1757's deploys only the new **writes** are live while the **reads** still
   treat a public topic as the whole group, so anyone who joins a group in that
   window is in the old read but has no `topic_members` row; `0070` adds those
   rows (every current group member of every non-General public topic, `ON
   CONFLICT DO NOTHING`, idempotent like `0069`). It also refreshes the stale
   public-rule comments in `ai-access.ts:12-22`, `agents/gateway/db.ts:305-316`
   ("public topics: every group member"), the `room-members.ts` public branch
   (`:29-32,48-50`), `views.ts:14` (T-1492), `roles/access.ts`,
   `routines/preflight.ts` and `groups/members.ts`. Tests (permissions/rule, 2): a
   group member who is not in a public topic can read it (`canSeeTopic` true) but
   is not in `desiredMembers`; a removed group member's AI in a public topic gets
   the `ai-removed` emit.
3. **S1 [server] the one-step add.** Change
   `apps/server/src/topics/ais.ts:27-98` and `apps/server/src/topics/members.ts:125-164`
   so each writes the group half when missing **and, for `addTopicMember`, the
   `topic_members` row for any non-General topic of either visibility** (§2.5), in
   one `sql.withTransaction`, taking the per-group advisory lock
   `groups/join.ts:104` takes (`pg_advisory_xact_lock(hashtext('group-join:' +
   groupId))`) **before** re-reading `MAX_GROUP_MEMBERS`
   (`groups/schemas.ts:13`) inside it; keep the audit, the resync and the events.
   **Guard the group half with the group rule, separate from topic management.**
   `addTopicMember` keeps `requireManagedTopic` for the topic half
   (`members.ts:131`, `access.ts:188-206`), but the `group_members` insert needs a
   group owner/admin (`groups/members.ts:26-33`) — never a plain-member topic
   creator, who passes `requireManagedTopic` for their own topic
   (`access.ts:194-196`) and must not add people to the group through it. The AI
   group-join branch is the same: before inserting `group_ais`, check the actor is
   a group owner/admin and owns the AI (`groups/ais.ts:45-56`). Tests
   (permissions, 2) in `apps/server/src/topics/ais.test.ts` and a new
   `apps/server/src/topics/one-step-add.test.ts`: an AI owner who is a group owner
   adds an AI not yet in the group → it lands in `group_ais` **and** `topic_ais`;
   a plain member who created a public topic and owns the AI → adding that AI, or
   a person, is refused by the group rule (403 `forbidden`). ~45 min.
4. **S2 [server+contract] the topic people/AI read.** Add `memberIds` to `Topic`,
   `avatarUrl` to `TopicAi`, and `joined`/`muted` to `Topic`
   (`packages/api-contract/src/topics.ts:165,205-229`; mirror in
   `apps/mobile/src/lib/topics-api.ts:26-52`, `packages/chat-core/src/types.ts:158-173`
   and the server `TopicView` `apps/server/src/topics/types.ts:49-70`); fill them
   in `apps/server/src/topics/views.ts` (`toTopicView` `:128-140`, `listTopicAis`
   `:144-156`, `loadTopicViewParts` `:177-321`, `toTopicViews` `:323-347`).
   `memberIds` is `topic_members` plus role holders for every non-General topic of
   either visibility; only General is the whole group (§2.3, §2.5). `joined` is a
   `topic_members` row or a role holder; **General is always true**. `muted` is
   the caller's own chat prefs for that topic room — `chat_prefs` keyed by the
   room JID (`chat-prefs/service.ts`, `drizzle/0024_abandoned_skullbuster.sql:1-8`).
   That means `toTopicView`/`toTopicViews` take the caller id, so update their
   **11 call sites**: `topics/api.ts:101,128,139,168,179,201,217,236,264,275` and
   `chats/list-handler.ts:165`. The people/AI **count rule** is settled in S4
   (§2.5) — a non-General topic counts its `topic_members` plus `topic_ais`;
   General keeps the whole group (`:14-26`, `:291-301`). Tests (permissions/rule,
   2): `memberIds` lists exactly the topic's people; `joined` is true for a member
   and false for a public non-member, while `muted` follows the caller's pref.
   ~45 min.
5. **S3 [server+contract] `GET /api/topics/:id/routines`** — **T-1753, merged.**
   The endpoint landed with the helper `listVisibleTopicRoutines` in
   `apps/server/src/routines/reads.ts` (the merged file, `:229` on `main`),
   mirroring `listForGroup` (`routines/api.ts:104-128`) for one topic. Its test
   (1, the permission: a private topic the caller may not see → 404) is in.
   ~35 min.
6. **S5 [server] join and leave.** Add `POST /api/topics/:id/join`
   (`packages/api-contract/src/topics.ts:250-311`, `topics/api.ts`) → `joinTopic`
   and extend `removeTopicMember` for public self-leave, refusing General
   (`members.ts:166-270`). On a non-General public topic accept **self only**:
   any other target, managers included, gets 403 `forbidden` (so
   `canManageTopic` must not let an owner/admin through). Both sync the room
   (§2.6). Keep **archive-on-drain private-only** (`members.ts:227`): a public
   topic with no members stays live and joinable. Refresh the now-stale comments
   that say public topics gain every group member: the three T-0108 comments
   `groups/members.ts:98,161,215` and `groups/topic-rooms.ts:30-35`; S4b already
   updates the T-1492 comments in the files it touches. Tests (permissions, 2): a
   group member joins
   a public topic → a `topic_members` row and a room affiliation; leaving General
   is refused 400 and a manager cannot remove another user from a public topic
   (403). ~45 min.
7. **S6 [server+contract] `GET /api/topics/:id/preview`.** The read-only preview
   of a public topic a group member has not joined (§2.7): reuse the search
   archive read (`search/archive-query.ts:105-131`, `search/service.ts:15-33`) and
   its decoding (`search/snippet.ts:48-70`) for the last 30 messages. Scope
   `username` to the **full room JID** `<roomLocalpart>@<mucDomain>` — the value
   `search/service.ts:135-140` builds and `search/archive-query.ts:55-57` matches,
   not the bare localpart. `canSeeTopic` **and** not-a-member, the same 404
   otherwise; a per-user limiter. Contract in
   `packages/api-contract/src/topics.ts:250-311`. Test (permissions, 1): a
   non-member group member gets a public topic's messages; a private topic and a
   non-group-member answer 404. ~45 min.

### Wave 2 — web and phone pairs

4. **W1 [web] the header stack + writing line.** New
   `apps/web/src/components/topic/TopicPeopleLine.tsx`, rendered from
   `apps/web/src/components/ChatHeader.tsx:145-170`; add `writingLabel` to
   `packages/chat-core/src/chat-labels.ts`. No test (UI). ~40 min.
5. **W2 [phone] twin of W1.** `apps/mobile/src/components/chat/chat-header.tsx`,
   new `apps/mobile/src/components/chat/topic-people-line.tsx`. No test. ~40 min.
6. **W3 [web] the mention filter + the "isn't in" line.**
   `apps/web/src/components/composer/useMentions.ts:71-80` and
   `ComposerControls.tsx:112-119` (filter to `Topic.memberIds` plus the topic's
   AIs — for a **public** topic its own members, only General the whole group,
   §3.2); a new local row in the message list, its Add calling the one-step add.
   No test. ~45 min.
7. **W4 [phone] twin of W3.** `chat-composer-dock.tsx:76-85`,
   `use-composer-mentions.ts:64-68` (same `memberIds` filter), the message-list
   row. No test. ~45 min.
8. **W5 [web] In this topic + Add dialog.** `TopicPanel.tsx`; new
   `apps/web/src/components/panels/TopicAddDialog.tsx` and a tools/routines row
   reusing `ToolsSection`/`RoutinesSection`. No test. ~45 min.
9. **W6 [phone] In this topic + Add sheet (with the split).** Split
   `topic-info-sheet.tsx:217-341` into `topic-info-roles.tsx` first, then add the
   primary Add, the reworked sections (the People header is just **"People"** with
   its count, no "everyone in <group>") and a new `topic-add-sheet.tsx`. No test.
   ~45 min.
10. **W7 [web] the group screen's Your/Other topics lists.** `GroupInfoRoot.tsx`
    (`apps/web/src/components/group-info/`, 293 lines) and `GroupPanel.tsx` (359)
    plus a new `apps/web/src/components/group-info/TopicsSection.tsx`; split on
    `Topic.joined`, each row with a stack, the muted icon and a **Join** key on
    Other-topic rows (`WebGroup.dc.html:67-107`). No test. ~45 min.
11. **W8 [phone] the group screen's Your/Other topics lists.** `root-page.tsx:134-176`
    plus a new `apps/mobile/src/components/group-info/topics-section.tsx`;
    same rows, Join and muted icon (`PhoneGroup.dc.html:64-107`). No test. ~45 min.
12. **W9 [web] Join preview, Mute and Leave.** `Composer.tsx` (239) shows the
    **Join <Topic>** key for a not-joined public topic and renders S6's preview
    read-only above it (§2.7); `TopicPanel.tsx` (302) gains the Mute switch
    (`chat.muted` → `setMuted`) and the Leave confirmation (`ConfirmDialog.tsx`,
    no Leave on General), calling §2.6's routes. No test. ~45 min.
13. **W10 [phone] Join preview, Mute and Leave.** `chat-composer-dock.tsx` (197)
    for Join and the read-only S6 preview (§2.7); the W6-split In this topic sheet
    gains the Mute switch (`saveChatPref`) and the new `leave-topic-sheet.tsx`,
    `PhonePeople.dc.html:94-99` / `PhoneLeave.dc.html`. No test. ~45 min.

### Cross-cutting rules for every task

- Web and phone ship together: each pair (W1/W2, W3/W4, W5/W6, W7/W8, W9/W10) is
  one wave (`work/T-1747-message-blocks-plan.md:34`).
- `topic-info-sheet.tsx` is split in W6 before it grows past 400 lines
  (`apps/mobile/src/components/chat/topic-info-sheet.tsx`, 371 today).
- D24 style only (`docs/design/ui-style.md`), exact values from the boards;
  icons from lucide, never emoji (`AGENTS.md:69`).
- The client uses the one-step add and the join/leave routes; the server keeps the
  existing add routes and only extends the remove route (§2.6).
- The public-topic membership rule (§2.5) is server-first: writes+backfill (S4a,
  T-1754, merged) landed, then the read rule and AI sweep (S4b, T-1757, done), and
  the remaining server tasks (S1/S2) follow before join/leave (S5). Every client
  reads `Topic.joined` and never decides membership itself.

## 5. Open questions for Julio

Round 2 settled two of Round 1's questions: a public topic now has real members
who join (§2.5), and a non-General topic's AIs are its `topic_ais` — "AIs stay
per topic". Three are still open.

1. **The topic panel container.** The board draws a 340 px right panel
   (`WebTopic.dc.html:84`); web opens a `Sheet` today (`TopicPanel.tsx:152`).
   Recommended: keep the Sheet and match the board's **contents**; a layout
   change to a docked right panel is its own task, not this flow.
2. **Who may make an AI join the group.** Today only a group owner/admin may add
   an AI to the group (`groups/ais.ts:50-52`), while an AI's owner may add it to
   a topic it is already in (`ais.ts:52`). So a plain member who owns an AI
   cannot use the one-step add to bring it in. Recommended: keep the group rule
   (Add is a manager key on the boards); do not let an AI owner inject an AI into
   a group without a manager. Confirm.
3. **Routines of a person who leaves a topic.** `removeTopicMember` drops the
   leaver's AIs from the room but keeps their rows (`members.ts:260-263`,
   `topics/roles.ts:21-46`), and routines belong to an AI (`0023_classy_lester.sql:1-29`),
   so they are untouched today. Recommended: leave the rows in place but pause
   (or skip) a leaver's topic routines so they stop failing to post into a room
   the AI has left — a small follow-up, not part of S4/S5. Confirm.
