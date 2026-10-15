# AI work in topics: audit and step plan (T-1500)

Written 2026-10-15. This audit **changes no code**. It maps how a "topic" turns an
AI's work into state today, lists every use of the fields the approved design
removes, and splits the rework into ordered tasks.

Read with `docs/design/mockups/ai-work/README.md` (the approved model: no status
picked by hand; per-AI **working / waiting for you / done / idle**; the kind, the
five statuses, the single owner AI and the task strip go away) and
`docs/design/ui-style.md` (D24). Facts below were read on
`task/T-1500-ai-work-audit` on 2026-10-15; every claim carries `file:line`.

Model in one line: **a topic's state today is a hand-picked row on `topics`
(`kind`, `status`, `owner_ai_id`, `link_url`), while what the AIs are actually
doing lives elsewhere (the task card in XMPP, the `approvals` table, the live
gateway session map). The rework replaces the row with a read model computed from
those live sources.**

---

## 0. Summary

- **A turn is per (AI, room), not per room.** One AI runs at most one turn in a
  room at a time; several AIs in the same room run turns in parallel
  (`apps/server/src/agents/gateway/group-ingest.ts:263-306`). The only in-memory
  record of "a turn is running" is per AI: `AiSession.roomBusy: Set<string>` and
  `AiSession.turnAborts: Map<string, AbortController>`
  (`apps/server/src/agents/gateway/contracts.ts:219-228`). There is **no per-room
  index across AIs** — the gateway's `sessions: Map<string, AiSession>` is keyed
  by AI (`apps/server/src/agents/gateway.ts:84` is `roomRounds`, keyed by room,
  and holds only the round budget).
- **The task card is the AI's work UI today.** One `progress` message per turn,
  edited in place, state `working → done | failed | stopped`
  (`apps/server/src/agents/task-card.ts:9`, `apps/server/src/agents/gateway/live.ts:80-194`).
  It is a chat message, not topic state: the topic row knows nothing about it.
- **"Waiting for you" is not computed anywhere.** A pending approval is a row in
  `approvals` with `ai_id`, `group_id` and `topic_id`
  (`apps/server/src/approvals/service.ts:104-137`), but no read answers "does AI X
  in room/topic Y have a pending approval". **A question to people (reply chips,
  elicitation) does not exist**: `not found`.
- **A handoff today is only an `@nick` mention** in the AI's reply text
  (`apps/server/src/agents/group-turn.ts:144-174`); the delegation service
  (`apps/server/src/agents/delegation/service.ts`) stores the row, and the
  `handoff` protocol payload (`packages/protocol/src/handoff.ts`) is defined but
  **never sent by the server**: `not found`.
- **Clients learn about topic status/owner changes only by polling** `/api/chats`
  every 60 s (and on focus); the one bodiless headline notice is for delivered
  marks only (`apps/server/src/chats/delivered-notice.ts:27,48-63`). The task card
  is the exception: it arrives live over XMPP as a `progress` payload.
- **Owner following** is the one live behaviour built on `owner_ai_id`
  (`apps/server/src/agents/gateway/topic-follow.ts`); it must be rehomed before
  the column can be dropped (§7, T4).

---

## 1. Turns: where they start and end per (room, AI)

**What starts a turn.** Every inbound AI room message goes through
`handleRoomIncoming` (`apps/server/src/agents/gateway/group-ingest.ts`): a plain
human message opens a round (`:125-138`); a mention or a reply to the AI
(`:140-147`) or a followed owner (`:154-159`, `followOwnedTopic` at `:197-227`)
queues a turn (`queueRoomTurn` at `:231-261`). The work is pumped one turn at a
time per (AI, room) by `pumpRoomEffect` (`:266-306`): `session.roomBusy.add(roomJid)`
at `:273`, the `while` loop at `:275-304`, and `effect.ensuring` clears it at
`:305`.

