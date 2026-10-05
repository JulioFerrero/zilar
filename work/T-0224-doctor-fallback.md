---
id: T-0224
title: "Lead tooling: the doctor also switches in place to the paid Muse on a free-Muse rate limit"
status: merged
milestone: M5
branch: task/T-0224-doctor-fallback
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0216, T-0222]
estimate: 0.3 day
---

# T-0224: Doctor fallback

## Spec (written by Claude, do not edit)

### Why
2026-10-05: the doctor's session hit the free Muse's 429 and stopped; the autopilot printed `LEAD: DOCTOR STALLED` and the lead switched it by hand. T-0216 switches workers and pre-reviews in place (same session, context kept) but not the doctor.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/doctor.ts`: `DecideDoctorInput` (line 141, has `sessionState`, `reportFilePresent`, ...), `DoctorAction` union (lines 158-161), `DoctorRecordPatch` (163-170), `applyDoctorRecordPatch` (172-185), `decideDoctor` (line 195): same-head branch (lines 200-226) escalates `LEAD: DOCTOR STALLED (idle, no DOCTOR.md)` once per head; `startDoctorSession` (line 118) creates the session with `reviewModel()` (T-0215).
- `packages/devtools/src/lead/autopilot.ts`: `tickDoctor` (line 403) reads the doctor session with `summarizeSession(...)` but keeps only `.state` (line 434); `applyDoctorActions` (line 455) runs `record-doctor`, `escalate` and `start-doctor`.
- `packages/devtools/src/lead/types.ts`: `DoctorRecord` (lines 40-47), `doctorRecordSchema` (lines 79-86).
- `packages/devtools/src/lead/fallback.ts`: `FREE_MUSE`, `PAID_MUSE`, `fallbackModel(model)`.
- `packages/devtools/src/lead/prompts.ts`: `PromptName` union (line 6); `packages/devtools/prompts/prereview-resume.md` is the pattern for a resume prompt.
- The worker/pre-review version of this feature, to copy: the `fallback-model` branch in `applyActions` in `autopilot.ts` (switchModel, then promptDetached, then record the model; a failed switch logs and stops).

### What to build
1. `types.ts`: `DoctorRecord` gets optional `model?: string | undefined` (and optional in `doctorRecordSchema`, so old state files load). Absent means the free listing.
2. `doctor.ts`: `DecideDoctorInput` gets `quotaError: boolean`; `DoctorAction` gets `{ kind: 'fallback-doctor'; model: string }`; `DoctorRecordPatch` and `applyDoctorRecordPatch` carry `model`. In the same-head branch, before the idle checks: when `input.quotaError` and `fallbackModel(input.doctor.model ?? FREE_MUSE)` is defined, push `fallback-doctor` and escalate `LEAD: FALLBACK doctor continues on paid Muse`, and return (no STALLED line for that tick).
3. New prompt `packages/devtools/prompts/doctor-resume.md`: "The previous turn failed on a provider rate limit; the session now runs on another model and your work so far is intact. Continue the audit from where you stopped and write DOCTOR.md as the first prompt asked." Add `'doctor-resume'` to `PromptName`.
4. `autopilot.ts`: `tickDoctor` passes `quotaError` from the same `summarizeSession` call (`false` when there is no doctor or the call fails). `applyDoctorActions` runs `fallback-doctor`: `deps.client.switchModel(doctor.sessionId, splitModel(action.model))` (no variant), then `promptDetached` the rendered `doctor-resume` prompt, then `updateState` the doctor record's `model` under the same session-id guard as `record-doctor`; log `doctor switched to <model> in place`. A failed switch logs `doctor fallback failed: <message>` and does nothing else. Dry run prints `DRY: would switch the doctor to <model>`.
5. Tests: `packages/devtools/src/lead/doctor.test.ts` (same head + quota on free gives `fallback-doctor` + the FALLBACK line and no STALLED; on paid gives the normal STALLED path; no quota keeps today's behaviour); `packages/devtools/src/lead/autopilot.test.ts` (a doctor session ending on a 429: one `client.switched` entry for the doctor session with the paid model, one prompt on the same session, `state.doctor.model` saved; the next tick does not switch again); `packages/devtools/src/lead/prompts.test.ts` if it lists template names.
6. `docs/LEAD_HANDOFF.md`: in the line that says the fallback does not cover the doctor, say it now does (T-0224) and drop the manual steps.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/doctor.ts` (lines 100-240), `packages/devtools/src/lead/autopilot.ts` (the `fallback-model` branch and lines 395-500), `packages/devtools/src/lead/types.ts` (lines 35-120), `packages/devtools/src/lead/fallback.ts`, `packages/devtools/prompts/prereview-resume.md`.

