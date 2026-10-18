---
id: T-2124
title: "Plan only: one AI turn path — the DM and group AI turn files in apps/server/src/agents do the same steps twice; write docs/audit/agent-turns-plan.md with the step-by-step comparison, file:line facts, safe tasks and the expected line savings — no code change"
status: merged
milestone: M5
branch: task/T-2124-agent-turns-plan
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2124: One AI turn path (plan)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and the code must be easier for AIs and humans to read. An AI answers in a DM and in a group topic through two parallel sets of files in `apps/server/src/agents`. The lead counted them at `3994b925b`:

| File | Lines |
| --- | ---: |
| `apps/server/src/agents/gateway/group-turn-body.ts` | 472 |
| `apps/server/src/agents/group-turn.ts` | 445 |
| `apps/server/src/agents/gateway/group-turn.ts` | 419 |
| `apps/server/src/agents/gateway/dm-turn.ts` | 378 |
| `apps/server/src/agents/gateway/group-ingest.ts` | 364 |
| `apps/server/src/agents/dm-tool-turn.ts` | 173 |
| `apps/server/src/agents/gateway/dm-turn-input.ts` | 148 |
| `apps/server/src/agents/dm-turn.ts` | 142 |
| `apps/server/src/agents/gateway/group-turn-roster.ts` | 50 |
| **Total** | **2,591** |

The lead's clone scan found matching blocks between:
- `dm-tool-turn.ts` and `group-turn.ts` (11 lines);
- `gateway/dm-turn-input.ts` and `gateway/group-turn-body.ts` (8);
- `gateway/dm-turn.ts` and `gateway/group-turn.ts` (6).

The code is mostly the same steps written twice, not copies. This is the message pipeline, so the change must be planned before any code moves.

### What to write
Write one file, `docs/audit/agent-turns-plan.md`. Read the code; do not change any.

1. **Step table.** Follow one AI turn from the incoming message to the sent reply, in a DM and in a group topic. For each step, give one row with:
   - the step name;
   - the DM code (`file:line`) and the group code (`file:line`);
   - a verdict:
     - **same behaviour, different code**;
     - **real difference**, saying what differs and why it must stay. Examples: group roster, mention rules, topics, who may trigger the AI, quiet runs.

   The steps include:
   - building the model input (history, persona, memory, tools);
   - the tool loop;
   - approvals;
   - sending the reply;
   - typing and status;
   - errors and limits.
2. **One path.** Propose one turn function with a small "context" input that carries the real differences, so each step exists once. Name the new file or files and which of the nine files above shrink or go.
3. **Tasks.** List tasks of about 30–60 minutes each, in a safe order (small, behaviour-preserving moves first). For each task give:
   - the exact Allowed files (full repo paths);
   - the existing tests that cover it (file paths: the agent tests are the safety net here, so list them);
   - the expected net line change.

   Never put two tasks on the same file at the same time.
4. **Risks.** List anything that could change what an AI answers, when it answers, or who sees it. List what the lead must check after each task:
   - the tests that must pass;
   - what to try live, in Julio's room "ai test › General", as `@claude_test`.
5. **Total.** The expected line savings.

Keep the document under 400 lines. Use `file:line` for every claim.

### Allowed files
- `docs/audit/agent-turns-plan.md`
- `work/T-2124-agent-turns-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists and cites `file:line` for every claim.
- Its tasks don't overlap and carry savings estimates.
- No code changed.

---

## Report (written by the worker when done)

### What I did

- Read the task and `AGENTS.md` completely, then read all nine files named in the
  spec plus the shared modules they call (`context.ts`, `tool-rounds.ts`,
  `tool-exec.ts`, `tool-loop.ts`, `turn-send.ts`, `turn-stop.ts`, `live.ts`,
  `gateway/tool-exec.ts`, `gateway.ts`, `turn-start.ts`).
- Wrote `docs/audit/agent-turns-plan.md` (315 lines, under the 400 limit):
  - a 28-row step table from incoming message to sent reply, with DM and group
    `file:line` for every step and a Same/Real verdict;
  - the one-path proposal (`turn.ts` + `gateway/turn-prompt.ts` +
    `gateway/turn-input.ts`) with the fate and target size of all nine files;
  - eight sequential 30–60 minute tasks with full Allowed files, the covering
    tests and net line estimates;
  - risks, tests and live checks for Julio's "ai test › General";
  - the total: 2,591 lines today, about 1,920 after (about −670, −26%).
- No code changed. `docs/audit/agent-turns-plan.md` is new; no source file was
  edited, so the plan's claims are read-only observations at `4a793f07f`.

I re-counted the nine files with `wc -l` before writing; they still sum to
2,591, matching the spec's table at `3994b925b`.

### Checks run

```
$ pnpm install
Done in 25.4s using pnpm v10.32.1

$ pnpm gate
gate: 2 changed file(s) against main
PASS  install (frozen)  (3.5s)
PASS  format  (1.4s)
PASS  lint  (2.8s)
PASS  typecheck  (2.0s)
SKIP effect (no source files changed)
SKIP build @zilar/server (no server, package or manifest change)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No single test file was run: the change is documentation only and no source
file changed. `pnpm gate` skipped the effect and build checks for the same
reason; it passed format, lint and typecheck.

### Notes for the lead

- The task asks that no two tasks share a file "at the same time". The plan
  makes every task serial and says so in each task; T1–T3 share
  `dm-tool-turn.ts` / `group-turn.ts`, and T5–T7 share the new
  `gateway/turn-input.ts`. T4 is the only task whose files are disjoint from
  the rest, so it is the only one that could run in a separate worktree
  alongside T1–T3.
- The savings are estimates. T1–T3 and T5–T7 are moves with small deletions;
  T4 and T6 carry most of the real cut. §5 says to re-measure with `wc -l`
  after T8 and stop if the result is above 2,050.
- The biggest behavioural risk is T4 (prompt assembly): the message arrays
  must stay byte for byte. The tests named there cover the inputs, not a
  recorded request body, so the lead should diff one request body in the
  `gateway-group` harness before merging T4.
- No blocked items and no decisions needed.

## Review (written by Claude)

Approved; the pre-review was clean (3 doc nits). `docs/audit/agent-turns-plan.md` (315 lines) has:
- a step table, DM against group, with `file:line` for each step;
- one `runTurn(ctx)` path;
- 8 serial tasks, about −670 lines (2,591 → about 1,920 in the nine files);
- a risk table that names the tests and the live checks for each task.

**Lead decisions:**
1. **Tonight**, with Julio asleep, no live AI checks are possible: they need chat messages, which are off. Only T1 (failure/stop tail) runs, behind its tests.
2. **The loop and input moves** (T3, T5–T8) wait until Julio can run the live checks in "ai test › General".
3. **T2 and T4** may run tonight if T1 deploys with 0 server errors.