**The turn body.** `runGroupSessionTurn` (`apps/server/src/agents/gateway/group-turn.ts:266-326`)
opens the session log (`openTurnLog`, `:267`) and runs `runGroupTurnBody`
(`apps/server/src/agents/gateway/group-turn-body.ts:75`), which calls
`runGroupTurn` (`apps/server/src/agents/group-turn.ts:139`) and, at the end,
`finishDelegation` for a delegated turn (`group-turn-body.ts:365-384`) and the
budget warnings (`:385-392`). The turn's stop controller is registered at
`group-turn-body.ts:288` and cleared at `:361` (`apps/server/src/agents/gateway/stop.ts:17-32`).

**Where the card changes state.** `liveProgressReporter`
(`apps/server/src/agents/gateway/live.ts:80-194`) owns one card per turn:

- open (`working`): `startTaskCard` at `live.ts:112` (`task-card.ts:39-48`),
  posted as the first `progress` message at `live.ts:128-131`;
- steps: `addTaskCardStep` at `live.ts:113` (`task-card.ts:53-65`), sent as
  corrections (`live.ts:133-135`) throttled to 1 s (`live.ts:78,117`);
- close: `finishProgressEffect` at `live.ts:155-186` calls `finishTaskCard`
  (`task-card.ts:87-100`) and sends the final correction with `state`,
  `elapsed_ms` and `summary` (`live.ts:168-175`).

The terminal state is chosen by the caller
(`apps/server/src/agents/group-turn.ts`): `done` at `:363` and `:367`, `failed`
at `:314`, `:320`, `:336` and `:358`, `stopped` via `stoppedTurn`
(`apps/server/src/agents/turn-stop.ts:38-41`, wired at `group-turn.ts:310,319,334,354,362,366`).
The card can be stopped from the chat by aborting the controller
(`apps/server/src/agents/gateway/stop.ts:35-52`).

**The in-memory record of running turns, named:**

| Record | Key | What it holds | Evidence |
| --- | --- | --- | --- |
| `AiSession.roomBusy` | room JID | rooms where this AI has a turn in flight | `contracts.ts:228`, set `group-ingest.ts:273`, cleared `:305`; counted `lifecycle.ts:238-245,283` |
| `AiSession.turnAborts` | room JID | the running turn's `AbortController` | `contracts.ts:219-222`, `stop.ts:17-32` |
| `roomRounds` (gateway) | room JID | the round budget, not turn liveness | `apps/server/src/agents/gateway.ts:84`, `contracts.ts:164-172`, `room-limits.ts:25-46` |
| `sessions` (gateway) | AI id | all live AI sessions | `apps/server/src/agents/gateway.ts` (passed to `live.ts` as `sessions`) |

There is no map keyed by room that aggregates every AI's turn in that room.

---

## 2. "Waiting for you": pending approvals and questions

**A pending approval is a row, not a room signal.** `createApproval` inserts
`ai_id`, `group_id`, `topic_id` and `status: 'pending'`
(`apps/server/src/approvals/service.ts:104-137`); the table and its
`(ai_id, status)` / `(group_id, status)` indexes are
`apps/server/drizzle/0011_silky_groot.sql:12-24`.

Reads today are per **user**, not per room/topic:

- `listDecidableApprovals` (`apps/server/src/approvals/queries.ts:104-160`) lists
  unexpired `pending` rows for the caller's own AIs (`:215-224`) or groups they
  own/admin (`:226-236`), then filters by `canDecideMany` (`:152`);
- `getDecidableApproval` (`:168-191`) reads one row by id;
- the read model maps a past-due `pending` row to `expired` without writing
  (`:251-263`).

A function that answers "does AI X in topic/room Y have a pending approval" does
not exist: **not found**. The data is there (`approvals.ai_id`, `approvals.topic_id`,
`approvals.status`, `approvals.expires_at`), so the new read model can compute it
with `WHERE ai_id = … AND topic_id = … AND status = 'pending' AND expires_at > now()`.