### Allowed files
`packages/devtools/src/lead/doctor.ts`, `packages/devtools/src/lead/doctor.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/autopilot.test.ts`, `packages/devtools/src/lead/types.ts`, `packages/devtools/src/lead/prompts.ts`, `packages/devtools/src/lead/prompts.test.ts`, `packages/devtools/prompts/doctor-resume.md` (new), `docs/LEAD_HANDOFF.md`, `packages/devtools/src/lead/state.ts` and `packages/devtools/src/lead/state.test.ts` (lead, 2026-10-05: only to carry the doctor's `model` through `loadState`), `work/T-0224-doctor-fallback.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts src/lead/autopilot.test.ts src/lead/prompts.test.ts
pnpm gate
```

### Acceptance
- A doctor session on the free Muse that hits a quota error is switched once, in place, to `meta/muse-spark-1.3-contributor`, re-prompted, and its model saved; one `LEAD: FALLBACK doctor ...` line.
- Workers and pre-reviews behave as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Switching back to free, a `lead` command for the doctor.

---

## Report (written by the worker when done)

### What I did
- `types.ts`: `DoctorRecord` gets optional `model?: string | undefined`; `doctorRecordSchema` gets `model: z.string().optional()`.
- `doctor.ts`: `DecideDoctorInput` gets `quotaError: boolean`; `DoctorAction` gets `{ kind: 'fallback-doctor'; model: string }`; `DoctorRecordPatch` and `applyDoctorRecordPatch` carry `model`. Same-head branch: on `quotaError` with a defined `fallbackModel(doctor.model ?? FREE_MUSE)`, pushes `fallback-doctor` + `LEAD: FALLBACK doctor continues on paid Muse` and returns (no STALLED that tick).
- New `packages/devtools/prompts/doctor-resume.md` (spec sentence verbatim); `'doctor-resume'` added to `PromptName`.
- `autopilot.ts`: `tickDoctor` passes `quotaError` from the same `summarizeSession` call (`false` when no doctor or the call fails); `applyDoctorActions` runs `fallback-doctor`: `switchModel(sessionId, splitModel(model))` (no variant), `promptDetached` the rendered `doctor-resume`, `updateState` the doctor `model` under the same session-id guard as `record-doctor`, log `doctor switched to <model> in place`; failed switch logs `doctor fallback failed: <message>` and does nothing else; dry run prints `DRY: would switch the doctor to <model>` (fallback branch placed before the generic start-doctor dry-run check so it is reachable).
- `docs/LEAD_HANDOFF.md`: fallback line now says it covers workers, pre-reviews, and the doctor (T-0224); manual doctor switch steps dropped.
- Tests: `doctor.test.ts` (free+quota gives `fallback-doctor` + FALLBACK, no STALLED; paid+quota gives STALLED, no fallback; no-quota gives STALLED); `autopilot.test.ts` (429 on doctor session: one `client.switched` entry with paid model, one prompt on the same session — see blocker; second tick does not switch again); `prompts.test.ts` (`doctor-resume` in the template list + render check).

### Commands
- `pnpm install`: ok (11.1 s).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/state.test.ts src/lead/doctor.test.ts src/lead/autopilot.test.ts src/lead/prompts.test.ts`: 4 files passed, 65 tests passed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/devtools all PASS; scope: every changed file is inside the Allowed files; 12 changed file(s) against main.

### Lead round 1
- Fix 1.1: `doctor.ts` pushes `fallback-doctor` before the FALLBACK escalation; `applyDoctorActions` returns (stops the tick's remaining doctor actions) when the doctor `switchModel` fails, mirroring the worker branch's `return current`. New `autopilot.test.ts` test: a `switchModel` that throws gives no `LEAD: FALLBACK` console line and no prompt. `doctor.test.ts` now asserts the exact action order. Committed as `T-0224: fix lead 1.1 - no FALLBACK line when the doctor switch fails`.
- Fix 1.2: the doctor second-tick assertion now filters the console spy for `LEAD: FALLBACK doctor` (exactly one line from the first tick) instead of the vacuous `second.escalations` check. Committed as `T-0224: fix lead 1.2 - second-tick assertion on the console spy`.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts src/lead/autopilot.test.ts`: 2 files passed, 45 tests passed. `pnpm gate`: GATE PASS (12 changed files against main, scope clean).

### Blocked / needs a decision
The lead approved the `state.ts` change (option a): `loadState` now carries `model` into the rebuilt doctor record, with round-trip tests in `state.test.ts`.

### Security checklist
- No secrets/tokens in logs or code; the fallback logs only the model string and session id.
- Doctor state write is session-id guarded (`fresh.doctor?.sessionId === expectedSession`), same as `record-doctor`.
- No new routes, no deletes/updates, no caps changed. N/A items (permission checks, 404s, rate limits, audit text) are untouched by this task.

## Review (written by Claude)

**Verdict:** Approved after one lead round. `decideDoctor` emits `fallback-doctor` + one FALLBACK line on a quota error; a failed switch logs and returns with no FALLBACK line and no prompt; `loadState` now keeps the doctor `model`; a new doctor session writes a fresh record without `model`, so each run starts free again. Pre-review clean, one nit (the `result.escalations` assertion in the failed-switch test is vacuous; the console-spy assertion next to it carries the check). Autopilot restarted after the merge.
