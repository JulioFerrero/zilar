---
id: T-1492
title: "AIs count as members everywhere (Julio, 2026-10-15): the server and the mock add group AIs to group counts and topic AIs to private-topic counts; web's topic panel adds the AIs it lists"
status: merged
milestone: M5
branch: task/T-1492-ais-count-as-members
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1492: AIs count as members

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-15 that AIs count as members everywhere, as Telegram counts bots. Today the counts disagree:
- a group header says "5 members" for 4 people plus Dev-1, because `chatSubtitle` takes the larger of the member and online counts (T-1483);
- the topic panel says "All 4 members of Dev team".

The joining capacity check already counts AIs (`apps/server/src/invite-links/join.ts:198-218`).

### The rule
- **A group's count** is its `group_members` rows plus its `group_ais` rows.
- **A public topic** (anything not `private`) has the count of its group.
- **A private topic** has its distinct people, counted as today, plus its `topic_ais` rows.
- Role counts (`roles/queries.ts:149`, `topics/views.ts:264`) stay people only: they count role holders, not members.

### Facts (the lead read them on main, 2026-10-15)
- **Server, which counts only `group_members` today:**
  - `apps/server/src/groups/queries.ts:217-224`: the `counts` query, grouped by `group_id`, feeds `memberCount` at `:256` (the chat list, via `apps/server/src/chats/api.ts:198,208`). The file has 358 lines.
  - `apps/server/src/directory/service.ts:266-280`: `countMembers`, used at `:148` and `:242`.
  - `apps/server/src/invite-links/queries.ts:208-218`: `countGroupMembers`, whose only caller is the invite preview at `apps/server/src/invite-links/join.ts:43`.
  - **`apps/server/src/topics/views.ts`** (325 lines):
    - `countTopicMembers` (`:13-40`) counts `group_members` for a public topic, and topic members plus role holders for a private one;
    - the batch `loadTopicViewParts` (`:163-…`) sets `memberCounts` at `:269-279` (`groupMembers.size` for public, `ids.size` for private);
    - the batch already loads each topic's AIs into `aisByTopic` (`:239`), but no `group_ais` counts.
- **Mock, which mirrors the server:**
  - `packages/mock-backend/src/domains/topics/view.ts:31-37`: a private topic counts people only; a public topic uses `source.groupMemberCount`, which is `members.length` at `:62`;
  - `packages/mock-backend/src/domains/groups/routes.ts:139`: `const memberCount = group.members.length;`
- **Web:** `apps/web/src/components/TopicPanel.tsx:124` and `:147` count `info.members.length`. `info.ais` is at hand (`:103`). `GroupPanel.tsx:47-48` already adds `info.ais.length`.

### What to build
1. **Server:** apply the rule at each place above.
   - In `groups/queries.ts` and `directory/service.ts`, add a second grouped count over `group_ais`, or one query that sums both; then add the totals per group.
   - `countGroupMembers` adds the `group_ais` count for the group.
   - `countTopicMembers`:
     - a public topic is the group's people plus the group's AIs;
     - a private topic adds `SELECT count(*) FROM topic_ais WHERE topic_id = …`.
   - `loadTopicViewParts` adds one `group_ais` count per group to its `Effect.all` (`IN groupIds`, `GROUP BY group_id`).
     - A public topic is `groupMembers.size` plus that count.
     - A private topic is `ids.size + (aisByTopic.get(topic.id)?.length ?? 0)`.
   - Keep every file at most 400 lines.
2. **Mock:**
   - `groupMemberCount` and `groups/routes.ts:139` add `group.ais.length`;
   - a private topic in `topics/view.ts` adds `topic.aiIds.length`.
3. **Web `TopicPanel.tsx`:** `:124` and `:147` use `info.members.length + info.ais.length`.
4. **Tests:** no new tests (member counts are not crucial code). Run the existing tests in the Checks. Where an assertion changes only because AIs are now counted, update its number and write the reason in the Report. A failure for any other reason means stop and report it.