**A question to people (reply chips, elicitation, an "ask the user" tool) does not
exist.** Searches for elicitation / `ask_user` / reply chips across the server
return nothing; the only "question" strings are prose in the handoff prompt
(`apps/server/src/agents/context.ts:129-138`) and the design README. **Not found.**
The approvals card (a `approval.request` payload) is the closest thing to a
person-in-the-loop prompt, and it is decided on a page that polls
(`apps/web/src/lib/useApprovalPolling.ts:24,100-103`), not in the chat.

---

## 3. Handoffs and delegation

Three pieces, all separate:

1. **`handoff.ts`** (`apps/server/src/agents/handoff.ts:9-22`) is a pure finder:
   `findHandoffIndex(text, nick)` returns the offset of a whole-word `@nick`.
2. **`group-turn.ts`** uses it when it builds the outgoing message: `wire()`
   (`:144-174`) prefixes `@<sender> ` and, for up to two `handoffTargets`,
   appends a mention whose `jid`/`begin`/`end` come from `findHandoffIndex`
   (`:149-166`). A handoff is therefore **the `@nick` in the AI's reply text**
   with mention metadata — there is no dedicated handoff card or line.
3. **`group-ingest.ts`** detects the reverse: when an AI sender mentions another
   AI, it queues a handoff turn inside the round's hop budget
   (`:163-189`, hops at `:176-186`, `ROUND_MAX_HOPS` from `contracts.ts:126-127`).

**`delegation/service.ts`** is the durable core (T-0480): `checkDelegation`
(`:161-186`, permission from `can_delegate`/`accepts_delegation`, both in room),
`createDelegation` (`:189-225`, stores `status: 'working'`), `getDelegationForAi`
(`:242-259`, scoped to the two AIs), `finishDelegation` (`:263-284`, target only,
one-way), `cancelDelegation` (`:288-304`, source only). The `delegate`/`task_status`
tools queue a synthetic turn with `delegationId`
(`apps/server/src/agents/gateway/tool-exec.ts:238-239,262`) and
`group-turn-body.ts:365-384` finishes the row when that turn ends.

**How a handoff shows in the chat today:** as the other AI's name mentioned in the
first AI's reply. The protocol defines a `handoff` payload
(`packages/protocol/src/handoff.ts:4-18`, wired into the payload union at
`packages/protocol/src/payload.ts:17`), but no server code sends it and no client
renders it: web renders only `progress` and `approval.request` cards
(`apps/web/src/components/message/AttachmentBody.tsx:245-255`); mobile the same
(`apps/mobile/src/components/chat/payload-card.tsx:24-31`). **`handoff` card: not
found in use.**

---

## 4. Live updates to clients

| What changed | How a client learns today | Evidence |
| --- | --- | --- |
| A new task card / a step / the final state | XMPP: a `progress` message posted once, then corrections | `live.ts:120-136,168-175`; `packages/protocol/src/progress.ts:17-36`; client `packages/client-core/src/store/ledger-incoming.ts:191-202`, corrections `ledger-types.ts:77-84` |
| A new AI message / reply | XMPP message stream (draft stream + ledger) | `packages/client-core/src/store/incoming.ts:167-169` |
| Topic **status or owner** changed | **Polling.** `/api/chats` every 60 s while visible, and on focus | `packages/client-core/src/store/polling.ts:16,135-152` (`TOPIC_REFRESH_INTERVAL_MS = 60_000`, `refreshGate` `:117-133`); the changer also patches its own row optimistically (`apps/web/src/components/TaskStrip.tsx:105-126`) |
| A topic row was refreshed (archive, etc.) | a fresh `/api/chats` read repaints one row | `packages/client-core/src/store/groups.ts:91-128` (`applyTopicRow`) |
| Roster / invited / removed | XMPP event, debounced into one chat refresh per 2 s | `packages/client-core/src/store/lifecycle.ts:323-327`; `polling.ts:195-201` |
| A DM delivered mark | the one bodiless **headline** notice | `apps/server/src/chats/delivered-notice.ts:27,48-63` |
| Approval decided | the approvals page polls its read model | `apps/web/src/lib/useApprovalPolling.ts:24,100-103` |

