---
id: T-0110
title: Approvals, "always allow" rules and tools are scoped to a topic (AI + topic), not to a whole group
status: merged
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
- Schema (`db/schema.ts`, via `db:generate` only): added nullable `topic_id` (fk `topics`, cascade) to `approvals`, `pending_actions`, `approval_rules`, `ai_tools`; CHECK per table `(group_id IS NULL) = (topic_id IS NULL)`; rules unique index rebuilt as `(ai_id, topic_id, action)` active+topiced (personal index unchanged); tools unique index rebuilt as `(ai_id, topic_id, name)` active+topiced (personal unchanged). Migration `0021` (columns, FKs, new indexes) + custom `0022_topic-scope-backfill` (backfill group rows to General, then CHECKs; idempotent re-runnable). CHECKs live in 0022, not 0021, so pre-T-0110 group rows migrate cleanly (I edited the generated 0021 to drop its CHECKs).
- Gateway (`actions/gateway.ts`): `RequestParams` gains `topicId?`; a group request without a valid topic (missing, foreign group, archived, non-General without a `topic_ais` row, General without `group_ais`) is `denied: ai_not_in_group`. Rule lookup exact on `(aiId, topicId, action)`. `topic_id` stored on approval + pending rows. All card/outcome announcements carry `topicId`.
- `agents/gateway.ts`: `RequestActionContext` carries `topicId` from the room subscription into `actions.request`; T-0098 gate unchanged; `ai_not_in_group` model wording extended to "the AI is not in that topic".
- Approvals (`service.ts`, `routes.ts`): `canDecide`/list/read/decide require `canSeeTopic` for topiced rows (blind admin = 404, omitted from list/badge, cannot decide; removed AI owner loses rights). Public JSON gains `topicId`/`topicName` (name only for visible topics). Group rules route lists per visible topic; AI route filters to visible topics; revoke gated on visibility for owner and admin. `approve_always` rule inherits the approval's topic.
- Rules (`rules.ts`): `CreateRuleInput`/`findActiveRule` take `topicId`; new `listActiveRulesForTopic` (rows) + `toPublicRule` exported; new `revokeActiveRulesForAiInTopic`; group-wide revoke kept for `removeGroupAi`.
- Tools (`service.ts`, `routes.ts`): `SaveToolVersionInput`/`listTools`/`findActiveTool`/limit keyed on `topicId` (limit stays 20, now per `(AI, topic)`); new `deleteToolsForAiInTopic` + group-wide variant for `removeGroupAi`; reader/manager = AI owner / topic member / group admin, each only with topic visibility; `GET /api/groups/:id/tools` filters to visible topics; new `GET /api/topics/:id/tools`; `GET /api/ais/:id/tools` filters to visible topics; public JSON gains `topicId`. Audit details unchanged (never carried topic names).
- `topics/service.ts` `removeTopicAi`: revokes the AI's rules + deletes its tools in that topic (personal rows unaffected).
- `index.ts`: inline announcer extracted to `actions/production-announcer.ts` (`createProductionAnnouncer`, same behaviour + topic room resolution); `index.ts` now only wires it. Card payload `room` = the topic room; `postToChat` gets `topicId`.
- Tests: extended `flow.e2e.test.ts` (topic card/outcome topicId, per-topic T-0101, rule fires in A not B), gateway tests (denied cases incl. archived topic, announcer topicId, stored rows), rules/service/routes tests (scope exactness, CHECK violations, two-topics-same-action), private-topic visibility blocks for approvals/rules/tools routes, topic-AI removal cleanup, new `approvals/topic-scope-backfill.test.ts` (SQL replay: backfill to General + CHECK rejects half rows), new `actions/production-announcer.test.ts` (card into topic room not General, General room, DM, silent when gateway absent). Updated `backfill.test.ts` exclusions, groups/topics fixtures to the new scope.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0021_eager_dark_beast.sql`, `apps/server/drizzle/0022_topic-scope-backfill.sql` (+ meta snapshots/journal)
- `apps/server/src/actions/gateway.ts`, `actions/production-announcer.ts` (new), `apps/server/src/index.ts`
- `apps/server/src/approvals/service.ts`, `approvals/rules.ts`, `approvals/routes.ts`
- `apps/server/src/tools/service.ts`, `tools/routes.ts`
- `apps/server/src/topics/service.ts`, `apps/server/src/agents/gateway.ts`
- Tests: `actions/{gateway,flow.e2e,announce,production-announcer}.test.ts`, `approvals/{service,rules,rules.routes,routes,topic-scope-backfill}.test.ts`, `tools/{service,routes}.test.ts`, `topics/{topics,backfill}.test.ts`, `groups/groups.test.ts`
- `work/T-0110-topic-scoped-actions.md` (status + this report)

### Commands run and real results
- `pnpm install`: pass (6.6s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (turbo 10/10)
- `pnpm --filter @galena/server test --maxWorkers=2`: 66 files passed, 5 skipped; 1139 passed, 7 skipped (~242s, final code)
- `pnpm build`: pass (2/2 turbo tasks)
- Scoped runs while iterating: approvals (service+rules+rules.routes+routes+sweeper) 86 passed; actions gateway+announce 51 passed; flow.e2e 12 passed; tools service+routes 61 passed; agents gateway 114 passed; topics+groups+backfill 62 passed; topics.test 32 passed; production-announcer+announce 14 passed; migration backfill 1 passed.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|any<` in all touched non-test source: no hits (4 prose "any" matches only).

