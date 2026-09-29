---
id: T-0109
title: AIs in topics: an AI reads and answers only in the topics it was added to
status: merged
milestone: M5
branch: task/T-0109-ais-in-topics
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108]
estimate: 1.5 days
---

# T-0109: AIs in topics

## Spec (written by Claude, do not edit)

### Why
D29: an AI reads **only the topics it was added to**. After T-0108 every topic is its own room; today the agent gateway joins one room per group (the General room) for every AI in `group_ais`. This task makes AI membership per topic, so a "Design AI" in the group cannot read a private hiring topic, and a Dev AI can be added to exactly the bug topics it works on.

### Rules
- `group_ais` stays: it means "this AI belongs to the group" and, as today, puts the AI in the **General** topic. It is also the precondition to be added to any other topic (an AI must be in the group first).
- New `topic_ais` (`topic_id` fk cascade, `ai_id` fk cascade, `added_by` fk user, `added_at`, pk `(topic_id, ai_id)`); rows only for **non-General** topics. Migration only via `pnpm --filter @galena/server db:generate`.
- **Who may add or remove an AI in a topic:** the AI's **owner**, provided they can **see the topic** (`canSeeTopic` from T-0108); a topic manager may **remove** any AI from their topic. Removing an AI from the group removes it from every topic of that group (extend `removeGroupAi`, same transaction as the rules/tools cleanup it already does). Archiving a topic keeps its rows but the gateway leaves the room.
- The AI's XMPP account is a room member (affiliation `member`) of each topic room it is in, and only those: sync through the same room-sync function T-0108 added (`desiredMembers` learns about AIs: public topic = group members + its `topic_ais`; General = group members + all `group_ais`).
- An AI that is **not** a member of a private topic must be unable to read it even if it is in the group: proved at the room level (affiliations), not by the AI's own good behaviour.

### Routes (extend `topics/routes.ts`)
- `GET /api/topics/:id/ais` (visible), `POST /api/topics/:id/ais` `{ aiId }` (AI owner who can see the topic; the AI must be in the group and `active`; General → 400 `already_in_general` when it is a group AI, since General membership is `group_ais`), `DELETE /api/topics/:id/ais/:aiId` (AI owner or topic manager). Anyone else: the same 404 as a missing id.
- Audit: `topic.ai_added`, `topic.ai_removed` (ids only; no name for private topics).
- `GET /api/topics/:id` and the topic lists gain `ais: [{ id, name }]`.