So the only server-push channels are XMPP messages/corrections and the delivered
headline. **No headline notice carries topic status, owner or a task card**: the
only XMPP `type='headline'` stanza in the server is the delivered notice
(`apps/server/src/chats/delivered-notice.ts:57`); the other `headline` hits are
Postgres `ts_headline` search snippets (`apps/server/src/search/archive-query.ts`).
Web and mobile share the same client-core polling loop
(`packages/client-core/src/store/polling.ts`, bound per app at
`apps/web/src/store/effects/polling.ts:5-13` and the mobile store).

---

## 5. Inventory of what goes away

Marks: **D** = durable data/column, **W** = wire/contract, **R** = read/mapping,
**U** = UI. "owner AI" means the single `topics.owner_ai_id` / `TopicOwner` of the
topic (not the `ais.owner` column).

### 5a. Topic `kind`

- **Wire/contract:** `packages/api-contract/src/topics.ts:32` (`TOPIC_KINDS`), `:36,40`, `:101` (create), `:113` (patch), `:194` (response, lenient).
- **Server (D):** `apps/server/drizzle/0018_lethal_warhawk.sql:16`; `apps/server/drizzle/0019_general-topics.sql:9`; `apps/server/src/db/rows.ts:84`.
- **Server (R):** `apps/server/src/topics/access.ts:19-20,52`; `topics/schemas.ts:11,23`; `topics/service.ts:102,255`; `topics/api.ts:111,146`; `topics/views.ts:113`.
- **Client mapping:** `packages/chat-core/src/types.ts:121,141`; `packages/client-core/src/store/chat-rows.ts:180`.
- **Mock:** `packages/mock-backend/src/domains/topics/tables.ts:6,26`; `view.ts:47`; `routes.ts:20,87,114,284-285`; `seed.ts:24,43,62,81,100,119,138`.
- **Web (U):** `apps/web/src/components/topic/stripModel.ts:33-53` (`typeLabel`); `apps/web/src/components/NewTopicDialog.tsx:16,19,68,219` (create chips); `apps/web/src/lib/api/topics.ts:10,37,47,59`; `apps/web/src/lib/api.ts:159`.
- **Mobile (U):** `apps/mobile/src/lib/topics.ts:6,156-162,165-173`; `apps/mobile/src/lib/topics-api.ts:10,24,38,74,86,123`; `apps/mobile/src/components/chat/new-topic-sheet.tsx:12,15,25,59`.

### 5b. Topic `status`

- **Wire/contract:** `packages/api-contract/src/topics.ts:33` (`TOPIC_STATUSES`), `:37,41`, `:114` (patch), `:195` (response, lenient).
- **Server (D):** `apps/server/drizzle/0018_lethal_warhawk.sql:17`; `apps/server/src/db/rows.ts:85`.
- **Server (R):** `apps/server/src/topics/access.ts:22-29,53`; `topics/schemas.ts:24`; `topics/service.ts:103,256`; `topics/api.ts:147`; `topics/views.ts:114`.
- **Client mapping:** `packages/chat-core/src/types.ts:123,142`; `packages/client-core/src/store/chat-rows.ts:181`.
- **Mock:** `packages/mock-backend/src/domains/topics/tables.ts:7,27`; `view.ts:48`; `routes.ts:21,88,115,288-289`; `seed.ts:25,44,63,82,101,120,139`.
- **Web (U):** `apps/web/src/components/topic/stripModel.ts:14-31` (`STATUS_ORDER/LABEL/DOT`); `apps/web/src/components/topic/StatusMenu.tsx:1,6-16,43`; `apps/web/src/components/TaskStrip.tsx:72,105-107,150-156`; `apps/web/src/lib/api/topics.ts:14,41,60`; `apps/web/src/lib/api.ts:163`.
- **Mobile (U):** `apps/mobile/src/lib/topics.ts:7,175-186`; `apps/mobile/src/lib/topics-api.ts:10,24,39,87,137`; `apps/mobile/src/components/chat/task-strip.tsx:14,16-24,30,73,90,99,102,151-176`; `apps/mobile/src/components/chat/topic-row.tsx:16,42-48,84,135-139`; `apps/mobile/src/components/chat/use-chat-screen.ts:13,237-239`; `apps/mobile/src/app/chat/[id].tsx:77,193`.