### Problems, deviations from the spec, open questions
- The generated `0021` bundled the CHECKs with the column adds, which would fail on pre-T-0110 group rows; I moved the CHECKs into the custom `0022` (backfill first, constraints second). Schema file, journal and snapshots are consistent; the 0022 `DO` blocks make it re-runnable.
- `findActiveRule`/`CreateRuleInput` keep a `groupId` field (stored on the row, used by the group-wide revoke and the `always_requires_admin` gate) but match on `topicId`; personal scope matches on `topicId IS NULL`.
- `listDecidableApprovals` re-checks `canDecide` per row (extra queries) so blind admins never count private rows in the badge; acceptable N+1 in line with existing code.
- The production announcer was extracted to `actions/production-announcer.ts` so the "card goes to the topic room" behaviour is unit-testable; `index.ts` only wires it (allowed: "only the production announcer wiring").
- T-0104/T-0105/T-0106/T-0107 untouched as instructed. No new dependencies, no `any`, no disable comments.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** Approved and merged.

### Findings
- Read twice (security code). Scope is now (AI, topic) everywhere: `topic_id` on approvals, pending actions, rules and tools with a per-table CHECK `(group_id IS NULL) = (topic_id IS NULL)`; unique indexes rebuilt per (AI, topic); custom migration `0022` backfills every group row to the group's General topic first and adds the CHECKs second (idempotent, safe on data that predates topics). The action gateway denies a group request that carries no topic, a topic of another group, an archived topic, or a topic the AI is not in; rule lookup is exact on (AI, topic, action); all cards and outcomes go to the topic room through the extracted, tested production announcer (this closes the T-0109 follow-up).
- Visibility holds: a group admin who cannot see a private topic gets the same 404 as a missing id for its approvals, rules and tools, and its rows are left out of lists and the pending badge; an AI owner who lost access to a private topic loses decide, revoke and read rights on its rows; removing an AI from a topic revokes its rules and deletes its tools there.
- Lead fix: `isAiInTopic` now uses the T-0109 derived rule (`allowedTopicAiIds`), so in a private topic an AI whose owner is no longer a member cannot raise requests either (defence in depth; the AI is also out of the room).
- Checks: format, lint, typecheck pass; the lead re-ran approvals, actions, tools, agent gateway, topics, groups and authz-sweep: 21 files, 478 tests passed; the worker's full server suite (before the lead fix) 1139 passed, 7 skipped.

### Follow-ups
- An approval that is still pending when the AI is removed from its topic (or group) can still run if a human decides later; cancelling pending actions on removal is a small hardening task.
- T-0104 (routines) and T-0105 (tool actions) must use `topicId` from the request context.
- `listDecidableApprovals` and the visibility helpers query per row (N+1); fine at current sizes.
