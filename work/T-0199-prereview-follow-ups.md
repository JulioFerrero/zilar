---
id: T-0199
title: Lead tooling: pre-review findings outside the task's Allowed files are follow-ups, not fix rounds
status: planned
milestone: M5
branch: task/T-0199-prereview-follow-ups
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0198]
estimate: 0.5 day
---

# T-0199: Pre-review findings outside the task's scope are follow-ups

## Spec (written by Claude, do not edit)

### Why
On 2026-10-04 the pre-review of T-0198 found a real problem in `switch-model.ts`, a file outside that task's Allowed files, and rated it should-fix. The autopilot then sent it back to the worker twice (`AUTOFIX ... round 1` and `round 2`). The worker correctly refused both times, because it may not touch that file, so both rounds were wasted. A finding the worker is not allowed to fix must go to the lead, who either widens the spec or writes a new task.

### Verified facts (do not re-derive)
- The pre-review prompt asks for `Counts: must-fix=N, should-fix=N, nit=N` (`packages/devtools/prompts/prereview.md` line 20).
- `extractCounts` parses that line (`packages/devtools/src/lead/autopilot.ts` line 43) into `FindingCounts { mustFix, shouldFix, nit }` (`packages/devtools/src/lead/decide.ts` line 13).
- `decide` starts an automatic fix round when `mustFix + shouldFix > 0` and rounds are below `AUTOFIX_LIMIT`; `packetTag` (`decide.ts` line 72) builds the `[CLEAN ...]` or `[NEEDS LEAD ...]` tag of the PACKET READY line.

### What to build
1. `prereview.md`: add a fourth severity, **follow-up**: a finding whose fix needs a file outside the task's Allowed files. It is listed in its own "Follow-ups" section and is never counted as must-fix or should-fix, however serious. The Counts line becomes exactly `Counts: must-fix=N, should-fix=N, nit=N, follow-up=N`.
2. `FindingCounts` gains `followUp: number`. `extractCounts` reads the fourth number and treats it as `0` when an older review has only three. Keep accepting the spacing and bold variants it accepts today.
3. `decide`: follow-ups never start an automatic round. When the packet goes to the lead and `followUp > 0`, the tag says so: `[CLEAN, nit 2, follow-up 1]` or `[NEEDS LEAD ...: must-fix 0, should-fix 1, follow-up 1]`.
4. Tests: `extractCounts` with four numbers and with three (old format); `decide` with only follow-ups (no auto round, tag `[CLEAN ... follow-up N]`); with should-fix plus follow-ups (an auto round still starts for the should-fix); the prompt renders with the new Counts line (`prompts.test.ts` style).

### Read first
`AGENTS.md`, `packages/devtools/prompts/prereview.md`, `packages/devtools/src/lead/autopilot.ts` (`extractCounts`), `decide.ts` (`FindingCounts`, the review block of `decide`, `packetTag`), `decide.test.ts`, `autopilot.test.ts`.

### Allowed files
`packages/devtools/prompts/prereview.md`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/autopilot.test.ts`, `packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/decide.test.ts`, `packages/devtools/src/lead/prompts.test.ts`, `work/T-0199-prereview-follow-ups.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead
pnpm gate
```

### Acceptance
- A review with only follow-ups produces no AUTOFIX line and a PACKET READY tag that names the follow-ups.
- Old three-number Counts lines still parse.
- `pnpm gate` ends with GATE PASS.

### Out of scope
Creating tasks from follow-ups automatically, any change to the worker prompt.

---

## Report (written by the worker when done)

## Review (written by Claude)