### Agent gateway (`apps/server/src/agents/gateway.ts` and helpers)
- `listAiRooms` returns every room the AI should be in: for each `group_ais` row the General room, plus each non-archived topic where it is in `topic_ais`. Each `RoomSubscription` carries `topicId` (and still `groupId`). Reconcile joins new rooms and leaves rooms the AI lost (already there; extend it). A newly added or removed AI membership must show up without waiting for the next full reconcile: reuse the existing group-AI event (`groups/events.ts`) or add a sibling event for topics.
- **Wake gate per topic** (`loadRoomGateState`): the humans who may wake the AI in a room are the **topic's** members (public: group members; private: `topic_members`). A message from someone who is not a topic member cannot wake the AI (they cannot even be in the room, but assert it anyway). The role check for `request_action` (T-0098: sender is group owner/admin) stays, and additionally requires the sender to be in the topic; it is re-checked at tool-execution time as today.
- Rate limits and coalescing stay per room (topic), not per group.
- The room history the AI reads for a turn is that topic's room only.
- `postToChat` (T-0092) gets an optional `topicId`: when given, it posts into that topic's room (the AI must be a member and live), otherwise into General (group) or the DM. `session.rooms.has(roomJid)` remains the guard.
- The system prompt for a group turn names the topic ("You are in the topic <name> of the group <group>") for public topics and for private ones alike; it never lists the names of other topics.

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md` (Spec, Report, Review) and its code (`topics/`)
- `apps/server/src/agents/gateway.ts` (`listAiRooms`, reconcile, `RoomSubscription`, `loadRoomGateState`, the group turn and `runGroupTurn`), `agents/reply.ts` (group prompt), `groups/service.ts` (`addGroupAi`, `removeGroupAi`), `groups/events.ts`, `actions/announce.ts`
- `work/T-0098-group-request-action.md` (the gate and its re-check) and `T-0092` (`postToChat`)

### Allowed files
- `apps/server/src/topics/**`, `apps/server/src/db/schema.ts` + generated migration
- `apps/server/src/agents/**` (+ tests), `apps/server/src/groups/**` (only `removeGroupAi` and the AI events), `apps/server/src/actions/announce.ts` (only the optional `topicId`)
- `apps/server/src/audit/**` (names), `authz-sweep.test.ts`
- `work/T-0109-ais-in-topics.md`

**Not allowed:** web, mobile, approvals/rules/tools scope (T-0110), dependencies.

### Tests (Vitest, PGlite, fakes)
- Adding/removing AIs: owner who sees the topic can; owner who cannot see a private topic gets 404; a plain member who is not the owner gets 404; AI not in the group → 400; General → 400; group removal removes the AI from every topic and the room affiliations.
- Room desired members include exactly `group_ais` for General, `topic_ais` for other topics, and **never** an AI for a private topic it was not added to.
- Gateway (fake XMPP, existing test harness): an AI joins General plus its topics only; a mention in a topic it is in gets an answer in that room; a mention in a private topic it is not in never reaches it; adding/removing at runtime joins/leaves without restart; the action gate rejects a group admin who is not a member of a private topic and accepts one who is; `postToChat` with a `topicId` posts into that topic room and answers `false` when the AI is not in it; a stopped AI still posts nothing.
- No topic name of another topic appears in any prompt (assert on the messages sent to the fake model).

### Acceptance criteria
- [ ] An AI can only read and speak in the rooms it is a member of, and the room membership is what enforces it.
- [ ] Adding an AI to a topic needs its owner and visibility of that topic; removing follows the rules above.
- [ ] Existing group AIs keep answering in General with no behavioural change.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; the full server suite once, at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm build
```

### Out of scope
- Approvals, standing rules and tools scoped per topic (T-0110); UI (T-0111); an AI creating topics by itself; usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Schema + migration: new `topic_ais` table (`topic_id`/`ai_id` pk, `added_by`, `added_at`, cascade FKs), rows only for non-General topics. Generated via `pnpm --filter @galena/server db:generate` → `0020_dry_lord_hawal.sql`.
- Topics: `GET /api/topics/:id/ais` (visible), `POST /api/topics/:id/ais` `{ aiId }` (AI owner who can see the topic; AI must be an active group member; General → 400 `already_in_general`), `DELETE /api/topics/:id/ais/:aiId` (AI owner or topic manager). Strangers/blind owners/plain members get the same 404 as a missing id. `GET /api/topics/:id` and topic lists (incl. `GET /api/chats`) gain `ais: [{ id, name }]`. Audit `topic.ai_added`/`topic.ai_removed` (ids only). Room sync after every add/remove (502 on failure); events `ai-added`/`ai-removed` via new `onTopicAi`/`emitTopicAi` in `groups/events.ts`.
- Rooms: `desiredMembers` adds AI JIDs — General = every active `group_ais` AI; other topics = their active `topic_ais` rows; a private topic never includes an AI without a row. Archived topics sync empty.
- Groups: `removeGroupAi` deletes every `topic_ais` row for the AI in the same transaction as the rules/tools cleanup, re-syncs every topic room post-commit, then emits `ai-removed`. Input gains `domain`/`logger` (route passes them).
- Gateway: `listAiRooms` returns General per `group_ais` row + each live topic in `topic_ais`; `RoomSubscription` carries `topicId`. `loadRoomGateState` takes `topicId`: General/public wake on group members, private topics only on `topic_members` (role check for `request_action` stays owner/admin + re-check now also requires topic membership). Rate limits/coalescing stay per room; history is the topic room only. `postToChat` gains optional `topicId` (posts into that room when the AI holds it, else `false`). `ActionAnnouncer` gains optional `topicId` on both methods (announcer in `index.ts` untouched — out of Allowed files, so production cards still go to General/DM). System prompt names the topic ("You are in the topic <name> of the group <group>"), never other topics.
- Tests: topic AI routes (7 new), gateway topics block (8 new: joins, mention answered in-room, unjoined private ignored, runtime join/leave, admin gate accept/reject, postToChat true/false + stopped, no-other-topic-names), groups removal (1 new), context prompt (2 new), backfill exclusion fix.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0020_dry_lord_hawal.sql` (+ meta snapshot/journal)
- `apps/server/src/topics/service.ts` (add/removeTopicAi), `topics/routes.ts` (3 routes), `topics/access.ts` (`ais` on views, `listTopicAis`), `topics/rooms.ts` (AI affiliations)
- `apps/server/src/agents/gateway.ts` (rooms, gate, postToChat, event subs, topic prompt names), `agents/context.ts` (+ tests)
- `apps/server/src/groups/service.ts` (removeGroupAi cleanup), `groups/routes.ts` (domain/logger), `groups/events.ts` (topic AI events)
- `apps/server/src/actions/announce.ts` (optional `topicId` on the port only)
- Tests: `topics/topics.test.ts`, `topics/backfill.test.ts`, `agents/gateway.test.ts`, `agents/context.test.ts`, `groups/groups.test.ts`
- `work/T-0109-ais-in-topics.md` (status + this report)

### Commands run and real results
- `pnpm install`: pass (7.7s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (turbo 10/10)
- `pnpm --filter @galena/server test --maxWorkers=2`: 64 files passed, 5 skipped; 1113 passed, 7 skipped (229s)
- `pnpm build`: pass (2/2 turbo tasks)
- Scoped: topics 29 passed; agents+groups+chats+audit+authz-sweep 286 passed, 1 skipped; actions 105 passed; gateway full 113 passed.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|console.log|: any` in touched non-test source: no hits (2 pre-existing English comments containing "any" matched, no `any` types).

### Round 2 (review fix: an AI must not stay in a private topic its owner cannot see)
- New derived rule, evaluated live so it can never drift — `aiMayBeInTopic(db, topic, ai)` and `allowedTopicAiIds(db, topic)` in `topics/access.ts`: public non-General topics count the row as today; private topics count it only while the AI's owner holds a `topic_members` row (and is still a group member, via `canSeeTopic`). Rows are never deleted; re-adding the owner brings the AI back automatically. General answers false (no `topic_ais` rows there).
- `topics/rooms.ts` `addTopicAiMembers` uses `allowedTopicAiIds`, so `syncTopicRoom` removes the AI's affiliation from a private room once its owner is out.
- `agents/gateway.ts` `listAiRooms` filters each topic through `allowedTopicAiIds` (select now includes `visibility`), so the gateway leaves or never joins such a room. No change needed in `loadRoomGateState` callers: the gate already restricts wake-ups to topic members, and the subscription being gone means the message never reaches a turn.
- Re-sync + live leave on every flow where owner visibility changes: `removeTopicMember` and public→private `patchTopic` call `syncTopicRoom` (already there) plus new `emitDroppedTopicAis` (`ai-removed` per dropped AI); `removeGroupMember` reuses the existing `syncGroupTopicRooms` plus new `emitDroppedGroupTopicAis` in `groups/service.ts`. `removeGroupAi` needed nothing new (rows deleted, rooms re-synced, event already emitted).
- Tests: (a) owner self-removes from a private topic → AI affiliation gone, row stays, re-adding owner revives the AI; (b) public→private without the AI owner in `memberIds` → AI dropped, row stays; (c) covered by (a) re-add; (d) public topic keeps its AI. Gateway: owner removed from a private topic → session leaves on the event, later mentions unanswered, reconcile agrees. Fixed the pre-existing admin-gate fixture (AI owner must also be a topic member now for the turn to run). `backfill.test.ts` exclusion for `0020_*` unchanged.
- Checks (one Vitest run at a time): topics+groups 62 passed; gateway full 114 passed; full server suite `pnpm --filter @galena/server test --maxWorkers=2`: 64 files passed, 5 skipped; 1117 passed, 7 skipped (232s). format/lint/typecheck/build pass. No `any`, no disables, no new dependencies.

### Problems, deviations from the spec, open questions
- Per the review: the production announcer `topicId` wiring is left to T-0110. No action here.
- `patchTopic` public→private always inserts the acting manager into `topic_members` (pre-existing T-0108 rule), so "without the owner" means without the AI's owner specifically; the test pins exactly that (admin converts, AI owner out → AI dropped).

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** Approved and merged after one round of fixes.

### Findings
- Structure matches the spec: `topic_ais` (non-General only), per-topic room affiliations, gateway rooms and wake gate per topic (private topics wake only on topic members; `request_action` also requires topic membership), `postToChat` with `topicId`, topic-aware system prompt that never names other topics, group AI removal cleans every topic row in the same transaction.
- Fixed after review: an AI stayed in a private topic after its owner lost access (owner removed from the topic, topic made private without the owner, owner left the group). Now a derived live rule (`aiMayBeInTopic` / `allowedTopicAiIds`): in a private topic an AI counts only while its owner is a topic member and group member. Applied in the room sync and in the gateway's room list; rows are kept so the AI returns when the owner is added back; live sessions leave through `ai-removed` events. Tests cover removal, going private, re-adding the owner, and public topics unaffected.
- Checks re-run by the lead: format, lint, typecheck (10/10) pass; topics, groups, gateway and authz-sweep scoped run 181 passed; the worker's full server suite (after the fix) 1117 passed, 7 skipped.

### Follow-ups
- T-0110: wire `topicId` through the production announcer in `index.ts` (cards still go to General until then).
- Room reconciliation for drift after failed room calls is still a follow-up (see T-0108).
- A topic owner AI is only checked to exist (T-0108 strip); tighten to AIs in the topic.
