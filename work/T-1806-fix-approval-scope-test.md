---
id: T-1806
title: "Fix main: approvals/rules.test.ts 'scope is exact' fails (topic B request returns denied, expected pending_approval) — bisect the breaking commit, then fix the code or the test so the approval scope rule holds"
status: merged
milestone: M5
branch: task/T-1806-fix-approval-scope-test
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1806: Approval scope test on main

## Spec (written by Claude, do not edit)

### Why
The lead ran the full server suite on main (`b24fc0e81` plus the merges held since) on 2026-10-17. 983 of 984 tests passed. One permissions test fails every run (it fails alone too):

```
FAIL src/approvals/rules.test.ts > approval rules service (T-0099) > end-to-end:
  approve_always then second request auto-runs (T-0099) > scope is exact: a rule
  for topic A does not fire in topic B, fires in A, never personal
AssertionError: expected 'denied' to be 'pending_approval'
❯ src/approvals/rules.test.ts:1132:33
```

The workers' gates run only the nearest tests, so this slipped through. It's in the permissions area, so the cause must be understood, not just silenced.

### Facts (read by the lead on 2026-10-17)
- **The test** (`apps/server/src/approvals/rules.test.ts:1085-1132`; `seedTopic` is local to it, at `:45`) seeds:
  - `topicB` with `seedTopic(context, group1.groupId, owner.id, { name: 'Topic B' })`;
  - a `topic_ais` row for the AI in topic B;
  - a rule for group1's General.
- It then calls `gateway.request({ aiId, groupId: group1.groupId, topicId: topicB, action: 'demo.echo', … })` and expects `pending_approval`. It gets `denied`.
- **Candidate commits:**
  - `70b6823e3` (T-1762, "topic reads: only General is everyone, behind a compat switch");
  - `ab2ad0cd0` (T-1757) and its revert `dfec87794`;
  - today's merges, `git log --oneline -30`.
- The topic membership rule is in `apps/server/src/topics/access.ts` (`canSeeTopic` `:81`, `isTopicMember` `:106`) and `apps/server/src/topics/public-compat.ts`.

