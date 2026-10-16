---
id: T-1640
title: "Scheduled AI jobs step 7: the tool guide tells the model to use the time zone shown in its prompt for schedule.timezone, so 'every morning at 8' fires at the person's own 8 o'clock"
status: merged
milestone: M5
branch: task/T-1640-routine-timezone-guide
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1640: Routine time zone line in the tool guide

## Spec (written by Claude, do not edit)

### Why
The plan `docs/plan/scheduled-ai-jobs.md` §2.7 (T-1614) covers this.
- **Already in place:** the prompt shows the current time with the person's IANA zone, for example "Thursday, 15 October 2026, 04:12 (Europe/Madrid)" (`apps/server/src/agents/prompt-time.ts:9`, T-1440). A daily schedule stores `timezone` (`apps/server/src/routines/schedule.ts:50-68`).
- **Missing:** the tool guide never says which zone to use, so the model may pick UTC.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/agents/tool-guide.ts`** (71 lines): `TOOL_GUIDE_LINES` is at `:8-19`.
- **Line `:17`** is `'Schedule a routine only when the user asked for something recurring. Describe the schedule in plain words (for example "every morning at 9") and let the approval card show the hosts.'`
- **`TOOL_GUIDE_MAX_CHARS = 6000`** is at `:6`.

### Steps
1. **Append one sentence to the line at `:17`** (keep it one array entry):
   ` For \`schedule.timezone\`, use the IANA time zone shown next to the current time in your prompt, unless the user named another one.`
2. **Change nothing else.** No tests: this is fixed prompt text.

### Allowed files
- `apps/server/src/agents/tool-guide.ts`
- `work/T-1640-routine-timezone-guide.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The guide line includes the time-zone sentence,** and the gate passes.

---

## Report (written by the worker when done)

### What I did

- Appended one sentence to the `schedule.timezone` line in `apps/server/src/agents/tool-guide.ts`
  (still a single array entry at `:17`):
  ` For \`schedule.timezone\`, use the IANA time zone shown next to the current time in your prompt, unless the user named another one.`
- Changed nothing else. No test added (fixed prompt text, per the spec).

### Checks run

- `pnpm install`: done, no errors (1 deprecated `uuid@7.0.3` warning; peer-dep warning in `apps/mobile` from `@types/react-dom`).
- `pnpm gate` (from repo root): ends with `GATE PASS`, summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (16.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run before the gate; the change is fixed prompt text with no tests and I found no test asserting on the guide content or length.

### Notes for the lead

- The two changed files against `main` are `apps/server/src/agents/tool-guide.ts` and this task file, both inside Allowed files.
- `TOOL_GUIDE_MAX_CHARS` is still 6000; the added sentence is far below that bound.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The change:** one sentence added to the routine guide line, exactly as specified, so the model uses the person's IANA zone for `schedule.timezone`.
