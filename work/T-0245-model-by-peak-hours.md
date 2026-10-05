---
id: T-0245
title: "Lead tooling: `model: auto` picks DeepSeek flash off-peak and the free Muse in DeepSeek's peak hours"
status: merged
milestone: M5
branch: task/T-0245-model-by-peak-hours
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0244]
estimate: 0.4 day
---

# T-0245: Worker model by DeepSeek peak hours

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "use deepseek 4.1 flash on off peak hour and muse spark 1.3 in peak hour". The trial T-0244 on `deepseek/deepseek-flash` finished in 9.2 min total for $0.093 off-peak, with the same review count as Muse.
- DeepSeek peak hours double its price: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. Every other hour is off-peak, including weekends.
- In peak hours the worker uses the free Muse, with the existing in-place fallback to the paid Muse.
- Pre-reviews and the doctor stay on Muse: a reviewer from another model family is the point.

### Verified facts (do not re-derive)
- The worker model comes from the task front matter:
  - `readTaskFrontMatter` (`packages/devtools/src/lead/launch.ts` lines 43-60);
  - `launch` (`launch.ts` line 153) reads it, `assertAllowedModel` (line 154, defined in `packages/devtools/src/lead/task-file.ts` line 61), then `splitModel` with `variant: effort` (line 155);
  - it stores `model: modelString` in the task record (line 193).
- Fresh fix-round sessions take `input.record.model` (`packages/devtools/src/lead/fresh-session.ts` line 40), with `effort` from the front matter.
- Effort: `pickEffort` (`task-file.ts` line 113). DeepSeek has no `low` variant: T-0244 ran with `effort: default`.
- Fallback: `packages/devtools/src/lead/fallback.ts` (`FREE_MUSE`, `PAID_MUSE`, `fallbackModel` returns the paid Muse only for the free Muse). It is used in `packages/devtools/src/lead/decide.ts` (lines 188, 231, 244) and `packages/devtools/src/lead/doctor.ts` line 210.
- Tests live next to the code (`launch.test.ts`, `fresh-session.test.ts`, `fallback.test.ts`, `task-file.test.ts`).

### What to build
1. New `packages/devtools/src/lead/model-schedule.ts`:
   - `DEEPSEEK_FLASH = 'deepseek/deepseek-flash'`;
   - `isDeepSeekPeak(now: Date): boolean`: UTC, Monday to Friday, hours in [1,4) or [6,10);
   - `resolveWorkerModel(frontMatterModel: string, now: Date): { model: string; effortOverride?: string }`. `auto` → `DEEPSEEK_FLASH` with `effortOverride: 'default'` off-peak, `FREE_MUSE` in peak. Any other value comes back unchanged (explicit models keep working).
