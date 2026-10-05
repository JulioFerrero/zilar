---
id: T-0216
title: "Lead tooling: on a free-Muse rate limit the autopilot switches the same session to the paid Muse and continues"
status: merged
milestone: M5
branch: task/T-0216-quota-fallback-in-place
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0216: Quota fallback in place

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "try to use free muse as possible but if fails, switch to my paid one okay? without restarting all". The free listing `opencode/muse-spark-1.3-contributor-free` answers 429 "Rate limit exceeded" for hours at a time. Today the autopilot only re-sends `resume` every 10 minutes (`decide.ts` lines 211-224), and pre-reviews stall. The lead tested OpenCode's `session.switchModel`: it changes the model of an existing session and keeps its context, so the work continues where it stopped, on the paid listing `meta/muse-spark-1.3-contributor`.

Tested call (worked on 2026-10-05):
```bash
opencode2 api session.switchModel --param sessionID=ses_X -d '{"model":{"providerID":"meta","id":"muse-spark-1.3-contributor","variant":"low"}}'
```
then a normal `session.prompt` on the same session.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/client.ts`: interface `OpenCodeClient` (line 40), real `OpencodeCliClient` (line 78) with `private call(operation, params, body?, expectData = true)` (line 134), `promptDetached` (line 188); `FakeOpenCodeClient` (line 305), its `promptDetached` (line 350) records into `this.prompted`.
- `packages/devtools/src/lead/decide.ts`: `Action` union (lines 43-54), `RecordPatch` (lines 56-68). The quota branch (lines 211-224) runs only for task status `todo`/`in-progress` (line 207). The pre-review block (lines 166-205) checks `input.record.prereview` and `input.prereviewSessionState` but knows nothing of a pre-review quota error.
- `packages/devtools/src/lead/session.ts`: `summarizeSession(...)` returns `quotaError` (line 147, via `isQuotaActive`, lines 63-73).
- `packages/devtools/src/lead/autopilot.ts`: actions are run in `applyActions` (`send-prompt` at line 146, the non-autofix branch at lines 164-167 calls `deps.client.promptDetached(current.sessionId, prompt)` and `appendLog`). The pre-review session is summarized at lines 233-236 but only `.state` is kept. `decide({...})` is called at lines 248-268.
- `packages/devtools/src/lead/types.ts`: `PrereviewRecord` (lines 32-36, schema lines 71-75), `TaskRecord` (lines 49-69, with `model: string`).
- `packages/devtools/src/lead/launch.ts` line 43: `readTaskFrontMatter(repoRoot, task)` returns `{ file, model, branch, effort }`; line 155 builds `{ ...splitModel(modelString), variant: effort }`.
- `packages/devtools/src/lead/start-prereview.ts` line 41: pre-reviews are created with `PREREVIEW_MODEL` (free, no variant).
- Prompt templates live in `packages/devtools/prompts/` (`resume.md`, `nudge.md`, `prereview.md`, ...).
- T-0215 (running in parallel) edits `task-file.ts`, `start-prereview.ts` and `doctor.ts`: do not touch those three files.

### What to build
1. New `packages/devtools/src/lead/fallback.ts`: `export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free'`, `export const PAID_MUSE = 'meta/muse-spark-1.3-contributor'`, and `export function fallbackModel(model: string): string | undefined` that returns `PAID_MUSE` when `model === FREE_MUSE`, else `undefined`.
2. `client.ts`: add `switchModel(sessionId: string, model: { providerID: string; id: string; variant?: string }): Promise<void>` to the interface; the real client runs `this.call('session.switchModel', { sessionID: sessionId }, { model }, false)`; the fake records it in a new public `switched: { sessionId; model }[]` array and throws for an unknown session like its other methods.
3. `types.ts`: `PrereviewRecord` gets an optional `model?: string | undefined` (also in its zod schema, optional, so old state files still load). Absent means the free listing.
4. `decide.ts`:
   - New action `{ kind: 'fallback-model'; session: 'worker' | 'prereview'; model: string }`.
   - New input `prereviewQuotaError: boolean`.
   - Worker: at the start of the quota branch (line 212), when `fallbackModel(input.record.model)` is defined, push `fallback-model` (session `worker`), escalate `LEAD: FALLBACK ${task} free Muse rate-limited, worker continues on paid Muse` and return. Otherwise keep today's retry/escalate code unchanged (MiniMax, paid Muse).
   - Pre-review: in the pre-review block, before the stall check, when `input.prereviewQuotaError` is true and `fallbackModel(input.record.prereview.model ?? FREE_MUSE)` is defined, push `fallback-model` (session `prereview`), escalate `LEAD: FALLBACK ${task} pre-review continues on paid Muse` and return.
   - Each acts once: after the switch the model is the paid one, so `fallbackModel` returns `undefined` next poll.