### 5c. The owner AI (`owner_ai_id` / `TopicOwner`)

- **Durable data:** `apps/server/drizzle/0018_lethal_warhawk.sql:19,36` (FK, `ON DELETE set null`); `apps/server/src/db/rows.ts:87`.
- **Server (write):** `topics/service.ts:81,105` (create), `:242-245,257-261` (patch; also clears `follow_paused_at` at `:261`), `:284-285` (resume follow); `topics/members.ts:45-86` (`assertOwner`); `topics/ais.ts:154-155,160` (remove AI clears owner + invalidates follow); `groups/ais.ts:217-218` (remove group AI clears owner).
- **Server (read):** `topics/access.ts:33-37,54`; `topics/views.ts:60-92` (`resolveOwnerName`), `:183-187,216-219` (batch), `:302-310` (`buildTopicView`'s owner); `topics/api.ts:115,148`.
- **Contract:** `packages/api-contract/src/topics.ts:89-92` (`TopicOwnerRef`), `:105,115` (create/patch), `:156-162,196` (`TopicOwner`, response). `packages/chat-core/src/types.ts:127-131,146`.
- **Client mapping:** `packages/client-core/src/store/chat-rows.ts:185`.
- **Mock:** `packages/mock-backend/src/domains/topics/tables.ts:9-10,28`; `view.ts:49`; `routes.ts:89,116-117,271-281`; `state.ts:8`; `seed.ts:26,45,64,83,102,121,140`.
- **Web (U):** `apps/web/src/components/topic/OwnerMenu.tsx:1,7-13,19,33,50-54`; `apps/web/src/components/TaskStrip.tsx:4,109-118,158-166`; `apps/web/src/components/topic/stripModel.ts:55-61,88-95` (`ownerLabel`, `ownerIdFor`); `apps/web/src/lib/api/topics.ts:12,39`; `apps/web/src/lib/api.ts:161`.
- **Mobile (U):** `apps/mobile/src/lib/topics.ts:188-195` (`topicOwnerLabel`); `apps/mobile/src/lib/topics-api.ts:10,24,40`; `apps/mobile/src/components/chat/task-strip.tsx:9,33-34,108-114,178-212`; `apps/mobile/src/components/chat/use-chat-screen.ts` (owner choose; via `TaskStrip`).
- **Agent (following):** `apps/server/src/agents/gateway/topic-follow.ts:64-70,98-109,135,155`; `apps/server/src/agents/gateway/group-ingest.ts:208-212`.

### 5d. Topic `linkUrl` / `linkLabel`

- **Contract:** `packages/api-contract/src/topics.ts:13-14,66-86` (`TopicLinkUrl`, `TopicLinkLabel`), `:106-107,116-117` (create/patch), `:145-154` (`trimTopicText`), `:197-198` (response). `packages/chat-core/src/types.ts:147-148`.
- **Server (D):** `apps/server/drizzle/0018_lethal_warhawk.sql:20-21`; `apps/server/src/db/rows.ts:89-90`.
- **Server (R):** `topics/access.ts:55-56`; `topics/schemas.ts:16-17,26-27`; `topics/service.ts:82,106-107,246-250,263-264`; `topics/api.ts:116-117,149-150`; `topics/views.ts:116-117`; `topics/members.ts:88-100` (`assertLink`).
- **Client mapping:** `packages/client-core/src/store/chat-rows.ts:186-187`.
- **Mock:** `packages/mock-backend/src/domains/topics/tables.ts:29-30`; `view.ts:50-51`; `routes.ts:90-92,118-121`; `seed.ts:27-28,46-47,65-66,84-85,103-104,122-123,141-142`.
- **Web (U):** `apps/web/src/components/topic/stripModel.ts:63-86` (`httpsUrl`, `linkText`); `apps/web/src/components/TaskStrip.tsx:73,120-126,136-137,168-180`; `apps/web/src/components/topic/LinkEditor.tsx`; `apps/web/src/lib/api/topics.ts:52-53,62-63`.
- **Mobile (U):** `apps/mobile/src/lib/topics.ts:197-223` (`httpsTopicUrl`, `topicLinkText`); `apps/mobile/src/lib/topics-api.ts:41-42,79-80,89-90,203`; `apps/mobile/src/components/chat/task-strip.tsx:7,74,116-148,214-239`; `apps/mobile/src/app/chat/[id].tsx:19,230`.

Note: `linkUrl` also names an unrelated **media** field
(`apps/server/src/media/*`, `apps/server/src/db/rows-agents.ts:156`,
`packages/api-contract/src/media.ts:39`); it must not be touched by this rework.

### 5e. What `topic-follow.ts` depends on (mark before dropping the owner)

`apps/server/src/agents/gateway/topic-follow.ts` reads:

- `topics.owner_ai_id` — `:64-67` (`followingAiFor`), `:98-100` (`initTopicFollow`), `:135` (`pauseFollow`), `:155` (`resumeFollow`);
- `topics.follow_paused_at` — migration `apps/server/drizzle/0062_topic_follow_paused.sql:2`; `:100,134,154`;
- `topics.room_localpart` — `:66,100,135,155`;
- `topics.archived_at` — `:66,100`.

Callers to move with it: `group-ingest.ts:158,161,197-227` (follow / resume / is-follow-paused),
`stop.ts:40` (`pauseFollow` on Stop), `topics/service.ts:4,283-286`
(`invalidateTopicFollow`/`resumeFollow` on owner or archive change),
`topics/ais.ts:160` (remove AI drops the cached follow).

---

## 6. Proposal (smallest design)

(a) **Per-topic AI activity read model — computed, not hand-set.** New pure module
`apps/server/src/topics/ai-activity.ts` exposing
`topicAiActivity(db, topic, aiIds, now)` returning
`{ aiId, state: 'working' | 'waiting' | 'done' | 'idle' }[]`, computed as:

- **waiting** — one batched query on `approvals`:
  `SELECT ai_id, count(*) FROM approvals WHERE topic_id = … AND status = 'pending' AND expires_at > now() GROUP BY ai_id`
  (data already there; `approvals/service.ts:104-137`, `drizzle/0011_silky_groot.sql:12-24`).
  A future "question to people" adds a second source to the same union.
- **working** — asked of the live gateway, because a turn is in-memory
  (`AiSession.roomBusy`, `contracts.ts:228`). The gateway exposes one accessor
  (e.g. `runningAiIdsForTopic(roomJid): string[]`) built from the `sessions` map
  (`apps/server/src/agents/gateway.ts`) that `live.ts` already receives. No new
  table; a server restart loses nothing a restart does not already lose.
- **done** — an AI whose most recent terminal task card for this room is `done`:
  read `agent_task_events` (`apps/server/drizzle/0060_agent_task_events.sql`),
  last row per `(chat_jid, ai_id)` where `kind = 'status'` has `data.stage = 'done'`
  (written at `apps/server/src/agents/log/append.ts:141-154`, fed by
  `turn-stop.ts:26` and the done paths). A person's "mark done" is a durable flag
  (§d) that wins over the derived value.
- **idle** — none of the above.

Keeping this a **computed** read avoids a table to keep in sync and matches the
spec's wording ("computed on the server from turns and pending approvals"). One
batched query per list plus the gateway accessor keeps the sidebar O(1) per topic.

(b) **The topic list carries it.** Extend the existing topic view builder, not the
route: `buildTopicView` (`apps/server/src/topics/views.ts:95-125`) gains an
`activity: { aiId, state }[]` field, filled from the new module where `toTopicViews`
already batches (`views.ts:322-346`). The sidebar payload is `/api/chats`
(`apps/server/src/chats/api.ts:226-250`, contract
`packages/api-contract/src/chats.ts:95-98`); the per-group route
`/groups/:id/topics` (`topics/api.ts:88-98`) gets the same field. Map it into
`TopicInfo` (`packages/chat-core/src/types.ts:138-149`,
`packages/client-core/src/store/chat-rows.ts:176-188`). **`apps/server/src/chats/api.ts`
is 391 lines and `topics/views.ts` 346 — either can cross 400; split if so.**

(c) **Live changes reuse the headline notices.** The delivered notice
(`apps/server/src/chats/delivered-notice.ts`) is the working pattern: a bodiless
`<message type='headline'>` from the user's own bare JID to their resources,
`<no-store/>`, never pushed. Add a sibling
`apps/server/src/chats/ai-activity-notice.ts` that sends an
`urn:zilar:ai-activity:0` headline with `{ chatJid, aiId, state }` when a turn
starts/ends or an approval opens/decides; the client handles it next to the
`removed`/`roster` listeners (`packages/client-core/src/store/lifecycle.ts:323-327`)
and repaints that row (or calls `scheduleChatsRefreshBurst`,
`polling.ts:195-201`) instead of waiting for the 60 s poll. If a notification-only
path is enough for the first step, the poll stays as the fallback — the design
does not require a new socket.

(d) **How "done" is set.** Two sources, one state:

- the AI's final task card: the terminal `done` in `agent_task_events`
  (§a), so an AI that finishes shows a green check with no schema change;
- a person marking the topic done: a durable flag. Smallest shape is a nullable
  `topics.done_at` (or `topic_ai_done(topic_id, ai_id, done_at)` if "done" must be
  per AI). A new `PATCH /topics/:id` action sets it; the view reports `done` when
  the flag is set or the last card is `done`. Un-marking (a new turn starts)
  clears it in the turn-start path.

(e) **The owner AI's following once the owner goes away.** Replace the
owner lookup with "any AI that was `@mentioned` in this topic follows it until
done or stopped". Keep the existing shapes (`followingAiFor`, `isFollowPaused`,
`pauseFollow`, `resumeFollow`, `invalidateTopicFollow`) but re-key them on
`(topicId, aiId)` and store the durable pause in a new
`topic_follow(topic_id, ai_id, paused_at)` table instead of
`topics.owner_ai_id` + `topics.follow_paused_at`. `resumeFollow` is already called
on a real mention (`group-ingest.ts:161`); the follow check
(`group-ingest.ts:197-227`) becomes "is this AI in `topic_follow` for this topic".
The in-memory caches (`followCache`, `pausedFollows`, `topic-follow.ts:27-37`)
carry over unchanged.

