---
id: T-0110
title: Approvals, "always allow" rules and tools are scoped to a topic (AI + topic), not to a whole group
status: planned
milestone: M5
branch: task/T-0110-topic-scoped-actions
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108, T-0109]
estimate: 2 days
---

# T-0110: Topic-scoped approvals, rules and tools

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-09-29): "approve always needs to be associated with the chat ... and apply only to that chat". Once a group is a list of topics, **the chat is the topic**. So the scope of everything the action pipeline stores becomes `(AI, topic)`: an approval card lives in the topic where it was requested, an "Always allow here" rule applies only in that topic, and a tool made in a topic belongs to it. A private topic also means that an approval must never be visible to someone who cannot see the topic.

Scope after this task: **personal chat** = `group_id null, topic_id null`; **group chat** = `group_id` and `topic_id` both set (General is a topic, so the old group scope maps to the group's General topic).

### What changes
1. **Schema** (only via `pnpm --filter @galena/server db:generate`, plus one custom data migration `--custom --name=topic-scope-backfill`): add nullable `topic_id` (fk `topics`, on delete cascade) to `approvals`, `pending_actions`, `approval_rules` and `ai_tools`. Backfill every existing row with a `group_id` to that group's General topic. Add a CHECK per table: `(group_id is null) = (topic_id is null)`. Rebuild the partial unique indexes: rules unique on `(ai_id, topic_id, action)` where active and `topic_id is not null` (personal rule index unchanged); tools unique on `(ai_id, topic_id, name)` where not deleted and `topic_id is not null` (personal unchanged).
2. **Gateway** (`actions/gateway.ts`, `RequestParams`): `groupId` stays and a `topicId?` joins it; a request with a `groupId` must carry a `topicId` that belongs to that group and to a room the AI is a member of (`topic_ais` or General via `group_ais`), else `denied: ai_not_in_group` (the existing enum value; extend its wording in `agents/gateway.ts` to "the AI is not in that topic"). Store `topic_id` on the approval and the pending action. The rule lookup is exact on `(aiId, topicId, action)`. The announcer posts the card and the outcome notice into **that topic's room** (T-0109 `postToChat` with `topicId`).
3. **`request_action` plumbing** (`agents/gateway.ts`, `agents/tools.ts`, `agents/reply.ts`): the room the turn came from gives `groupId` and `topicId` (never the model). The T-0098 gate stays: sender must be a group owner/admin **and** a member of the topic.
4. **Approvals visibility** (`approvals/service.ts`, `routes.ts`): `canDecide`, the list, the single read and the decision all additionally require `canSeeTopic` when the approval has a `topic_id`. A group admin who cannot see a private topic gets 404 for its approvals, does not count them in the pending badge (`GET /api/approvals` list), and cannot decide them. The AI owner keeps deciding only while they can see the topic. Public approval JSON gains `topicId` and `topicName` (name omitted, `null`, if the viewer cannot see the topic, which cannot happen for a returned row; keep the field for the client).
5. **"Always allow" rules** (`approvals/rules.ts`, routes): scope is `(AI, topic)`. Creating a rule in a topic needs the group-admin check from T-0101 **and** topic visibility. `GET /api/groups/:id/approval-rules` returns the rules of topics the viewer can see; rows carry `topicId`, `topicName`. `GET /api/ais/:id/approval-rules` (AI owner) returns rules of topics the owner can see. Revoke: the AI owner or a group admin, each only for topics they can see. Removing an AI from a topic revokes its rules in that topic (extend the topic-AI removal from T-0109); archiving a topic does not delete rules but they cannot fire (the AI leaves the room).
6. **Tools** (`tools/service.ts`, `routes.ts`, T-0103): same scope change. `saveToolVersion`, `listTools`, `findActiveTool`, limits (20 tools per `(AI, topic)`), routes: reader = AI owner who can see the topic, or a member of the topic; manager = AI owner who can see the topic, or a group owner/admin who can see the topic. `GET /api/groups/:id/tools` lists only tools of topics the viewer can see; add `GET /api/topics/:id/tools`. `deleteToolsForAiInGroup` becomes `deleteToolsForAiInTopic` plus a group-wide variant used by `removeGroupAi`. Audit rows for tools/rules/approvals in a private topic carry ids only (no topic name).
7. **Existing specs that were written against the old scope** (`work/T-0104`, `T-0105`, `T-0106`, `T-0107`) will be adapted by the lead; do not touch them.

### Read first
- `AGENTS.md`; `work/T-0108` and `T-0109` (Specs, Reports, Reviews) and their code
- `work/T-0099-approval-rules-always-allow.md`, `T-0101-group-always-admin-only.md`, `T-0103-ai-tools-store.md` (Specs + Reviews: the scope model you are changing), `T-0098`
- `apps/server/src/actions/gateway.ts`, `approvals/{service,routes,rules}.ts`, `tools/{service,routes}.ts`, `groups/service.ts`, `agents/gateway.ts` (`runRequestAction`), `actions/flow.e2e.test.ts` (HTTP-level scenarios: extend them, do not weaken them)

### Allowed files
- `apps/server/src/actions/**`, `apps/server/src/approvals/**`, `apps/server/src/tools/**`, `apps/server/src/topics/**` (only what they need), `apps/server/src/groups/service.ts` (+ tests)
- `apps/server/src/agents/{gateway,reply,tools}.ts` (+ tests) for the topic plumbing
- `apps/server/src/db/schema.ts` + generated and custom migrations
- `apps/server/src/audit/**`, `authz-sweep.test.ts`
- `apps/server/src/index.ts` (only the production announcer wiring below)
- `work/T-0110-topic-scoped-actions.md`

**Not allowed:** web, mobile, the sandbox, the routines scheduler (T-0104), dependencies.

### Tests (Vitest, PGlite, fakes; extend `flow.e2e.test.ts`)
- Migration: rows made before the migration end up scoped to their group's General topic; the CHECK constraints reject a row with only one of the two ids.
- Scope: a rule created in topic A does **not** fire in topic B of the same group, fires in A, and never in the personal chat; the same for tools (same name in two topics = two tools).
- The card and the outcome notice are posted into the topic room (assert on the fake announcer's `topicId`). **T-0109 added an optional `topicId` to the announcer port and to `postToChat` in the gateway, but the production announcer built in `index.ts` still ignores it (cards go to General or the DM). Wire it through in this task**: the announcer passes `topicId` to `gateway.postToChat`, and a test proves an approval card requested in a topic is posted into that topic's room, not General.
- Private topic: a group admin who is not in it gets 404 on its approval, the list omits it, the pending count excludes it, `decide` answers 404, the rules and tools lists omit it; the AI owner who was removed from the topic loses decision rights; audit rows contain no topic name.
- A request naming a topic the AI is not a member of → `denied`; a topic of another group → `denied`; a stopped AI → `denied` as before.
- The T-0101 rule still holds per topic (member-owner cannot create a rule, gets 403 and can still approve once).
- Every existing test in these areas is updated to the new scope and still asserts what it asserted before.

### Acceptance criteria
- [ ] Nothing stored by the action pipeline can be read, decided or fired outside the topic it belongs to, and nothing of a private topic leaks to someone who cannot see it.
- [ ] Old data keeps working (backfilled to General); personal chats are unchanged.
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
- UI, routines (T-0104 is adapted after this), sandbox changes, usage or cost tracking.

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
