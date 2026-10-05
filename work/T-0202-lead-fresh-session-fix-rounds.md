---
id: T-0202
title: Lead tooling: fix rounds run in a fresh worker session instead of the long original one (token saving)
status: planned
milestone: M5
branch: task/T-0202-lead-fresh-session-fix-rounds
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0200]
estimate: 1 day
---

# T-0202: Fix rounds run in a fresh worker session

## Spec (written by Claude, do not edit)

### Why
Measured by the lead on 2026-10-05 from OpenCode's own token counts: worker sessions read about 250 input tokens per output token. T-0173's worker session had 6 prompts and 346 steps, and every step re-sent on average 138k tokens of context (up to 217k). The reason: every fix round (the autopilot's AUTOFIX and the lead's `lead reply`) is sent into the ORIGINAL session, which by then carries every file read, test log and earlier round. A fresh session that reads only AGENTS.md, the task file, PREREVIEW.md and the files the findings name starts near 15k. Julio asked for this fix.

### Verified facts (do not re-derive)
- `decide` (`packages/devtools/src/lead/decide.ts` lines 182-191) emits `{ kind: 'send-prompt', template: 'autofix' }` and then a `record` patch with `autoFixRounds: round` only when the worker session is idle (`input.sessionState === 'idle'`, line 167). The send comes BEFORE the patch, so at send time `current.autoFixRounds` is the previous round number.
- `applyActions` in `packages/devtools/src/lead/autopilot.ts` (lines 145-153) handles every `send-prompt` the same way: renders the template with `TASK`, `TASK_FILE`, `WORKTREE`, `BRANCH` and calls `deps.client.promptDetached(current.sessionId, prompt)`. `nudge` and `resume` must keep doing exactly that (they need the session's context).
- At the end of `tickOnce` (`autopilot.ts` lines 286-300) a record is written back only when the fresh file's `sessionId` still equals the one the tick started with; the record being written may carry a NEW `sessionId`, and that is kept.
- `AutopilotDeps` has `client`, `runner`, `statePath`, `promptsDirPath` and `repoRoot` (added by T-0196).
- `startWorkerSession` in `packages/devtools/src/lead/launch.ts` (line 130) shows how a session is created: `client.createSession({ title, agent: 'build', model, directory: worktree, permissions: rules })`, then `client.promptDetached(sessionId, prompt)`. Rules come from `loadRulesFile(path.join(promptsDirPath, 'rules.json'))` (`prompts.ts` line 18). The model is `{ ...splitModel(modelString), variant: effort }` (`launch.ts` line 155; `splitModel` in `task-file.ts` line 33; `effort` from `readTaskFrontMatter(repoRoot, task).effort`, `launch.ts` line 43).
- `resetRecordForSwitch` in `packages/devtools/src/lead/switch-model.ts` (line 27) lists the per-session fields a new session must reset; it is not exported.
- `replyToWorker` in `packages/devtools/src/lead/reply.ts` (line 13) interrupts the session and calls `promptDetached` with the lead's text. The CLI parses `reply <T-XXXX> <prompt-file>` in `packages/devtools/src/lead/cli.ts` (line 166, usage line 31).
- `PromptName` is a union in `packages/devtools/src/lead/prompts.ts` (lines 6-7).

### What to build
1. New `packages/devtools/src/lead/fresh-session.ts`:
   - `freshSessionRecord(record: TaskRecord, sessionId: string): TaskRecord`: returns the record with the new `sessionId` and these per-session fields reset: `nudgesSent: 0`, `lastQuotaRetryAt: undefined`, `lastQuotaEscalatedAt: undefined`, `stalledEscalated: false`, `escalatedPermissionIds: []`, `escalatedQuestionIds: []`. Everything else (`autoFixRounds`, `prereview`, `packetReadyForHead`, `model`, `worktree`, `startedAt`) is kept.
   - `async startFreshWorkerSession(deps: { client; promptsDirPath; repoRoot }, input: { task: string; record: TaskRecord; title: string; prompt: string }): Promise<string>`: model `{ ...splitModel(input.record.model), variant: readTaskFrontMatter(deps.repoRoot, input.task).effort }`, rules from `rules.json`, `createSession` in `input.record.worktree` with agent `build`, then `promptDetached`. Returns the new session id. It never touches git or the state file.
2. `autopilot.ts` `applyActions`: when `action.template === 'autofix'`, render the autofix prompt as today, call `startFreshWorkerSession` with title `<task> autofix round <current.autoFixRounds + 1>`, set `current = freshSessionRecord(current, newId)`, and log `<task> autofix round N in fresh session <id>`. Do not interrupt the old session (it is idle). `nudge` and `resume` are unchanged.
3. `packages/devtools/prompts/autofix.md`: rewrite the first lines for a fresh session. It must say: you are an implementer picking up task {{TASK}} in a FRESH session for a fix round; read AGENTS.md (the pitfalls and "Running tests" sections), `work/{{TASK_FILE}}` (Spec and Report) and `PREREVIEW.md` at {{WORKTREE}}; orient with `git log --oneline main..HEAD` and `git diff --stat main...HEAD`; open only the files the findings name. Keep the current numbered rules 1-5 and the last paragraph unchanged in meaning. Remove "in this same session". Run single tests with `--reporter=dot`.
4. `lead reply <T-XXXX> <prompt-file> --fresh`: interrupts the old session with `client.tryInterrupt` (abort with an error on `kind: 'error'`, like `switch-model.ts` does), then starts a fresh session whose prompt is the new template `packages/devtools/prompts/fresh.md` rendered with `TASK`, `TASK_FILE`, `WORKTREE`, `BRANCH`, followed by a blank line and the prompt file's text. `fresh.md` says: you are an implementer continuing task {{TASK}} in a fresh session at {{WORKTREE}} on branch {{BRANCH}}; read AGENTS.md and `work/{{TASK_FILE}}` first; orient with `git log --oneline main..HEAD`; the lead's instructions follow. Write the state through `updateState`, only if the record still has the old session id, with `freshSessionRecord`. Add `'fresh'` to `PromptName`. Without `--fresh`, `lead reply` behaves exactly as today. Update the usage line.
5. Tests (Vitest, the fakes `autopilot.test.ts` already uses):
   - an autofix action creates a NEW session (fake client records `createSession` with the worktree as directory and the task's model), sends the autofix prompt to it, never `promptDetached`s the old session, and the state file afterwards has the new session id with `nudgesSent` 0 and `autoFixRounds` incremented;
   - a nudge still goes to the old session;
   - `freshSessionRecord` keeps `autoFixRounds`, `prereview` and `packetReadyForHead` and resets the listed fields;
   - `lead reply --fresh` interrupts, creates a session, its prompt contains the rendered `fresh.md` and the file's text, and the state has the new id; without `--fresh` nothing changes from today (existing tests);
   - the autofix and fresh prompts render with no `{{` left (`prompts.test.ts` style).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/decide.ts` (lines 160-200), `packages/devtools/src/lead/launch.ts`, `packages/devtools/src/lead/switch-model.ts`, `packages/devtools/src/lead/reply.ts`, `packages/devtools/src/lead/cli.ts`, `packages/devtools/src/lead/prompts.ts`, `packages/devtools/prompts/autofix.md`, `packages/devtools/src/lead/autopilot.test.ts`.

### Allowed files
`packages/devtools/src/lead/fresh-session.ts`, `packages/devtools/src/lead/fresh-session.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/autopilot.test.ts`, `packages/devtools/src/lead/reply.ts`, `packages/devtools/src/lead/reply.test.ts` (new), `packages/devtools/src/lead/cli.ts`, `packages/devtools/src/lead/prompts.ts`, `packages/devtools/src/lead/prompts.test.ts`, `packages/devtools/prompts/autofix.md`, `packages/devtools/prompts/fresh.md`, `work/T-0202-lead-fresh-session-fix-rounds.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead
pnpm gate
```
`pnpm gate` already runs install, format, lint, typecheck and the package tests; do not run those separately.

### Acceptance
- An AUTOFIX round and `lead reply --fresh` run in a new session in the same worktree; the old session receives nothing; the state points at the new session and keeps the round count.
- `nudge`, `resume` and plain `lead reply` behave as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Changing what `decide` decides, the pre-review, the gate, `switch-model`, any new dependency.

---

## Report (written by the worker when done)

## Review (written by Claude)