(f) **Migration plan (expand/contract).** Release N adds the new shape and keeps
every old column live:

1. add `topic_follow` (or the new columns) and, if chosen, `topics.done_at`; backfill
   `topic_follow` from `topics.owner_ai_id` + `topics.follow_paused_at`;
2. ship the read model, the list field, the notice and the new clients reading
   `activity` while still tolerating `kind`/`status`/`owner`/`linkUrl`;
3. stop **writing** the old columns only once no running server writes them;
4. drop `kind`, `status`, `owner_ai_id`, `follow_paused_at` (and the owner FK),
   and remove `link_url`/`link_label` if the design drops the topic link too, in a
   **later** release — after the clients no longer read them.

Every new `.sql` starts with `SET lock_timeout = '5s';` (AGENTS.md). Keep the
response fields lenient (`lenientLiterals`, `api-contract/src/topics.ts:193-195`)
so an older client keeps working through the transition.

---

## 7. Step plan (8 tasks, in order)

Each line: title — exact files — migration? — surface. Files at/near the 400-line
bar are flagged; split them if the change crosses it.

1. **Read model: per-topic AI activity.** New
   `apps/server/src/topics/ai-activity.ts` (waiting from `approvals`; done from
   `agent_task_events`; working via a new gateway accessor). Touch
   `apps/server/src/agents/gateway.ts` (+ accessor over `sessions`/`roomBusy`),
   `apps/server/src/topics/ai-activity.test.ts`. No migration. **Server.**