5. `autopilot.ts`:
   - Pass `prereviewQuotaError` (from the same `summarizeSession` call at line 234; `false` when there is no pre-review or the call fails).
   - Run `fallback-model`: worker: `variant` = `readTaskFrontMatter(deps.repoRoot, task).effort`; call `deps.client.switchModel(current.sessionId, { ...splitModel(action.model), variant })`, then `promptDetached` the rendered `resume` template (as the send-prompt branch does), set `current.model = action.model`, `appendLog(deps.statePath, `${task} switched worker to ${action.model} in place`)`. Pre-review: `switchModel(current.prereview.sessionId, splitModel(action.model))` (no variant, like `PREREVIEW_MODEL`), `promptDetached` the new `prereview-resume` template, set `current.prereview = { ...current.prereview, model: action.model }`, log the same way.
   - If `switchModel` throws, log the error and fall through to nothing (next poll tries again); never crash the loop.
   - Dry run prints `DRY: would switch ${session} of ${task} to ${model}`.
6. New prompt `packages/devtools/prompts/prereview-resume.md`: "The previous turn failed on a provider rate limit; the session now runs on another model and your work so far is intact. Continue the pre-review of {{TASK}} from where you stopped and write PREREVIEW.md as the first prompt asked." If `prompts.test.ts` lists the template names, add it there.
7. Tests:
   - `packages/devtools/src/lead/fallback.test.ts` (new): free gives paid; paid, MiniMax and empty give undefined.
   - `packages/devtools/src/lead/decide.test.ts`: worker on the free model with a quota error gives `fallback-model` + the FALLBACK line and no `resume`; worker on the paid model keeps today's resume + QUOTA line; pre-review quota on the free model gives `fallback-model` for `prereview`; pre-review already on paid gives no fallback.
   - `packages/devtools/src/lead/autopilot.test.ts`: with `FakeOpenCodeClient`, a worker session whose last message is a 429 quota error on the free model ends with one entry in `client.switched` (paid model, the task's effort as variant), one `resume` prompt on the same session id, and the record's `model` saved as paid in the state file; a second poll does not switch again.
   - `packages/devtools/src/lead/client.test.ts`: the real client builds `api session.switchModel --param sessionID=... -d {"model":{...}}` (follow how the file tests other calls).
8. `docs/LEAD_HANDOFF.md`: one line under the models notes: "On a free-Muse 429 the autopilot switches the session in place to `meta/muse-spark-1.3-contributor` (`LEAD: FALLBACK` line); new sessions still start on the free listing."

### Read first
`AGENTS.md`, `packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/autopilot.ts` (lines 100-300), `packages/devtools/src/lead/client.ts` (lines 40-80, 130-200, 300-360), `packages/devtools/src/lead/types.ts` (lines 29-80), `packages/devtools/src/lead/session.ts` (lines 1-150), `packages/devtools/prompts/resume.md`.

### Allowed files
`packages/devtools/src/lead/fallback.ts` (new), `packages/devtools/src/lead/fallback.test.ts` (new), `packages/devtools/src/lead/client.ts`, `packages/devtools/src/lead/client.test.ts`, `packages/devtools/src/lead/types.ts`, `packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/decide.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/autopilot.test.ts`, `packages/devtools/prompts/prereview-resume.md` (new), `packages/devtools/src/lead/prompts.test.ts`, `docs/LEAD_HANDOFF.md`, `packages/devtools/src/lead/launch.test.ts` and `packages/devtools/src/lead/watch.test.ts` (lead, 2026-10-05: only a `switchModel` stub in their fake clients), `work/T-0216-quota-fallback-in-place.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/fallback.test.ts src/lead/decide.test.ts src/lead/autopilot.test.ts src/lead/client.test.ts
pnpm gate
```

### Acceptance
- A free-Muse worker or pre-review that hits a quota error is switched once, in the same session, to `meta/muse-spark-1.3-contributor` and prompted to continue; the state file shows the new model; one `LEAD: FALLBACK` line is logged.
- Sessions on other models keep today's quota behaviour.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The doctor (T-0215's env override covers it), switching back to free when the limit clears, `lead switch-model`.

---

## Report (written by the worker when done)

Implemented everything in the spec except the gate is red on typecheck for a
reason outside my Allowed files (see Blocked below).

What I did:
- New `packages/devtools/src/lead/fallback.ts`: `FREE_MUSE`, `PAID_MUSE`,
  `fallbackModel` (paid iff free).
- `client.ts`: `switchModel` on the interface, real client
  (`api session.switchModel --param sessionID=... -d {"model":{...}}`),
  fake records into `switched` and throws for unknown sessions.
