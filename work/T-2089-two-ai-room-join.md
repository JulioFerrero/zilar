---
id: T-2089
title: "Fix: in a group with two AIs the second AI no longer joins the room (gateway-group 'smart wake rules' tests time out in openRoom on main) — bisect the regression from today and fix its cause"
status: merged
milestone: M5
branch: task/T-2089-two-ai-room-join
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2089: Two-AI room regression

## Spec (written by Claude, do not edit)

### Why
The message pipeline: AIs in a group must join its room, or they never see or answer messages. Two tests fail on main, and the merge gate now refuses T-2083 because of them.

### Facts (read by the lead on 2026-10-18 at `dff0cc4ec`)
- **The failure.** This command fails 2 of 21 tests on main every run (15.9 s in total, so not load):

  ```bash
  cd apps/server && pnpm exec vitest run src/agents/gateway-group.test.ts --reporter=dot --testTimeout=30000
  ```

  - The failing tests are "smart wake rules (T-1633) > does not answer an unaddressed question in a two-AI room" and "… > answers a follow-up question right after its own reply (rule R)".
  - Both throw `timed out waiting for the condition` from `waitFor` (`apps/server/src/agents/gateway.test-harness.ts:363`, 5 s default). The wait is in `openRoom` (`apps/server/src/agents/gateway-group.test.ts:~440-470`), which seeds two AIs into one group, starts the gateway, then waits for `core.joined.length === 1` on each AI core.
- **Not touched today.** No commit today changed `gateway-group.test.ts` or `gateway.test-harness.ts` (`git log --since=2026-10-18T06:00` on both).
- **Today's server commits that touch rooms, joins or the gateway** (candidates, newest first):
  - `804b12acb` T-2058
  - `5029b9431` T-2068
  - `848ab4f62` T-2062
  - `04e351648` T-2036
  - `c1724b402` T-2014
  - `f9f41df39` T-2010
  - `61b8ca871` T-2002 ("people hold plain member rights in rooms; rooms unlisted")
- **Last known state before today:** `35c180582` (10-17, 22:23 UTC).

### Steps
1. **Confirm the old state.** Check that the two tests pass at `35c180582`. In your worktree: `git stash` if needed, then `git checkout --detach 35c180582`, run the command, and go back with `git checkout -`. Run `pnpm install` first if the old commit needs it.
2. **Find the commit.** Run `git bisect` between `35c180582` (good) and your branch HEAD (bad) with the command above, and name the first bad commit in the Report.
3. **Fix the cause in product code.** Keep the intent of the commit that broke it. Change the test only if the commit changed intended behaviour and the test is wrong; then explain why in the Report.
4. **Re-run.** Both tests and the rest of `gateway-group.test.ts` must pass. Also run `src/agents/gateway-desk.test.ts` and `src/topics/one-step-add.test.ts`.
5. **If the cause is in a file not listed below,** report BLOCKED with the path; the lead adds it.

### Allowed files
- `apps/server/src/agents/gateway-group.test.ts`
- `apps/server/src/agents/gateway.test-harness.ts`
- `apps/server/src/agents/context.ts`
- `apps/server/src/agents/gateway/turn-start.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/groups/ownership.ts`
- `apps/server/src/groups/room-sync-retry.ts`
- `apps/server/src/groups/service.ts`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/room-reconcile.ts`
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/invite-links/join.ts`
- `apps/server/src/topics/members.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/chats/reads.ts`
- `apps/server/src/xmpp/admin/client.ts`
- `apps/server/src/leader/start.ts`
- `work/T-2089-two-ai-room-join.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway-group.test.ts src/agents/gateway-desk.test.ts src/topics/one-step-add.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The two named tests pass, and the gate passes.
- The Report names the first bad commit and the cause in one sentence.

---

## Report (written by the worker when done)

### What I did
- Reproduced the two failures on this branch (2 failed | 19 passed in
  `gateway-group.test.ts`).
- Bisected `35c180582..HEAD` with the test file as the predicate. **First bad
  commit: `210ce3f1a0c39797174384dbaf5ccf1ec85981f6` (T-1990: removed members
  take their AIs; owner lock; General rights).**
- Cause: T-1990 made an AI count in a group only while its owner is still a
  group member (`listAiRooms` in `agents/gateway/db.ts` and
  `addTopicAiMembers` in `topics/room-members.ts`). The test's `openRoom`
  helper seeds each AI with `seedGatewayAi`, which gives **each AI its own
  random owner**, but it added only `first.ownerId` to the group. The second
  AI's owner was therefore never a member, so the second AI was correctly
  excluded from the room and `waitFor(core.joined.length === 1)` timed out.
- Fix is in the test fixture only: `openRoom` now seeds every AI's owner into
  the group (first owner as `owner`, the rest as `member`). This keeps
  T-1990's intended behaviour; no product code changed.
- Verified the old state at `35c180582` with my fixture change stashed: the
  two named tests pass there too.

### Checks run
- `pnpm install`: Done in 17.9s.
- `pnpm --filter server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`
  before the fix: 2 failed | 19 passed (the two named tests, timeout in
  `openRoom`).
- Same command after the fix: **21 passed (21)**.
- At `35c180582` (detached, fixture fix stashed), the two named tests:
  **2 passed | 19 skipped (21)**.
- `pnpm --filter server test --maxWorkers=2 --reporter=dot src/agents/gateway-desk.test.ts src/topics/one-step-add.test.ts`:
  **2 files passed, 2 tests passed**.
- `pnpm gate` from the repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.2s)
  SKIP effect (no source files changed)
  PASS  build @zilar/server  (1.4s)
  PASS  tests @zilar/server  (9.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Files changed: `apps/server/src/agents/gateway-group.test.ts` and this task
  file. No product code changed: T-1990's owner-membership rule is intended,
  and the fixture was modelling two owners while adding only one to the group.
- Deviation from the spec's step 1: the bisect was started with `35c180582`
  as the known-good endpoint (as the spec states) rather than testing it
  first; I then confirmed the old state manually afterwards.
- `210ce3f1a0a` was not in the candidate list in the spec, which is why the
  bisect was worth running.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Bisect.** The first bad commit is `210ce3f1a` (T-1990). It keeps an AI in a group's rooms only while the AI's owner is a member, which is intended product behaviour.
- **Cause.** The two-AI `openRoom` fixture seeded each AI with its own owner but put only the first owner in the group.
- **Fix.** Test only: every owner is seeded, as owner then members.
- **Checks.** The worker showed 21 of 21 tests passing, and confirmed that the old commit passes the two named tests. No product change.