### Steps
1. **Find the first failing commit** with `git bisect` (`git bisect run` on `pnpm exec vitest run src/approvals/rules.test.ts -t "scope is exact" --reporter=dot` from `apps/server`). Put the commit and the reason in the Report: what the request path checks now that makes it deny.
2. **Decide which side is wrong:**
   - **The test is stale:** if the new rule is intended (Julio's rule: a public topic includes only its members; General is everyone; an AI in a topic is a `topic_ais` row), fix the test's seed (for example, add the owner as a topic B member), so it still proves that a rule for topic A doesn't fire in topic B.
   - **The code is wrong:** if an AI that is in topic B (`topic_ais`) should reach the approval path there, fix the code in the smallest place and keep the other approval tests green.
   - Say which, and why, in the Report.
3. **Run** the whole `src/approvals/` folder and `src/topics/` tests, not only the one test, and paste the summary lines.
4. Keep every file at most 400 lines (tests are exempt).

### Allowed files
- `apps/server/src/approvals/rules.test.ts`
- `apps/server/src/approvals/service.ts`
- `apps/server/src/approvals/verify.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/approval-path.ts`
- `apps/server/src/actions/policy.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/ai-access.ts`
- `work/T-1806-fix-approval-scope-test.md`

If the fix belongs in a file not listed, stop and say which file in the Report.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/approvals src/topics --reporter=dot
pnpm gate
```

### Acceptance
- The failing test passes, with the cause named.
- The approvals and topics tests all pass.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

1. **Bisected the failure.** Reproduced it alone, then ran
   `git bisect run` between `dfec87794` (good) and `e64bcf10c` (bad) with
   `pnpm exec vitest run src/approvals/rules.test.ts -t "scope is exact"` from
   `apps/server`. First bad commit: **`70b6823e3` (T-1762, "topic reads: only
   General is everyone, behind a compat switch")**. No later commit changes the
   outcome; bisect also marked `9ff1e88f3` (T-1761) bad, but that is only an
   path. Bisect also tested `9ff1e88f3` (T-1761) and `b9714621a` (T-1764) as
   bad because they are descendants of `70b6823e3` and inherit the change;
   neither touches this path itself.
   The bisect log names `70b6823e3` as the first bad commit.

   **Why it denies:** T-1762 changed `allowedTopicAiIds` /
   `aiMayBeInTopic` (`apps/server/src/topics/ai-access.ts`) so that for every
   non-General topic, including a public one, a `topic_ais` row counts only
   while the AI's owner is a topic member (`topic_members`, a role holder) and
   still in the group. Before, a public non-General topic returned every active
   `topic_ais` AI. The request path is `gateway.request` →
   `runRequest` (`actions/decisions.ts`) → `isAiInTopic` (`actions/queries.ts`)
   → `allowedTopicAiIds`; with an empty `topic_members` for topic B that set is
   empty, so `policy` returns `denied` / `ai_not_in_group` before the approval
   path can park a card.

2. **Decided the test is stale, not the code.** The new rule is the intended
   one (Julio's rule: only General is everyone; every other topic, public
   included, owns its member list; an AI is in a topic through `topic_ais`
   plus its owner's membership). The test bypassed the topic service and
   inserted the topic with raw SQL, so it never got the `topic_members` rows
   the service writes for a new public topic (`initialPublicMemberIds`, which
   under the current compat switch seeds every group member). It therefore
   asserted the pre-T-1762 rule by accident.

3. **Fixed the seed, not the rule** (`apps/server/src/approvals/rules.test.ts`,
   the `scope is exact` test only): after `seedTopic` it now also inserts the
   owner into `topic_members` for topic B, next to the existing `topic_ais`
   row, and the comment says why. The test still proves the exact-scope rule:
   the rule on group 1's General does not fire in topic B, does not fire in
   group 2's General, does not fire in a personal chat, and still auto-runs in
   group 1's General.

No production code changed; no other files touched.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/approvals/rules.test.ts -t "scope is exact"` (before the fix):
  1 failed | 29 skipped, `expected 'denied' to be 'pending_approval'` at
  `rules.test.ts:1132`. After the fix: **1 passed | 29 skipped**.
- `pnpm exec vitest run src/approvals src/topics --maxWorkers=2 --reporter=dot`
  from `apps/server` (the spec check, plus the AGENTS.md worker cap):
  **Test Files 13 passed (13), Tests 120 passed (120)**, 26.60s.
- `pnpm gate` from the repo root:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (3.7s)
SKIP effect (no source files changed)
PASS  tests @zilar/server  (8.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The two changed files are `apps/server/src/approvals/rules.test.ts` (inside
Allowed files) and `work/T-1806-fix-approval-scope-test.md` (inside Allowed
files).

### Notes for the lead

- The cause is the intended T-1762 rule, so the test was stale. Worth knowing
  that any other test or fixture that creates a non-General topic with raw SQL
  and then expects AI-in-topic access must seed `topic_members` too; the
  service-created path already does.
- `git bisect` ran with the repo's shared `node_modules` (no reinstall per
  commit); the lockfile did not change across the range, and each step was a
  real vitest run, so the result is reliable.
- No production code was touched, so no security-relevant surface changed.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `a9c67509f`.
- **The bisect** names T-1762 (`70b6823e3`): `allowedTopicAiIds` counts a non-General topic's `topic_ais` AI only while its owner is a topic member. That is Julio's intended rule.
- **The fix:** the test inserted topic B with raw SQL and no `topic_members` rows, so it was stale. The seed now adds the owner, and the test still proves exact rule scope (B ≠ A, the other group, personal).
- No production code changed.
- **Lesson:** the nearest-tests gate missed this for a day, so the lead runs the full server suite on quiet stretches.
