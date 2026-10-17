---
id: T-1801
title: "Mock backend: public topics carry real members like the server (creator on create, Join adds you), and the seed leaves you out of one or two public topics so 'Other topics' and the Join preview show in mock mode"
status: merged
milestone: M5
branch: task/T-1801-mock-public-topic-members
model: auto
effort: default
depends_on: [T-1786]
estimate: 25 min
---

# T-1801: Mock public topic members

## Spec (written by Claude, do not edit)

### Why
On the server a public topic has real members (`docs/plan/topic-people.md` §2.5): you join it, and a new one starts with its creator. The mock still reads every public topic as "the whole group", so in mock mode "Other topics" is always empty. W7/W8 (the group screen) and W9/W10 (the Join preview) can't be seen there. T-1786's pre-review flagged it.

### Facts (read by the lead on 2026-10-17)
- **`packages/mock-backend/src/domains/topics/view.ts`** (136 lines). For a public topic:
  - `memberCount` is `source.groupMemberCount(topic.groupId)` (`:39-45`);
  - `memberIds` is `[...source.groupMemberIds(topic.groupId)]` (`:48-56`).
  - Private topics use `topic.memberIds` plus role holders.
- **`packages/mock-backend/src/domains/topics/seed.ts`** (171 lines): the `g-devteam` topics.
  - General is at `:19-31` (`isGeneral: true`).
  - These public topics all have `memberIds: []`: "Checkout button hidden on Safari" (`:39-51`), "New pricing page" (`:62-74`), "Daily standup" (`:81-93`), "Release 2.4 notes" (`:100-112`) and "Ideas" (`:138-…`).
  - The private "Hiring: frontend role" has `['u-you', 'u-ana']` (`:119-131`).
- **`packages/mock-backend/src/domains/topics/routes.ts`** (336 lines):
  - create gives a public topic `memberIds: []` (`:96-97`);
  - private → public resets to `[]` (`:142`);
  - the join route (T-1786) appends `data.me.id` (`:165-180`);
  - leave filters the leaver out, and archives only a private topic that drains (`:197-206`).

### Steps
1. **`view.ts`:**
   - for a public, **non-General** topic, `memberIds` is `topic.memberIds` and `memberCount` is `topic.memberIds.length + topic.aiIds.length`;
   - General keeps the whole group;
   - private is unchanged.
2. **`seed.ts`:**
   - give each public non-General topic the `g-devteam` member ids as `memberIds` (read them from the mock's group seed), so they stay joined;
   - **except "Ideas" and "Release 2.4 notes"**, which list everyone but `u-you`. They then appear under Other topics with Join.
3. **`routes.ts`:**
   - create gives a public topic `memberIds: [data.me.id]` (the creator);
   - private → public keeps the current members instead of `[]`.
4. **No tests** (mock data). Keep every file at most 400 lines.

### Allowed files
- `packages/mock-backend/src/domains/topics/view.ts`
- `packages/mock-backend/src/domains/topics/seed.ts`
- `packages/mock-backend/src/domains/topics/routes.ts`
- `work/T-1801-mock-public-topic-members.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In mock mode, the dev team group lists "Ideas" and "Release 2.4 notes" under Other topics with Join.
- Joining one moves it to Your topics.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `view.ts`: a public non-General topic now shows its own `memberIds` and counts
  `memberIds.length + aiIds.length`; General still shows the whole group, and a
  private topic is unchanged. `memberIds` and `memberCount` now come from one
  branch each, so they cannot drift.
- `seed.ts`: the Dev team member ids are read from `mockGroups` (`g-devteam`).
  Every public non-General topic starts with all four members, except "Ideas"
  and "Release 2.4 notes", which start with everyone but `u-you` (`u-ana`,
  `u-luis`, `u-marco`). Those two therefore land under Other topics with Join.
- `routes.ts`: create gives a public topic `memberIds: [data.me.id]`; private →
  public keeps the current members instead of clearing them.
- No tests added (mock data, as the spec says). No dependencies.

### Checks run
- `pnpm install`: done, 20.4s.
- One-off `tsx` check of `buildTopicView` over the Dev team seed (stub group
  source) printed:
  - General: 6 people, `u-you,u-ana,u-luis,u-marco` (whole group)
  - "Checkout button hidden on Safari": 5 (4 people + 1 AI)
  - "New pricing page": 4; "Daily standup": 4
  - "Release 2.4 notes": 3, `u-ana,u-luis,u-marco`
  - "Ideas": 3, `u-ana,u-luis,u-marco`
  - private "Hiring: frontend role": 2, `u-you,u-ana` (unchanged)
  So `isTopicJoined` (General or `memberIds` contains me) puts Ideas and Release
  under Other topics; joining appends `u-you` and moves them to Your topics.
- First `pnpm gate`: FAIL on format for `seed.ts`; ran `prettier --write` on that
  one file and reran.
- Final `pnpm gate`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Files changed: `packages/mock-backend/src/domains/topics/view.ts`,
  `seed.ts`, `routes.ts`, and this task file.
- Spec followed as written; no deviations, nothing blocked.

### Round: pre-review fixes
- **Finding 1 (should-fix) fixed.** `topicMembers` in `routes.ts` now returns the
  whole group only for a public General topic. A public non-General topic and a
  private topic both return `topic.memberIds`, which is the same set
  `buildTopicView` uses. `GET /topics/:id/members` therefore no longer includes
  `u-you` for "Ideas" / "Release 2.4 notes" before joining.
- **Finding 2 (nit) not touched.** General's seeded `memberIds: []` stays as it
  is: it is dead data only, and the nit was outside a line this round changes.
- **Tests: none added.** The Spec says "No tests (mock data)" and the Allowed
  files list no test file, so a new `topics/routes.test.ts` would be out of
  scope. I verified the behaviour with a one-off `tsx` script against
  `createMockBackend` (kept outside the repo, no file added):
  - General members endpoint: `u-you,u-ana,u-luis,u-marco`
  - "Ideas" view before join: `memberCount 3`, members `u-ana,u-luis,u-marco`
  - `POST /topics/t-devteam-ideas/join`: 200; members after:
    `u-ana,u-luis,u-marco,u-you`
  - created public topic view `memberIds` and members endpoint: both `u-you`
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot`:
  2 files passed, 7 tests passed.
- `pnpm gate` (final):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (3.6s)
  PASS  lint  (2.0s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.4s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Re-verified on the committed tree after the interrupted session:
  `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot`
  (2 files, 7 tests passed) and `pnpm gate` again (`PASS` install, format, lint,
  typecheck, effect; `GATE PASS`). No code changed since the fix commit.

### Round: lead fixes
- **Lead fix 1.** In `topicMembers` (`routes.ts`), the group branch is now
  `topic.isGeneral` alone; every other topic, public or private, maps its own
  `topic.memberIds` with `personName`. Before joining "Ideas" the endpoint
  therefore lists its 3 members; after joining, 4.
- **Lead fix 2.** General's seeded `memberIds: []` is unchanged, with a one-line
  comment in `seed.ts` noting that General's members come from the group.
- `pnpm gate` (final):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Disagreements
None about the findings; finding 1 was correct and is fixed.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `7f2f58f54`, after 2 autopilot rounds and one lead round.
- **The mock now models real public-topic members:**
  - the view, the members endpoint and the seed agree; only General holds the whole group;
  - "Ideas" and "Release 2.4 notes" leave out `u-you`, so they appear under Other topics with Join;
  - create starts a public topic with its creator;
  - private → public keeps the members.
- This makes W7/W8 and the W9/W10 Join preview visible in mock mode.