2. **Carry activity in the topic list.** `apps/server/src/topics/views.ts`
   (346 lines — watch 400), `apps/server/src/topics/access.ts:45-66` (`TopicView`),
   `apps/server/src/chats/api.ts` (391 — watch 400),
   `packages/api-contract/src/topics.ts`,
   `packages/api-contract/src/chats.ts:95-98`,
   `packages/chat-core/src/types.ts:138-149`,
   `packages/client-core/src/store/chat-rows.ts:176-188`. No migration. **Server +
   contract + shared client mapping.**
3. **Person "mark done" + the done flag.** `apps/server/src/topics/service.ts`
   (392 — watch 400), `apps/server/src/topics/api.ts`,
   `packages/api-contract/src/topics.ts` (patch action),
   `apps/server/src/topics/ai-activity.ts`. Migration: add `topics.done_at`
   (new `.sql`, `SET lock_timeout`). **Server + contract.**
4. **Rehome owner following.** `apps/server/src/agents/gateway/topic-follow.ts`
   (194), `apps/server/src/agents/gateway/group-ingest.ts` (313),
   `apps/server/src/agents/gateway/stop.ts` (53),
   `apps/server/src/topics/service.ts` (392),
   `apps/server/src/topics/ais.ts` (184). Migration: add
   `topic_follow(topic_id, ai_id, paused_at)` and backfill from the owner columns.
   **Server.** Must land before T8 (drops the columns).
