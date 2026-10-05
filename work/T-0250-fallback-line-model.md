---
id: T-0250
title: "Lead tooling: the worker FALLBACK line names the model that failed (free Muse or DeepSeek), and the T-0245 nits"
status: merged
milestone: M5
branch: task/T-0250-fallback-line-model
model: auto
effort: low
depends_on: [T-0245]
estimate: 0.2 day
---

# T-0250: FALLBACK line names the real model

## Spec (written by Claude, do not edit)

### Why
Follow-up of T-0245. Since T-0245, `fallbackModel` also switches `deepseek/deepseek-flash` to the paid Muse, but the worker escalation line still says "free Muse rate-limited", so a DeepSeek outage reads wrong in the lead log. This task also covers two nits from the T-0245 pre-review.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/decide.ts` lines 107-113: `pushFreeFallback(model)` pushes the action and escalates the fixed line `LEAD: FALLBACK ${task} free Muse rate-limited, worker continues on paid Muse`. It is called from the planned-task branch (around line 231) and the quota branch (around line 244), where `input.record.model` is the failing model. Tests: `packages/devtools/src/lead/decide.test.ts` lines 147 and 224 expect that exact line.
- `packages/devtools/src/lead/fallback.ts` and `packages/devtools/src/lead/model-schedule.ts` import each other (`DEEPSEEK_FLASH` and `FREE_MUSE`).
- `packages/devtools/src/lead/launch.test.ts` (around line 116) and `packages/devtools/src/lead/fresh-session.test.ts` check the peak-hour model with `toMatchObject({ providerID, id })` only, so the variant is not asserted.
- The CLAUDE.md event table matches `FALLBACK T-XXXX ...` by prefix; keep the `LEAD: FALLBACK <task>` start.

### What to build
1. Rename `pushFreeFallback` to `pushWorkerFallback(from: string, to: string)`. The line becomes `LEAD: FALLBACK ${task} ${label(from)} failed or rate-limited, worker continues on paid Muse`. `label` is `free Muse` for `FREE_MUSE`, `DeepSeek flash` for `DEEPSEEK_FLASH`, otherwise the model id. Update the two callers and the two test expectations. Add one test for a DeepSeek record.
2. Break the import cycle: move `FREE_MUSE`, `PAID_MUSE` and `DEEPSEEK_FLASH` into a new `packages/devtools/src/lead/models.ts`. Re-export them from `fallback.ts` and `model-schedule.ts` so other importers keep working.
3. Peak tests assert the full model including `variant` (the front-matter effort) with `toEqual`.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/decide.ts` (lines 95-250), `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/model-schedule.ts`.

### Allowed files
`packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/decide.test.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/model-schedule.ts`, `packages/devtools/src/lead/models.ts` (new), `packages/devtools/src/lead/launch.test.ts`, `packages/devtools/src/lead/fresh-session.test.ts`, `work/T-0250-fallback-line-model.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/decide.test.ts src/lead/fallback.test.ts src/lead/model-schedule.test.ts src/lead/launch.test.ts src/lead/fresh-session.test.ts
pnpm gate
```

### Acceptance
- A DeepSeek fallback logs a line naming DeepSeek; a free Muse fallback logs one naming the free Muse; both start with `LEAD: FALLBACK <task>`. No import cycle. Behaviour is otherwise unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The pre-review and doctor lines (they always run on Muse).

---

## Report (written by the worker when done)

### What I did
- Renamed `pushFreeFallback(model)` to `pushWorkerFallback(from, to)` in `decide.ts`. The escalation line is now `LEAD: FALLBACK <task> <label(from)> failed or rate-limited, worker continues on paid Muse`, where `label` returns `free Muse` for `FREE_MUSE`, `DeepSeek flash` for `DEEPSEEK_FLASH` and the model id otherwise. Both callers (planned-task branch and quota branch) pass `input.record.model` as `from` and the resolved fallback as `to`.
- Added `packages/devtools/src/lead/models.ts` holding `FREE_MUSE`, `PAID_MUSE` and `DEEPSEEK_FLASH`. `fallback.ts` and `model-schedule.ts` import them and re-export all three, so the old importers keep working and the `fallback.ts` <-> `model-schedule.ts` cycle is gone.
- Updated the two existing escalation expectations in `decide.test.ts` and added one test for a `deepseek/deepseek-flash` record.
- Changed the two peak-hour asserts (`launch.test.ts` and `fresh-session.test.ts`) from `toMatchObject` to `toEqual`, asserting the full model including `variant: 'low'` (the effort picked from the task front matter).

### Files changed
- `packages/devtools/src/lead/decide.ts`
- `packages/devtools/src/lead/decide.test.ts`
- `packages/devtools/src/lead/fallback.ts`
- `packages/devtools/src/lead/model-schedule.ts`
- `packages/devtools/src/lead/models.ts` (new)
- `packages/devtools/src/lead/launch.test.ts`
- `packages/devtools/src/lead/fresh-session.test.ts`
- `work/T-0250-fallback-line-model.md`

`pnpm install` bumped `pnpm-lock.yaml` (it added two peer-dependency entries). I reverted it with `git checkout -- pnpm-lock.yaml`, so the lock file content is unchanged. No other file outside the Allowed files was touched.

### Commands and results
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/decide.test.ts src/lead/fallback.test.ts src/lead/model-schedule.test.ts src/lead/launch.test.ts src/lead/fresh-session.test.ts`: 5 files passed, 68 tests passed, exit 0.
- `pnpm gate`: exit 0. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (19.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.9s)
  PASS  tests @zilar/devtools  (7.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / problems
- None. No import cycle remains. Behaviour is otherwise unchanged.

### Open questions
- None.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean, with 0 nits and 1 docs follow-up. This was the first `model: auto` task: it launched as `auto -> deepseek/deepseek-flash (off-peak)`.
- I read the `decide.ts` diff: `label` names free Muse or DeepSeek flash, and the `LEAD: FALLBACK <task>` prefix is kept.
- `models.ts` breaks the import cycle.
- The peak tests now assert the full model with its variant.

The autopilot needs a restart to log the new line.
