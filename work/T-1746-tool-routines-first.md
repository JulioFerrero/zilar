---
id: T-1746
title: "AIs schedule a saved-tool routine (no model call per run) for fixed fetch-and-format jobs like prices; a prompt routine only when each run needs judgment"
status: merged
milestone: M5
branch: task/T-1746-tool-routines-first
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1746: Tool routines first

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio asked for "post BTC, gold and the S&P" every morning, and the AI made a prompt routine: each run wakes the model, costs tokens and can word the answer differently. His words: "maybe is not good idea weak up an ai for that, a tool routine is just fine". A saved tool (sandbox JavaScript, `docs/TOOL_SANDBOX.md`) scheduled with the tool form runs with no model call and posts its output.

### Facts (the lead read them on 2026-10-16)
- **The guide:** `apps/server/src/agents/tool-guide.ts` (91 lines). The guide lines are the `TOOL_GUIDE_LINES` array (`:17-28`), capped by `TOOL_GUIDE_MAX_CHARS = 6000` (`:14`).
  - `:19` says "Prefer the keyless `web.*` actions over writing fetch code: `web.price` for market prices…". In a turn that's right, but for a recurring job it pushes the model to a prompt routine that calls `web.price` on every run.
  - `:25`: "Schedule a routine only when the user asked for something recurring…".
- **The `routine.schedule` adapter** (`apps/server/src/tools/routine-adapters.ts:88-96`) already says "Prefer the saved-tool form when a saved tool does the job" and shows the tool form, `"tool":"market-prices"` (T-1737).

### Steps
1. **In `tool-guide.ts`, right after the `:25` line,** add one line: "For a recurring job that only fetches and formats data (prices, weather, a status page), use a saved tool and schedule it with the `tool` form: reuse one from `tool.list` or write one, so each run needs no model call. Use the `prompt` form only when each run needs your judgment (a summary, a decision)."
2. **At the end of the `:19` line,** add: "For a recurring job, see the routine rule below."
3. **Keep the whole guide under `TOOL_GUIDE_MAX_CHARS`.** Add no tests.

### Allowed files
- `apps/server/src/agents/tool-guide.ts`
- `work/T-1746-tool-routines-first.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The two guide lines** are in place, and the guide stays under 6000 characters.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
- In `apps/server/src/agents/tool-guide.ts`:
  - Added "For a recurring job, see the routine rule below." at the end of the `web.*` line (now line 19), before the "Never put private or sensitive text in `web.search` queries…" sentence.
  - Added one new guide line right after the `routine.schedule` line (now line 25): "For a recurring job that only fetches and formats data (prices, weather, a status page), use a saved tool and schedule it with the `tool` form: reuse one from `tool.list` or write one, so each run needs no model call. Use the `prompt` form only when each run needs your judgment (a summary, a decision)." (now line 26).
- Kept `TOOL_GUIDE_MAX_CHARS` at 6000 and added no tests, per spec.

### Checks run
- `pnpm install`: done in 18.9s (see below for gate).
- Guide length check (node, array literal evaluated from source): 12 lines, 2090 chars, `under6000: true`.
- `pnpm gate` from repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (1.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (8.1s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/server  (22.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files were reported.
- No single test files were run separately; the change is fixed guide text with no crucial-code behavior, and the spec says add no tests.

### Notes for the lead
- Only the two Allowed files changed (`apps/server/src/agents/tool-guide.ts`, `work/T-1746-tool-routines-first.md`).
- The reference "routine rule below" on line 19 points to the schedule line (25) plus the new line (26); the new line is placed immediately after the `routine.schedule` guidance as the spec asked.

## Review (written by Claude)

- **Accepted at `f34510441`.** The pre-review is clean (1 nit) and the packet is current.
- **The lead read the diff:** the two guide lines are exactly as specced (the `web.*` line points to the routine rule, and the new routine rule follows the schedule line), and the guide stays under 6000 characters.