5. **Live activity notices.** New `apps/server/src/chats/ai-activity-notice.ts`
   (model on `apps/server/src/chats/delivered-notice.ts`),
   `apps/server/src/agents/gateway/live.ts` (335) and the turn start/end
   (`group-turn-body.ts` 395 — watch 400), approval open/decide
   (`apps/server/src/approvals/service.ts`). No migration. **Server.**
6. **Web UI: the "AIs here" model.** `apps/web/src/components/TaskStrip.tsx`
   (191 — replace the strip), `apps/web/src/components/topic/StatusMenu.tsx`
   (delete), `apps/web/src/components/topic/OwnerMenu.tsx` (delete),
   `apps/web/src/components/topic/stripModel.ts` (95 — trim), the sidebar row
   (`apps/web/src/components/TopicRow.tsx`), the chat header
   (`apps/web/src/components/ChatHeader.tsx`) and the notice handling in
   `apps/web/src/store/effects/lifecycle.ts` (`scheduleChatsRefreshBurst` call).
   No migration. **Web.**
7. **Mobile UI: the "AIs here" model.** `apps/mobile/src/components/chat/task-strip.tsx`
   (248 — replace), `apps/mobile/src/components/chat/topic-row.tsx` (177),
   `apps/mobile/src/lib/topics.ts` (296), `apps/mobile/src/lib/topics-api.ts` (246),
   `apps/mobile/src/components/chat/use-chat-screen.ts`,
   `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/components/chat/new-topic-sheet.tsx`
   (drop the kind chips). No migration. **Mobile.**
8. **Contract the old shape.** Drop `kind`, `status`, `owner_ai_id` (+ FK),
   `follow_paused_at`, `link_url`, `link_label` (new `.sql`,
   `SET lock_timeout`); remove `TOPIC_KINDS`/`TOPIC_STATUSES`/`TopicOwner` from the
   contract and the mock (`packages/mock-backend/src/domains/topics/*`). Migration:
   yes (drop columns/indexes). **Server + contract + mock.** Only after T6 and T7
   ship and no release writes or reads the fields.

---

## 8. Open questions for the lead (not blockers for this document)

1. **"Done" scope:** per AI or per topic? §d stores `topics.done_at` (whole topic);
   per-AI done needs `topic_ai_done`. The design shows a green check on an AI's
   picture, which reads per AI.
2. **Working source:** is an in-memory gateway accessor acceptable for the read
   model (§a), or should `roomBusy` be mirrored to a table at turn start/end so a
   future multi-process split cannot disagree?
3. **Topic link:** the design drops the task strip; should `linkUrl`/`linkLabel`
   go with it (T8 drops them) or move elsewhere (e.g. the topic panel)?
