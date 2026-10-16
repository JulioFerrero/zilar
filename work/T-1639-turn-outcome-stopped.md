---
id: T-1639
title: "Scheduled AI jobs step 4a: a stopped turn returns its own outcome { kind: 'stopped', text: '' } instead of looking like a failure, so a scheduled run the owner stops is never counted as a failed run; chat behaviour unchanged"
status: merged
milestone: M5
branch: task/T-1639-turn-outcome-stopped
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1639: A Stop is not a failure

## Spec (written by Claude, do not edit)

### Why
Scheduled AI jobs (plan `docs/plan/scheduled-ai-jobs.md` §2.2, from T-1614) record each run's outcome. Three failures pause the routine.

Today a stopped turn and a failed turn both return `{ kind: 'failed', text: '' }`, so the scheduler couldn't tell an owner's Stop from a model failure. **This task only splits the outcome.** Chat behaviour stays the same.

### Facts (the lead read them on 2026-10-16, main after T-1638)
- **The type:** `apps/server/src/agents/dm-turn.ts:121`: `export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };`
- **The stop paths:**
  - `apps/server/src/agents/turn-stop.ts:37-41`: `stoppedTurn(...)` closes the card and returns `{ kind: 'failed', text: '' }`. `dm-tool-turn.ts` and `group-turn.ts` call it at many places (e.g. `dm-tool-turn.ts:80,102,128,159,178,185`, `group-turn.ts:141,163,170,262,271,286,309,317,321`).
  - `apps/server/src/agents/dm-turn.ts:149-153`: the T-1422 abort branch: `if (deps.signal?.aborted === true) { await finishProgressQuietly(deps, secrets, 'stopped'); return { kind: 'failed', text: '' }; }`
- **The consumers** only compare with `'replied'`:
  - `apps/server/src/agents/gateway/dm-turn.ts:286`: `turnDrafts.end(outcome.kind === 'replied' && … ? 'sent' : 'failed')`;
  - `apps/server/src/agents/gateway/group-turn-body.ts:351`: `status: turnOutcome.kind === 'replied' ? 'completed' : 'failed'`, which also reads `turnOutcome.text` (`:352`).
- **Tests:** `apps/server/src/agents/turn-stop-gate.test.ts:75` and `:111` assert `expect(outcome).toEqual({ kind: 'failed', text: '' })` for stopped turns.

### Steps
1. **`dm-turn.ts:121`:** add the variant `| { kind: 'stopped'; text: string }`, with one comment line: a turn the owner stopped, so the text is always `''`, and it's never a failure.
2. **`turn-stop.ts` `stoppedTurn`:** return `{ kind: 'stopped', text: '' }`.
3. **`dm-turn.ts:149-153`:** the abort branch returns `{ kind: 'stopped', text: '' }`.
4. **Leave the other `{ kind: 'failed', text: '' }` returns alone.** Those are failed sends, not stops. The consumers stay as they are: anything not `'replied'` still ends the draft as `'failed'` and a delegation as `'failed'`, exactly as today.
5. **`turn-stop-gate.test.ts:75` and `:111`:** expect `{ kind: 'stopped', text: '' }`.

### Allowed files
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/turn-stop.ts`
- `apps/server/src/agents/turn-stop-gate.test.ts`
- `work/T-1639-turn-outcome-stopped.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/turn-stop-gate.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Every stop path returns `kind: 'stopped'`.**
- **Every failure path still returns `kind: 'failed'`.**
- **Chat behaviour is unchanged,** and the tests pass.

---

## Report (written by the worker when done)

### What I did

Split a stopped turn from a failed one, exactly as the spec asks:

1. `apps/server/src/agents/dm-turn.ts:121` — `DmTurnOutcome` now has the extra
   variant `| { kind: 'stopped'; text: string }`, with one comment line saying a
   stopped turn is never a failure. The union is now multiline so it fits
   prettier's 100-column width.
2. `apps/server/src/agents/turn-stop.ts` — `stoppedTurn` returns
   `{ kind: 'stopped', text: '' }` instead of `{ kind: 'failed', text: '' }`.
3. `apps/server/src/agents/dm-turn.ts` — the T-1422 abort branch in `runDmTurn`
   returns `{ kind: 'stopped', text: '' }`.
4. Left every other `{ kind: 'failed', text: '' }` return alone (they are failed
   sends, not stops), and left both consumers unchanged: they still only
   compare with `'replied'`, so anything else still ends a draft as `'failed'`
   and a delegation as `'failed'`.
5. `apps/server/src/agents/turn-stop-gate.test.ts` — both stop assertions (lines
   75 and 111) now expect `{ kind: 'stopped', text: '' }`.

I verified every stop path flows through `stoppedTurn` (`turnStopped(deps)` →
`stoppedTurn(...)` in `dm-tool-turn.ts` and `group-turn.ts`), and that the
remaining `kind: 'failed'` returns are send-failure paths.

### Checks run

- `pnpm install` — Done in 13.1s (one deprecated uuid@7.0.3 warning, pre-existing).
- `pnpm --filter @zilar/server exec vitest run src/agents/turn-stop-gate.test.ts src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts --reporter=dot` — Test Files 4 passed (4); Tests 21 passed (21).
- `pnpm gate` (repo root) — `GATE PASS`. 4 changed files against main; `scope: every changed file is inside the Allowed files`. Summary lines:
  - `PASS  install (frozen)  (2.6s)`
  - `PASS  format  (0.9s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (5.9s)`
  - `PASS  effect  (1.3s)`
  - `PASS  tests @zilar/server  (11.4s)`

### Notes for the lead

- No deviations from the spec. Chat behaviour is unchanged: only the two stop
  paths moved to `kind: 'stopped'`; both consumers still key off `'replied'`.
- Follow-up for the scheduler (T-1614): it can now count `kind: 'failed'` as a
  failure and ignore `kind: 'stopped'`; that wiring is out of this task's scope.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The change:** `DmTurnOutcome` gains `stopped`. `stoppedTurn` and the `runDmTurn` abort branch return it, and the failed-send paths still return `failed`. Both consumers still compare with `'replied'`, so chat behaviour is unchanged.
- **The tests:** the lead ran `turn-stop-gate`, `gateway-stop`, `gateway-group` and `dm-turn.fake-provider`: 21 passed.
