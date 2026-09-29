---
id: T-0109
title: AIs in topics: an AI reads and answers only in the topics it was added to
status: planned
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