2. `launch.ts`: resolve the model with `resolveWorkerModel(modelString, deps.now?.() ?? new Date())` before `assertAllowedModel`. Use the override effort when given. Store the RESOLVED model in the record, and print it (e.g. `T-0246 auto -> deepseek/deepseek-flash (off-peak)`). Add an injectable `now` to `LaunchDeps` for tests.
3. `fresh-session.ts`: when the task's front matter says `auto`, resolve again at the time of the fresh session. A fix round in peak hours goes to the free Muse even if the first pass ran on DeepSeek. Update the record's model to the resolved one at the call site that records the new session.
4. `fallback.ts`: `fallbackModel(DEEPSEEK_FLASH)` also returns `PAID_MUSE`, so a DeepSeek outage or rate limit falls back in place like the free Muse does. Keep the existing behaviour for every other model.
5. `spec-check` and `parseTaskFrontMatter` accept `model: auto`.
6. Docs: one paragraph in `docs/LEAD_HANDOFF.md` (models section): `model: auto`, the peak hours, the fallback, and that reviews stay on Muse.
7. Tests:
   - `model-schedule.test.ts` (new): Monday 00:59 / 01:00 / 03:59 / 04:00 / 05:59 / 06:00 / 09:59 / 10:00 UTC; Saturday 07:00 is off-peak; an explicit model passes through.
   - `launch.test.ts`: `auto` launches DeepSeek with variant `default` off-peak and the free Muse in peak; the record stores the resolved model.
   - `fresh-session.test.ts`: re-resolves for `auto`.
   - `fallback.test.ts`: DeepSeek falls back to the paid Muse.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/launch.ts`, `packages/devtools/src/lead/fresh-session.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/task-file.ts`, `packages/devtools/src/lead/decide.ts` (lines 175-250), `docs/LEAD_HANDOFF.md`.

### Allowed files
`packages/devtools/src/lead/model-schedule.ts` (new), `packages/devtools/src/lead/model-schedule.test.ts` (new), `packages/devtools/src/lead/launch.ts`, `packages/devtools/src/lead/launch.test.ts`, `packages/devtools/src/lead/fresh-session.ts`, `packages/devtools/src/lead/fresh-session.test.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/fallback.test.ts`, `packages/devtools/src/lead/task-file.ts`, `packages/devtools/src/lead/task-file.test.ts`, `packages/devtools/src/lead/spec-check.ts`, `packages/devtools/src/lead/spec-check.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/reply.ts`, `docs/LEAD_HANDOFF.md`, `work/T-0245-model-by-peak-hours.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts src/lead/launch.test.ts src/lead/fresh-session.test.ts src/lead/fallback.test.ts src/lead/task-file.test.ts src/lead/spec-check.test.ts
pnpm gate
```

### Acceptance
- A task with `model: auto` launches on DeepSeek flash off-peak and on the free Muse in DeepSeek's peak hours. Fix rounds re-resolve.
- A DeepSeek failure falls back in place to the paid Muse. Explicit models behave exactly as today. Reviews and the doctor are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Chinese public holidays (rare; we pay peak price those days), switching a running session when the hour changes, pre-review and doctor models.

---

## Report (written by the worker when done)

### What I did
- New `model-schedule.ts`: `DEEPSEEK_FLASH`, `isDeepSeekPeak` (UTC Mon-Fri, [1,4) and [6,10)) and `resolveWorkerModel` (`auto` -> DeepSeek flash + `effortOverride: 'default'` off-peak, `FREE_MUSE` in peak; every other value unchanged).
- `launch.ts`: resolves the model with `resolveWorkerModel(modelString, deps.now?.() ?? new Date())` before `assertAllowedModel`, uses the override effort, stores the resolved model in the record, and prints `T-XXXX auto -> <model> (peak|off-peak)` for `auto`. Added `now?: () => Date` to `LaunchDeps`.
- `fresh-session.ts`: re-resolves `auto` at fresh-session time (injectable `now`); every other front-matter model keeps `record.model` (switch-model behaviour preserved). `startFreshWorkerSession` now returns `{ sessionId, model }`; `freshSessionRecord(record, sessionId, model?)` records the resolved model. Both call sites (`autopilot.ts` autofix round, `reply.ts` reply --fresh) pass it through.
- `fallback.ts`: `fallbackModel(DEEPSEEK_FLASH)` returns `PAID_MUSE`; all other behaviour unchanged. (`model-schedule.ts` imports `FREE_MUSE`, `fallback.ts` imports `DEEPSEEK_FLASH`; the cycle is only read inside function bodies.)
- Docs: one bullet in the models section of `docs/LEAD_HANDOFF.md`.
- Tests: new `model-schedule.test.ts` (all boundary hours, Saturday off-peak, explicit pass-through) plus additions to `launch.test.ts` (auto off-peak/peak and the stored record), `fresh-session.test.ts` (re-resolve both directions), `fallback.test.ts`, `task-file.test.ts` and `spec-check.test.ts`.

Note on spec item 5: `parseTaskFrontMatter` already accepted `model: auto` (the schema's `model` is `z.string().min(1)`) and `checkSpec` never inspects the model field, so no source change was needed there; I added regression tests so the acceptance is locked in.

### Files changed
`packages/devtools/src/lead/model-schedule.ts` (new), `model-schedule.test.ts` (new), `launch.ts`, `launch.test.ts`, `fresh-session.ts`, `fresh-session.test.ts`, `fallback.ts`, `fallback.test.ts`, `task-file.ts` (no change), `task-file.test.ts`, `spec-check.test.ts`, `autopilot.ts`, `reply.ts`, `docs/LEAD_HANDOFF.md`, `work/T-0245-model-by-peak-hours.md`, plus `pnpm-lock.yaml` (pnpm install added two peer-dependency lines; the gate always allows it).

### Commands and results
- `pnpm install`: added turbo/typescript/vitest links, "Done in 12.6s".
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/model-schedule.test.ts src/lead/launch.test.ts src/lead/fresh-session.test.ts src/lead/fallback.test.ts src/lead/task-file.test.ts src/lead/spec-check.test.ts`: `Test Files 6 passed (6)`, `Tests 72 passed (72)`.
- First `pnpm gate`: FAIL on `format` (`packages/devtools/src/lead/launch.ts`); ran `pnpm exec prettier --write packages/devtools/src/lead/launch.ts`.
- Final `pnpm gate` from the repo root:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (16.5s)`
  - `PASS  lint  (1.6s)`
  - `PASS  typecheck  (4.2s)`
  - `PASS  tests @zilar/devtools  (7.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
- No deviations from the Spec. `model-schedule.ts` and `fallback.ts` import each other; the constants are only read inside functions, so there is no runtime cycle.
- The lockfile change is a side effect of the required `pnpm install`, not a dependency addition.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean (2 nits, 1 follow-up). I read `model-schedule.ts`: UTC weekday hours [1,4) and [6,10) count as peak; `auto` resolves to flash with `effort: default` off-peak and to the free Muse in peak; explicit models pass through. The lead had the worker drop the two-line `pnpm-lock.yaml` peer flip (`5bebb942`).

Follow-ups:
- `decide.ts:112`: the FALLBACK line says "free Muse" even for a DeepSeek fallback.
- The peak tests assert the variant only loosely.
- `fallback.ts` and `model-schedule.ts` import each other.