### Allowed files
- `apps/server/src/groups/queries.ts`
- `apps/server/src/directory/service.ts`
- `apps/server/src/invite-links/queries.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/groups/visibility.test.ts`
- `apps/server/src/invite-links/invite-links.test.ts`
- `apps/server/src/topics/visible-batch.test.ts`
- `packages/mock-backend/src/domains/topics/view.ts`
- `packages/mock-backend/src/domains/groups/routes.ts`
- `apps/web/src/components/TopicPanel.tsx`
- `work/T-1492-ais-count-as-members.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/visibility.test.ts src/invite-links/invite-links.test.ts src/topics/visible-batch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead, headless web `?mock=1`:**
  - Dev team › General: the header and the topic panel both say 6 (4 people, Dev-1 and QA-1);
  - the Dev team row's topic count is unchanged.
- **After the deploy, the lead calls each changed route live:** `/api/chats`, a topic list and the invite preview answer 200 with numbers.

---

## Report (written by the worker when done)

### What I did

AIs now count as members everywhere the rule applies; role counts stay people only.

**Server**
- `apps/server/src/groups/queries.ts` (`listGroupsForUser`): the `counts` query now counts `group_members` `UNION ALL` `group_ais` per group (one grouped query), so the chat list's `memberCount` includes AIs.
- `apps/server/src/directory/service.ts` (`countMembers`): same `UNION ALL` sum, so the Explore directory and by-handle entry count AIs.
- `apps/server/src/invite-links/queries.ts` (`countGroupMembers`): the total is `count(group_members) + count(group_ais)` for the group; this feeds the invite preview.
- `apps/server/src/topics/views.ts`:
  - `countTopicMembers`: a public topic is `group_members + group_ais`; a private topic is its distinct people (direct + role holders, as before) plus `count(topic_ais)`.
  - `loadTopicViewParts`: added one `group_ais` count per group (`IN … GROUP BY group_id`) to its `Effect.all`; a public topic is `groupMembers.size + groupAiCount`, a private topic is `ids.size + aisByTopic.get(topic.id)?.length`.
  - Role `memberCount` (`views.ts:281`) is untouched: people only.

**Mock (mirrors the server)**
- `packages/mock-backend/src/domains/topics/view.ts`: `groupMemberCount` is now `members.length + ais.length`; a private topic adds `topic.aiIds.length`.
- `packages/mock-backend/src/domains/groups/routes.ts` (`chatEntryOf`): `memberCount = group.members.length + group.ais.length`.

**Web**
- `apps/web/src/components/TopicPanel.tsx`: added a `memberCount` local (`info === undefined ? chat.memberCount ?? 0 : info.members.length + info.ais.length`, the same expression as `GroupPanel`) and used it in the header suffix and the "All N members of …" note, so both show people + AIs.

### Checks run

- `pnpm install` — succeeded (Done in 12.1s).
- `pnpm --filter @zilar/server exec vitest run src/groups/visibility.test.ts src/invite-links/invite-links.test.ts src/topics/visible-batch.test.ts --reporter=dot` — `Test Files 3 passed (3)`, `Tests 49 passed (49)`.
- `pnpm gate` — `GATE PASS`. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mock-backend  (1.6s)
  PASS  tests @zilar/server  (13.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed on `format` for `apps/server/src/topics/views.ts` (prettier wanted to wrap the `sql<{…}>` type argument); I ran `pnpm exec prettier --write` on that one file and the gate then passed. No other file was reformatted.

### Notes for the lead

- **No test assertion number needed changing.** None of the three test files seeds AIs into the groups/topics whose counts it asserts:
  - `apps/server/src/groups/visibility.test.ts` — the directory `memberCount` assertions (2 and 3) use groups with people only; its AI tests (`counts AIs toward the cap…`, `refuses a join when AIs alone fill the cap`) exercise the join cap, not member counts. `memberCount` there is the directory entry count.
  - `apps/server/src/invite-links/invite-links.test.ts` — the previewed group has the owner only (`memberCount: 1`), no AIs.
  - `apps/server/src/topics/visible-batch.test.ts` — asserts visible topic ids, not counts.
  So the three listed test files stayed unchanged (they are in the Allowed list but I did not edit them).
- I did **not** touch role counts (`roles/queries.ts`, `views.ts:281`) per the spec.
- Mock/acceptance check by inspection: Dev team General is a public topic in a group with 4 members + 2 AIs, so it now reports 6; the web panel uses `info.members.length + info.ais.length` = 6. The Dev team chat row's `chat.memberCount` is already 6 in the mock seed, so the header and panel will agree. Topic counts were not touched.
- I did not run the headless web check (the acceptance says that is the lead's); the counts above are by code inspection and the gate.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **The diff** follows the rule at every place in the spec:
  - group counts sum `group_members` and `group_ais` (`UNION ALL`, grouped);
  - a public topic counts the group's people and AIs;
  - a private topic adds its `topic_ais`;
  - the batch loader adds one grouped `group_ais` count;
  - the mock mirrors the server, and web's `TopicPanel` adds `info.ais.length`;
  - role counts are untouched.
- **Pre-review:** the packet was clean (0 of everything) for head `bacd113d0`.
- **Headless web `?mock=1`** (vite from this worktree), on Dev team › General:
  - the header reads "6 members, 5 online", and the topic panel reads "All 6 members" and "All 6 members of Dev team can read and write here";
  - the sidebar row still reads "7 topics";
  - no console errors.
- **Carried:** a WUX-44 line in `docs/audit/findings-sweep-client.md` (done by T-1435).

