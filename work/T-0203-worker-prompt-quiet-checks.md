---
id: T-0203
title: Lead tooling: the worker prompt runs checks once (pnpm gate) and quiet single tests (token saving)
status: planned
milestone: M5
branch: task/T-0203-worker-prompt-quiet-checks
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0202]
estimate: 0.2 day
---

# T-0203: Worker prompt: checks once, quiet tests

## Spec (written by Claude, do not edit)

### Why
Measured on 2026-10-05: worker sessions re-send their whole context on every step, so every long command output stays expensive for the rest of the session. Workers ran install, format, lint, typecheck and the tests one by one and THEN `pnpm gate`, which runs all of them again; the gate itself is already quiet (one line per step, the last 40 lines of a failure, `packages/devtools/src/gate/cli.ts` lines 87-97). Julio asked to cut this waste. The lead has already updated the "Running tests" section of `AGENTS.md` and the spec template; this task updates the worker prompt to match.

### Verified facts (do not re-derive)
- `packages/devtools/prompts/worker.md` is the first message of every worker session. Its third paragraph (line 5) starts "Before you finish, run `pnpm gate` from the repo root."
- `vitest` accepts `--reporter=dot` in this repo (the lead ran `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/board.test.ts`: dots plus a 4-line summary).
- `packages/devtools/src/lead/prompts.test.ts` line 41-45 asserts the rendered worker prompt contains `work/T-0038-lead-autopilot.md`, `AGENTS.md`, `pnpm install`, `status: review` and `T-0038:`.

### What to build
1. In `packages/devtools/prompts/worker.md`, add this paragraph right after the paragraph that starts "Before you finish" (keep every other line unchanged):

   ```
   Keep your session small: every command output stays in your context. While you work, run single test files with `pnpm --filter <package> test --maxWorkers=2 --reporter=dot <path>`. Do not run format, lint, typecheck or whole test suites one by one: `pnpm gate` runs all of them once at the end. Read only the files and line ranges you need, and never print a whole log; when a command fails, look at the failing part only.
   ```
2. In `packages/devtools/src/lead/prompts.test.ts`, in the worker prompt test, add assertions that the rendered prompt contains `--reporter=dot` and `pnpm gate`.

### Read first
`AGENTS.md`, `packages/devtools/prompts/worker.md`, `packages/devtools/src/lead/prompts.test.ts` (lines 30-50).

### Allowed files
`packages/devtools/prompts/worker.md`, `packages/devtools/src/lead/prompts.test.ts`, `work/T-0203-worker-prompt-quiet-checks.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/prompts.test.ts
pnpm gate
```

### Acceptance
- The worker prompt contains the paragraph above, word for word; the existing assertions still pass and the two new ones pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Any other prompt, the gate, `AGENTS.md` (the lead owns it).

---

## Report (written by the worker when done)

## Review (written by Claude)
