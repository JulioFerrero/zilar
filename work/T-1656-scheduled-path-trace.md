---
id: T-1656
title: "Audit (docs only): trace one scheduled prompt routine end to end on today's main — card → createPromptRoutine → scheduler claim → executePromptRoutine → runPrompt → gateway runner → DM/room turn → settle → outcome row — and list every integration gap with file:line"
status: merged
milestone: M5
branch: task/T-1656-scheduled-path-trace
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1656: End-to-end trace of a scheduled prompt routine

## Spec (written by Claude, do not edit)

### Why
Scheduled AI jobs landed tonight in eight tasks (T-1638, T-1639, T-1641, T-1642, T-1645, T-1646, T-1647, T-1648, T-1649), each with its own unit tests. Julio's first real run is a daily 08:00 routine ("post the BTC, gold and S&P 500 prices").

**The lead needs one person to read the whole path as it is now** and say whether a run will actually happen and land in the right chat. **Docs only. No code.**

### Facts (the lead read them on 2026-10-16, main after T-1649)
- **The card:** `apps/server/src/tools/routine-adapters.ts` (`routineScheduleAdapter`, the prompt branch) → `apps/server/src/routines/prompt-routines.ts` (`createPromptRoutine`).
- **The scheduler:** `apps/server/src/routines/scheduler.ts` (`claimDue`, ticks, `nextRunAfter`), `apps/server/src/routines/execute.ts` (the dispatch on `kind`), `apps/server/src/routines/execute-prompt.ts` (the cap, `runPrompt`, the outcomes) and `apps/server/src/routines/outcomes.ts`.
- **The wiring:** `apps/server/src/startup/components.ts` (the `runPrompt` closure) → `apps/server/src/leader/start.ts` → `apps/server/src/routines/wiring.ts`.
- **The gateway:** `apps/server/src/agents/gateway/routine-run.ts` → `apps/server/src/agents/gateway.ts` (`kickDm`, `kickRoom`) → `apps/server/src/agents/gateway/dm-turn.ts` / `apps/server/src/agents/gateway/group-ingest.ts` (the pump) → `apps/server/src/agents/gateway/group-turn.ts` / `apps/server/src/agents/gateway/group-turn-body.ts` → `apps/server/src/agents/gateway/scheduled-settle.ts`.
- **The schedule format:** `apps/server/src/routines/schedule.ts`.

### Steps
1. **Write `docs/audit/scheduled-path-trace.md`.** Follow one DM routine and one topic routine (`groupId` + `topicId`) from the approved card to the outcome row. At each hop, cite `file:line` and state the inputs and outputs. Answer explicitly:
   - **(a) Claiming:** does `claimDue` pick a `kind = 'prompt'` row, and advance `next_run_at` correctly for a `daily` 08:00 Europe/Madrid schedule?
   - **(b) Timeouts:** could the scheduler's per-run handling time out, or block other routines, while a 15-minute computer turn runs? Look for in-flight caps, `maxPerTick`, `whenIdle` and any run timeout.
   - **(c) Leader vs gateway:** the scheduler runs only on the leader, and `runPrompt` uses that instance's `running.gateway`. Does the leader's gateway own the AI's live session? What happens during a rolling deploy?
   - **(d) Turn sees the prompt:** the synthetic trigger's body reaches the model. In the DM it's merged into history; in the room, check `group-turn-body.ts`'s merge.
   - **(e) The reply lands in the right place:** the DM to the owner, or the topic room with `@owner`.
   - **(f) Every exit settles exactly once:** the outcome maps to `last_status`, the failure counter and pausing.
   - **(g) No overlap:** the 24/day cap and the 10-per-topic limit; a second run can't start while the first is running.
   - **(h) A deploy mid-run:** the desk agent is restarted and the jail removed (T-1626). What does the run record, and is the user told?
2. **For every gap,** name the severity (blocks the 08:00 run, wrong outcome, cosmetic) and propose the smallest fix with exact files.
3. **Change no source file.**