- `types.ts`: `PrereviewRecord.model?` optional in interface and zod schema.
- `decide.ts`: `fallback-model` action, `prereviewQuotaError` input; worker
  quota branch falls back with `LEAD: FALLBACK <task> free Muse rate-limited,
  worker continues on paid Muse`; pre-review block falls back before the stall
  check with `LEAD: FALLBACK <task> pre-review continues on paid Muse`.
- `autopilot.ts`: captures `prereviewQuotaError` from the pre-review
  `summarizeSession`; runs `fallback-model` (worker: effort variant from
  `readTaskFrontMatter`, resume prompt, `current.model` updated; pre-review:
  no variant, `prereview-resume` prompt, `current.prereview.model` updated);
  switch errors are logged and skipped without crashing; dry run prints
  `DRY: would switch <session> of <task> to <model>`.
- New prompt `packages/devtools/prompts/prereview-resume.md` with the exact
  spec sentence (uses `{{TASK}}`). Note: `prompts.test.ts` NAMES addition uses
  `as PromptName[]` cast because extending the `PromptName` union in
  `prompts.ts` is outside my Allowed files (see Blocked).
- `docs/LEAD_HANDOFF.md`: one line under the models notes (spec wording).
- Tests: new `fallback.test.ts`; `decide.test.ts` (free->fallback+FALLBACK,
  paid keeps resume+QUOTA, pre-review free->fallback, pre-review paid no
  fallback; the pre-existing quota backoff tests now pin the paid model
  explicitly since the default fixture model is not the free listing);
  `autopilot.test.ts` (free worker with quota error: one `switched` entry with
  paid model + `low` variant, one resume prompt on same session, record model
  saved as paid, no second switch); `client.test.ts` (real client arg capture,
  fake record + unknown-session throw).

Commands and real results:
- `pnpm install`: ok (10.5s).
- Targeted tests `src/lead/fallback.test.ts src/lead/decide.test.ts
  src/lead/autopilot.test.ts src/lead/client.test.ts`: 4 files, 77 tests,
  all passed.
- `src/lead/prompts.test.ts`: 11 passed.
- `pnpm gate`: GATE PASS (install, format, lint, typecheck, @zilar/devtools
  tests all PASS; 15 changed files, all inside the Allowed files).

The lead approved adding `switchModel` stubs in `launch.test.ts` and
`watch.test.ts`; the gate passes.

Security checklist: no secrets/tokens in logs or code; no deletes/updates;
no caps changed; nothing runs before permission checks; no new routes; audit
log lines carry task id and model only, no message text.

### Round 2 (fix round, 2026-10-05)
Findings fixed:
- Finding 1 (must-fix): pre-review fallback in `decide.ts` now triggers on
  `prereviewQuotaError` regardless of the idle gate (new quota-error block
  before the idle-gated block). Test added: `decide.test.ts` "falls back a
  quota-hit pre-review whose session summarizes as running"
  (`prereviewSessionState: 'running'` + `prereviewQuotaError: true` gives
  `fallback-model` for `prereview` + the FALLBACK line).
- Finding 2 (should-fix): failed `switchModel` in `autopilot.ts` now returns
  the current record (stops remaining actions for the task) instead of
  `continue`, so the `LEAD: FALLBACK` escalation is not emitted when the
  switch did not happen. Test added: `autopilot.test.ts` "logs a failed
  switch without the FALLBACK escalation or a prompt" (throwing
  `switchModel`: no escalations, no prompts, no `LEAD: FALLBACK` log line,
  record model unchanged).
- Nits 3 (stale Report line above) and 4 (transient extra resume prompt)
  left as-is per the fix-round instructions (nits only when in a line
  already changed); finding 4's suggestion would be a behavior change.
- Disagreements: none.
Single tests run: `src/lead/decide.test.ts` (35 passed),
`src/lead/autopilot.test.ts` (22 passed), both with `--reporter=dot`.
Gate: GATE PASS (install, format, lint, typecheck, @zilar/devtools tests
all PASS; 15 changed files, all inside the Allowed files).

## Review (written by Claude)

**Verdict:** Approved after one auto fix round (pre-review fallback no longer waits for idle; a failed switch returns before the prompt and the FALLBACK line). Read the core diff: `fallbackModel` maps only the free Muse to the paid one; `decide` emits `fallback-model` + one `LEAD: FALLBACK` line for a worker quota error or a pre-review quota error on the current head; `applyActions` calls `session.switchModel` (worker with the task's effort as variant, pre-review without), re-prompts the same session (`resume` / new `prereview-resume.md`) and saves the new model in state; other models keep the old retry. Lead allowed `switchModel` stubs in `launch.test.ts` and `watch.test.ts`. Follow-ups: add `'prereview-resume'` to `PromptName` in `prompts.ts` and drop the cast; merge the two `task-file.js` imports in `autopilot.ts`.
