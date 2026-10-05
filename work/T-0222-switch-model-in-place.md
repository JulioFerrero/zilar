---
id: T-0222
title: "Lead tooling: lead switch-model --in-place switches the same session and records the new model"
status: merged
milestone: M5
branch: task/T-0222-switch-model-in-place
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0216]
estimate: 0.2 day
---

# T-0222: `lead switch-model --in-place`

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "fix the cosmetic free detail". The lead moved T-0219's worker to the paid Muse by hand with `opencode2 api session.switchModel`, so the session runs on the paid model but `state.json` still says `opencode/muse-spark-1.3-contributor-free`, and `lead watch` shows the badge `Muse · low free`. `lead switch-model` today always interrupts and opens a new session. The lead needs a command that switches the same session (keeping its context, as T-0216's autopilot fallback does) and records the model.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/switch-model.ts` (165 lines): `switchModel(task, newModel, extraRulesFile, deps)` (line 66) validates the task, loads state (record must exist and be a `worker`), checks the worktree, runs `assertAllowedModel` and `splitModel`, reads `readTaskFrontMatter(deps.repoRoot, task)`, interrupts with `tryInterrupt` (line 113), starts a new session, and writes the record with `updateState` (lines 151-162, only when the record still points at the old session).
- `packages/devtools/src/lead/client.ts`: `switchModel(sessionId, model: SessionModel)` exists on the client and on `FakeOpenCodeClient` (records into `switched`), added by T-0216.
- `packages/devtools/src/lead/autopilot.ts` (T-0216 fallback branch): calls `deps.client.switchModel(target, { ...splitModel(action.model), variant: effort })` with `effort` from `readTaskFrontMatter`.
- `packages/devtools/src/lead/cli.ts`: usage lines 27-28; `flag(args, name)` (line 60); `runSwitchModel` (lines 187-202) prints `${task} ${sessionId} ${chosen}`.
- `packages/devtools/src/lead/switch-model.test.ts`: `describe('switchModel'` at line 68, uses `FakeOpenCodeClient`.

### What to build
1. In `switch-model.ts`, a new exported `switchModelInPlace(task, newModel, deps): Promise<SwitchModelResult>`: same checks as `switchModel` (task id shape, record exists and is a worker, worktree exists, `assertAllowedModel`); then `deps.client.switchModel(record.sessionId, { ...splitModel(newModel), variant: effort })` with `effort` from `readTaskFrontMatter(deps.repoRoot, task)`; no interrupt, no new session, no prompt. Then `updateState`: when the record still has the same `sessionId`, set only `model = newModel` and `switchedAt = now` (keep every other field). `appendLog(deps.statePath, `${task} switched worker to ${newModel} in place (lead)`)`. Return `{ sessionId: record.sessionId, model: newModel }`. A client error propagates (nothing written).
2. `cli.ts`: `lead switch-model <T-XXXX> <provider/model> --in-place` calls `switchModelInPlace`; `--in-place` together with `--extra-rules` is an error (`--extra-rules needs a new session; drop --in-place`). Update the usage text (`[--in-place]`, and say in-place keeps the session and its context; send `lead reply` after it if the worker is idle).
3. Tests in `switch-model.test.ts`: the same session gets one `switched` entry with the model and the task's effort as variant; no interrupt and no new session (`created` empty, `interrupted` empty); the state record keeps its `sessionId`, nudges and prereview but has the new `model` and a `switchedAt`; an unknown task, a missing worktree and a banned model are refused before any client call.
4. `docs/LEAD_HANDOFF.md`: in the Models line (line 22), after "(`lead switch-model`)", add: "; `lead switch-model T-XXXX meta/muse-spark-1.3-contributor --in-place` keeps the same session and its context (then `lead reply` if the worker is idle)".

### Read first
`AGENTS.md`, `packages/devtools/src/lead/switch-model.ts`, `packages/devtools/src/lead/switch-model.test.ts` (lines 1-130), `packages/devtools/src/lead/cli.ts` (lines 20-70 and 185-205), `packages/devtools/src/lead/autopilot.ts` (the `fallback-model` branch).

### Allowed files
`packages/devtools/src/lead/switch-model.ts`, `packages/devtools/src/lead/switch-model.test.ts`, `packages/devtools/src/lead/cli.ts`, `docs/LEAD_HANDOFF.md`, `work/T-0222-switch-model-in-place.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/switch-model.test.ts
pnpm gate
```

### Acceptance
- `lead switch-model T-XXXX meta/muse-spark-1.3-contributor --in-place` switches the existing session's model and saves the model in `state.json`, so `lead status` and `lead watch` show it; the old behaviour without the flag is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Switching pre-review sessions by hand, switching back to free automatically.

---

## Report (written by the worker when done)

Implemented `lead switch-model <T-XXXX> <provider/model> --in-place`.

Files changed:
- `packages/devtools/src/lead/switch-model.ts`: new exported `switchModelInPlace(task, newModel, deps)` — same checks as `switchModel` (task id shape, worker record, worktree, `assertAllowedModel`), then `client.switchModel(record.sessionId, { ...splitModel(newModel), variant: effort })` with `effort` from `readTaskFrontMatter`; no interrupt, no new session, no prompt. `updateState` sets only `model` and `switchedAt` when the record still points at the same `sessionId`; appends `${task} switched worker to ${newModel} in place (lead)` to lead.log. Client errors propagate before any write.
- `packages/devtools/src/lead/cli.ts`: `runSwitchModel` handles `--in-place` (calls `switchModelInPlace`, prints `${task} ${sessionId} ${chosen}`); `--in-place` with `--extra-rules` errors with `--extra-rules needs a new session; drop --in-place`; usage text updated (`[--extra-rules <file>] [--in-place]`, in-place keeps the session and its context, send `lead reply` after if idle).
- `packages/devtools/src/lead/switch-model.test.ts`: new `describe('switchModelInPlace')` with 5 tests — same-session switch with `{providerID, id, variant}` and task effort as variant, no interrupt/created entries, state keeps `sessionId`/nudges/prereview with new `model`+`switchedAt` and the log line; client failure writes nothing; unknown task, missing worktree, banned model refused with zero client calls.
- `docs/LEAD_HANDOFF.md`: Models line extended with the `--in-place` command and the `lead reply` note.

Commands:
- `pnpm install`: ok (10.7s). Note: it touched `pnpm-lock.yaml` (optional native peer entries `bufferutil`, `utf-8-validate`); reverted with `git checkout -- pnpm-lock.yaml` so the tree has only Allowed files.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/switch-model.test.ts`: 16 passed, 16 total (11 existing + 5 new). One iteration: first run had 1 failure — I wrongly asserted `prompted` empty, but `launchTask` (test setup) prompts once; fixed the assertion to `toHaveLength(1)` with a comment.
- `pnpm gate`: first run GATE FAIL on format (`switch-model.test.ts` prettier); ran `prettier --write` on the touched files, reverted the lockfile side effect, re-ran: `PASS install (frozen) (0.9s) / format (10.6s) / lint (0.9s) / typecheck (2.6s) / tests @zilar/devtools (0.8s)`, `scope: every changed file is inside the Allowed files`, GATE PASS. 5 changed files.

### Round (fix round, 2026-10-05)
- Fixed should-fix finding 1 (cli.ts HELP + usage error): usage text now says in-place "keeps the same session and its context" and to "send lead reply after it if the worker is idle". No behaviour change, so no new test (spec item 2 test coverage unchanged; existing 16 switch-model tests still pass).
- Disagreements: none.
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/switch-model.test.ts` — 16 passed, 16 total.
- Gate: `PASS install (frozen) (0.9s) / format (10.8s) / lint (0.6s) / typecheck (2.4s) / tests @zilar/devtools (1.0s)`, scope clean, GATE PASS. 5 changed files.

Security checklist: no secrets/tokens logged (only task id, session id, model name in the log line); no deletes/updates outside the single scoped task record (guarded on unchanged `sessionId`); no caps/uniqueness involved; no permission gating (lead-internal CLI); no message text in the log; no new routes. N/A items do not apply.

Deviations: none. The old `switchModel` path is unchanged.

## Review (written by Claude)

**Verdict:** Approved after one auto fix round, then clean (worker and both pre-reviews moved to paid Muse in place by the T-0216/T-0221 fallback). `switchModelInPlace` does the same checks as `switchModel`, calls `client.switchModel` on the existing session with the task's effort, and writes only `model` and `switchedAt` under the same-session guard; `--in-place` refuses `--extra-rules`; usage and `LEAD_HANDOFF.md` updated. Read the whole code diff.