### Allowed files
- `docs/audit/scheduled-path-trace.md`
- `work/T-1656-scheduled-path-trace.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Questions (a)–(h) are answered with `file:line` evidence.**
- **The gaps are listed with severity and the smallest fix.**
- **No source changes.**

---

## Report (written by the worker when done)

### What I did
Wrote `docs/audit/scheduled-path-trace.md`, docs only, no source change. It traces one DM
routine and one topic routine from the approved card to the `routines` outcome row, hop by
hop with `file:line` (card `routine-adapters.ts` → `prompt-routines.ts`; scheduler
`claimDue`/`runOne` → `execute.ts` → `execute-prompt.ts` → `outcomes.ts`; wiring
`components.ts` → `leader/start.ts` → `wiring.ts`; gateway `routine-run.ts` → `gateway.ts`
→ `dm-turn.ts`/`group-ingest.ts` → `group-turn.ts`/`group-turn-body.ts` → `scheduled-settle.ts`).
It answers (a)–(h) with evidence and lists 9 gaps tagged blocks / wrong outcome / cosmetic,
each with the smallest exact-file fix. Key answers: (a) yes, `claimDue` claims
`kind='prompt'` rows (no `kind` filter) and advances `next_run_at` DST-correctly; (b) no
scheduler-side timeout, only the gateway's 20 min `ROUTINE_TIMEOUT_MS`, `MAX_CONCURRENT_RUNS=2`;
(c) yes, the leader's gateway owns the sessions, and a deploy can lose the run; (d) the body
reaches the model in both queues; (e) DM to the owner, room with `@owner`; (f) once-only
settle but two wrong-outcome paths (G2, G3) plus a silent-loss path (G4); (g) the 24/day cap
is atomic, the 10-per-topic check is not, a routine cannot overlap itself; (h) the run
records `ok`/nothing and the user only gets `AI_RESTART_REPLY`.

### Checks run
- `pnpm gate` (from the repo root), real tail:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files; the 2 changed files are
  `docs/audit/scheduled-path-trace.md` and `work/T-1656-scheduled-path-trace.md`.
- No single test files were run: the change touches no code, and the gate ran
  install/format/lint/typecheck (the size rule reports no source file changed).

### Notes for the lead
- Severity call, since you decide: G2 (the 20-min timer starts at enqueue, so a run queued
  behind a 15-min turn is recorded `failed` while it later posts, and three such days pause a
  healthy routine) and G4 (a process death after the claim loses the slot silently) are the
  two I would fix before Julio's 08:00 run. G1/G8 only bite under non-default flags
  (`TOOLS_ENABLED=false` stops the scheduler entirely; `AGENT_GATEWAY_ENABLED=false` makes
  every prompt run `skipped` with no notice).
- I read `work/T-1626-jails-across-restarts.md` and the desk code for (h); I did not change
  it. I ran no stack, so §6 marks the two timing-dependent claims as suspected.
- No source file, `AGENTS.md`, `BOARD.md` or other task file was touched.

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean, 2 nits.
- **The audit:** `docs/audit/scheduled-path-trace.md` answers (a)–(h) with evidence and lists G1–G9.
- **On live**, G1 (needs `TOOLS_ENABLED`) and G8 (gateway off) don't apply: both flags are on since tonight. They're kept as install-doc and notice follow-ups.
- **Fixes the lead launches now, before Julio's first 08:00 run:**
  - **T-1657, the gateway side:**
    - G2: the 20-minute timeout starts when the turn starts, not at enqueue;
    - G3: a stopped session settles `stopped`, never `replied`;
    - G5: a scheduled DM item is its own turn.
  - **T-1658, the routines side:**
    - G7: refund the daily slot on `offline`/`not_in_room`;
    - G8: a warning log line on those outcomes;
    - G4: `stop()` waits briefly for in-flight runs;
    - G9: guard `nextRunAfter` in `claimDue`.
- **Left as recorded:** G6, the check-then-insert 10-per-topic limit, which is cosmetic.
