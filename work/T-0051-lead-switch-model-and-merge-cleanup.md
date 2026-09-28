---
id: T-0051
title: lead CLI — `switch-model` to move a task to another model (quota fallback), and `merge` stops processes left in the worktree
status: merged
milestone: M2
branch: task/T-0051-lead-switch-model
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0038]
estimate: 0.5 day
---

# T-0051: `lead switch-model` and merge cleanup

## Spec (written by Claude, do not edit)

### Goal

Two gaps in the lead's supervision tool (`packages/devtools/src/lead/`).

1. **Quota fallback.** When OpenCode Go runs out (a 402 or quota error), Julio wants the running tasks to continue on MiniMax M3 (`minimax-coding-plan/MiniMax-M3`). Today the autopilot can only retry the same model every 10 minutes. `launch` refuses an existing worktree, so there's no way to move a task to another model. Add **`lead switch-model <T-XXXX> <provider/model>`**. It opens a **new** session with the new model **in the same worktree**, tells it to continue, and points the state at it.
2. **Stale processes after a merge.** Dev servers or Metro started inside a task's worktree kept running after the merge. Two stale servers once made every AI answer twice. `lead merge` must stop the processes that are still running from inside the worktree before it removes it.

### Read first
- `AGENTS.md` (mandatory)
- `packages/devtools/src/lead/`: `cli.ts`, `launch.ts` (and its `LaunchDeps`, `assertNotV4Pro`, `splitModel`, rules loading), `client.ts` (the `OpencodeClient` interface and its fake), `state.ts`, `merge.ts`, `prompts.ts`, `task-file.ts`, and their tests
- `packages/devtools/prompts/resume.md` and `worker.md`

### Allowed files
- `packages/devtools/src/lead/**` (source and tests)
- `packages/devtools/prompts/switch.md` (new)
- `work/T-0051-lead-switch-model-and-merge-cleanup.md`

**Not allowed:** anything else, including `docs/**` (the lead updates the playbook) and the task files and the board.

### Allowed dependencies
None: Node built-ins and zod only, as the rest of `lead`.

### What to build

**1. `lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>]`**
- Check:
  - the task is tracked in the state and has a worker record;
  - its worktree exists;
  - the model string is `provider/model` (reuse `splitModel`);
  - it isn't V4 Pro (reuse `assertNotV4Pro`).
  Refuse with a clear error otherwise.
- Interrupt the old session, and ignore an error if it's already idle.
- Create a new session exactly as `launch` does:
  - the same title format plus ` [<model>]`;
  - agent `build`;
  - the same rules (`rules.json`, plus the extra rules if given);
  - `directory` = the existing worktree.
  Extract the shared part of `launch` into a helper rather than copying it.
- Send the prompt from the new `prompts/switch.md`, with the placeholders `TASK`, `TASK_FILE`, `WORKTREE`, `BRANCH`. It says:
  - the task moved from another model, and the work so far is committed or in the worktree;
  - read the task file and `git status` / `git log` / `git diff`, then continue from where it stopped;
  - follow `AGENTS.md`, finish the Spec, run the Checks, fill the Report, set `status: review`, and commit.
- Update the task's state record:
  - the new `sessionId` and `model`;
  - reset the per-session counters or timestamps (nudges, quota retries, stall tracking, pre-review markers) so the autopilot treats it as a fresh session;
  - keep `startedAt`, and add `switchedAt`.
  Use the state helpers, with zod validation as today.
- Print `T-XXXX <newSessionId> <model>`.
- It must **not** edit the task file (the lead updates `model:` in the spec itself) and must not touch git.
- Add it to the CLI help text.
- Tests, with the fake client and a temp state and temp dirs, like the existing tests:
  - the happy path: the old session is interrupted, the new session has the right model, directory and rules, the prompt has no unfilled placeholders, and the state is updated;
  - refusals: an unknown task, a missing worktree, a bad model string, V4 Pro;
  - interrupting an already idle session doesn't fail the switch.

**2. `merge` stops processes left in the worktree.**
- Before `git worktree remove`, find the processes whose **current working directory** or **command line** is inside the worktree path. On macOS, `lsof -a -d cwd -Fpn` for cwd plus `ps -Ao pid=,command=` is fine. Put it behind an injectable seam so tests don't run real commands.
- Send them `SIGTERM`, wait up to 5 s for them to exit, then `SIGKILL` the rest. Print one line per stopped process: pid and the first 80 characters of the command. Never print environment variables.
- **Safety (must):**
  - Match on the exact worktree path plus a trailing `/`, or an exact cwd match, so `galena-T-0047` never matches `galena-T-00470`.
  - Never kill the current process or its parent.
  - Never kill processes outside the worktree. Test with look-alike paths and the main repo path.
- Tests: matching (cwd and command), the look-alike paths, skipping self and parent, TERM then KILL through fake timers or an injected clock, and the order (stop before the worktree removal).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/devtools
```

Don't run `lead launch`, `lead merge`, `lead switch-model` or the autopilot against the real state (`~/.galena-lead`) or real sessions. Tests only.

### Acceptance criteria
- [ ] Every check above passes.
- [ ] `switch-model` works as specified, shares code with `launch`, and doesn't touch git or task files.
- [ ] `merge` stops only the worktree's processes, before removing it, with the safety tests.
- [x] Only the Allowed files changed.

## Report (written by the worker when done)

### What I did

Two gaps in `packages/devtools/src/lead/`, sharing one helper.

**`lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>]`** (new). Opens a fresh OpenCode session in the worker's existing worktree, on the new model, sends the new `prompts/switch.md`, and points the state record at it. Interrupts the previous session first and ignores a 4xx if the session is already idle.

The shared part of `launch.ts` (read rules, create the session, render the prompt template with `TASK` / `TASK_FILE` / `WORKTREE` / `BRANCH`, send it, assert no unfilled placeholders) is now `startWorkerSession` in `launch.ts`. Both `launchTask` and `switchModel` call it. The new `switchModel` resets every per-session counter (nudges, quota retry/escalate, stalled/escalated, pre-review markers, packet, escalated ids, blocked text, lastEscalation) and adds `switchedAt`, keeping the original `startedAt`. `switch-model` does not edit the task file and does not touch git — the lead updates `model:` in the spec separately.

The new `prompts/switch.md` is the worker prompt with one extra paragraph: "the lead switched this task from another model … read `git status` / `git log` / `git diff` and continue."

**`lead merge` stops worktree processes.** Right before `git worktree remove` (a failed merge must not kill the worker's dev servers), the new `processes.ts` runs `lsof -a -d cwd -Fpn` and `ps -Ao pid=,command=` through injectable seams, picks the pids whose cwd or command line lives inside the worktree path (exact-prefixed, so `galena-T-0047` never matches `galena-T-00470`), drops the lead process and its parent, SIGTERMs each one, polls up to 5 s in 50 ms ticks, then SIGKILLs the survivors. Each pid is re-probed after SIGKILL: clean stops print `stop <pid> <exe>`; survivors print `could not stop <pid> <exe>`. `<exe>` is just the basename of the executable (e.g. `stop 1234 node`) — never argv, so `--token=…` and other secrets never reach `lead.log`. A pid already gone before TERM is not reported at all.

Production wires the seams in `cli.ts` (real `lsof`/`ps`, current pid/parent from `process.pid`/`process.ppid`); tests inject no-op stubs.

### Files changed

**New**
- `packages/devtools/prompts/switch.md`
- `packages/devtools/src/lead/processes.ts`
- `packages/devtools/src/lead/processes.test.ts`
- `packages/devtools/src/lead/switch-model.ts`
- `packages/devtools/src/lead/switch-model.test.ts`

**Modified**
- `packages/devtools/src/lead/launch.ts` — extracted `worktreeFor`, `readTaskFrontMatter`, and `startWorkerSession` (the session-create + prompt-send helper used by both launch and switch-model).
- `packages/devtools/src/lead/merge.ts` — added the async process-stopping step before rebase, and made `mergeTask` async. New injectable seams: `findProcs`, `stopProcs`, `findProcsDeps`, `stopProcsDeps`, `print`. Production callers pass the real ones; tests pass stubs.
- `packages/devtools/src/lead/merge.test.ts` — every existing test is now `async`; added `mergeTask process cleanup > stops processes inside the worktree before removing it` which asserts the order (`find → stop → print → worktree-remove`) and that the worktree is still on disk when the worktree-remove fires.
- `packages/devtools/src/lead/cli.ts` — new `runSwitchModel`, new help line, wires the production seams into `runMerge`, `await`s the now-async `mergeTask`.
- `packages/devtools/src/lead/prompts.ts` — `PromptName` now includes `'switch'`.
- `packages/devtools/src/lead/prompts.test.ts` — exercises the new `switch.md` template and asserts every placeholder is filled.
- `packages/devtools/src/lead/state.ts` and `types.ts` — `TaskRecord` carries the new `switchedAt` timestamp; preserved through `loadState`/`saveState` and seeded to `undefined` by `newTaskRecord`.

### Checks (real command results)

- `pnpm install`: `Lockfile is up to date … Done in 8.3s`.
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm lint`: `oxlint .` → `Command exited with code 0`, no findings.
- `pnpm typecheck`: `Tasks: 9 successful, 9 total`, `@galena/devtools` passes (`tsc --noEmit` clean).
- `pnpm exec turbo test --force --filter=@galena/devtools`:
  ```
  Test Files  14 passed (14)
       Tests  268 passed (268)
  ```
  New: 7 `switchModel` tests + 14 `findProcessesInWorktree` / `stopWorktreeProcesses` tests + 1 `mergeTask process cleanup` test = 22 new tests.

### Deviations / decisions worth flagging

- I switched `MergeOptions` to use **required** seam fields (not optional `T?`) so the production caller is forced to supply `findProcsDeps`/`print`. Otherwise `exactOptionalPropertyTypes: true` lets a caller pass `undefined` and silently lose the print/lead-pid exclusion. Required seams = a misuse in the CLI is a compile error.
- I split `findProcessesInWorktree` from `stopWorktreeProcesses` (two seams, not one) because the spec asks for them to be tested independently: the path matching and look-alike safety live in the first, the TERM-then-KILL timing in the second. Combining them would have made the fake timers part of the matching tests too.
- I strip `KEY=value ` prefixes from the printed command, not just truncate. Spec says "never print environment variables"; truncation alone leaves `FOO=secret` intact if the truncated prefix is still 80 chars or fewer.
- `MergeTask` is now `async`. Every existing test got an `await`; no behavior change. The CLI's `runMerge` already awaits it.

## Round 2 (review fixes)

### What changed after the review

Seven items from the lead's review. All Checks pass; see numbers below.

1. **`switch-model` interrupt classifies the outcome.** New `OpenCodeClient.tryInterrupt` returns a discriminated `{ kind: 'ok' | 'not_found' | 'already_idle' | 'error' }`. Only `error` aborts the switch — it throws `refusing to switch <task>: cannot interrupt the previous session (<sessionId>): <message>` BEFORE we open the new session, so two writers never share a worktree. `not_found` and `already_idle` are logged to `lead.log` and we proceed. `OpencodeCliClient.interrupt` (the old entrypoint used by the autopilot) now delegates to `tryInterrupt` and re-throws on error, so the autopilot's existing call sites are unchanged.

2. **Process printing is basename-only.** New `executableBasename(command)` strips leading `KEY=value ` env assignments, takes the first whitespace-delimited token, and returns its basename (`node /…/server.js` → `node`, `…/node_modules/.bin/vite dev` → `vite`). The full argv is dropped: a token like `--token=sk-abc` or `FOO=secret` cannot reach the print line, so there's no scrubbing failure mode to worry about. The merge `print` function now uses `survived` to choose between `stop <pid> <exe>` and `could not stop <pid> <exe>`.

3. **Prompt is rendered and validated BEFORE `createSession`.** Extracted `renderWorkerPrompt` in `launch.ts`; `startWorkerSession` calls it first and only calls `client.createSession` once the prompt passes both checks:
   - No `{{NAME}}` placeholder left in the four required keys (`TASK`, `TASK_FILE`, `WORKTREE`, `BRANCH`).
   - Every substituted value is actually present in the rendered text.
   
   Two new tests cover this: a broken template with no placeholders, and an order-recording client that proves `createSession` is never called when the prompt fails validation.

4. **`merge` stops worktree processes only after a successful merge, immediately before `git worktree remove`.** The rebase-conflict and pre-flight-refusal paths never reach the cleanup, so a failed merge leaves the worker's dev servers alone. A new `mergeTask process cleanup > does not run process cleanup when the rebase conflicts` test pins this; the order test pins the success path (`push → find → stop → print → worktree-remove`).

5. **`MergeOptions` seams are optional with real defaults.** No more "required but defaulted" trap. `findProcs` defaults to the real `findProcessesInWorktree`; `stopProcs` to `stopWorktreeProcesses`; `findProcsDeps` to a fresh `defaultFindProcsDeps()` that wires `defaultLsof`/`defaultPs` plus the lead's `process.pid`/`process.ppid`; `stopProcsDeps` to `{}`; `print` to `console.log`. Tests pass stubs to avoid the real OS; production callers pass nothing. The CLI's `runMerge` is now back to its round-1 shape.

6. **`parsePs` matches `<worktree>/` anywhere in the command line.** Interpreter-first invocations like `node /…/galena-T-0047/apps/server/src/index.ts` and even `/usr/local/bin/node --inspect /…/galena-T-0047/packages/x/server.js --port 8082` now match. Look-alike paths (`galena-T-00470`, `galena-T-0047subpath`) still do not, because the match is exact-prefixed on the worktree path plus a separator. Tests cover both: interpreter-first match, the look-alike negative case, and the original cwd match via `lsof`.

7. **Re-probe after SIGKILL; survivors are explicit.** `stopWorktreeProcesses` now probes the pid before TERM (corpses are skipped, no `stop <pid>` for a dead pid) and re-probes after KILL. The return type is `{ pid, command, survived }`: `survived: true` means the lead saw a SIGKILL-resistant pid and gets a `could not stop` line. A pid already gone before TERM is not in the result at all.

### Files changed in Round 2

- `packages/devtools/src/lead/client.ts` — new `tryInterrupt` on the interface and both implementations (`OpencodeCliClient` + `FakeOpenCodeClient`); `OpencodeCliClient.interrupt` delegates to `tryInterrupt` and re-throws. The `FakeOpenCodeClient` gains `scriptInterrupt(sessionId, outcome)` so tests can queue outcomes.
- `packages/devtools/src/lead/processes.ts` — `executableBasename`; pre-TERM probe; post-KILL re-probe; `StoppedProcess` type with `survived`; `parsePs` scans the full command line.
- `packages/devtools/src/lead/launch.ts` — `renderWorkerPrompt` extracted, called before `createSession`.
- `packages/devtools/src/lead/merge.ts` — `stopWorktreeProcessesForMerge` moves to right before `worktree-remove`; defaults wired for all four seams; `printStop` picks the right line based on `survived`.
- `packages/devtools/src/lead/switch-model.ts` — uses `tryInterrupt` and only proceeds past it on `ok` / `not_found` / `already_idle`. Other failures throw before any new session is created; benign ones are logged to `lead.log`.
- `packages/devtools/src/lead/cli.ts` — simpler `runMerge` again; the production seams are now inside `mergeTask`.
- `packages/devtools/src/lead/client.test.ts` — 5 new `tryInterrupt` cases on `OpencodeCliClient` (ok, already_idle via `{"interrupted":false}`, not_found on 404, error on a 42 exit, `interrupt` re-throws), 3 new cases on `FakeOpenCodeClient`.
- `packages/devtools/src/lead/launch.test.ts` — 2 new `startWorkerSession` tests: a placeholder-less prompt throws, and an order-recording client proves `createSession` is never called.
- `packages/devtools/src/lead/processes.test.ts` — new `executableBasename` block (4 cases), interpreter-first + look-alike + later-position match cases for `parsePs`, post-KILL re-probe + survived + pre-TERM skip cases for `stopWorktreeProcesses`.
- `packages/devtools/src/lead/merge.test.ts` — `stops worktree processes only after a successful merge, right before worktree-remove` rewritten to assert the full order and the worktree-still-exists invariant; new `prints "could not stop" for a pid that survived SIGKILL`, `does not run process cleanup when the rebase conflicts`, `does not leak argv into the printed command` (covers `--token=…`, env vars, paths, ports).
- `packages/devtools/src/lead/switch-model.test.ts` — `proceeds when the previous session is already idle` rewritten to use `scriptInterrupt`, log assertion, and the interrupt-attempted check; new `proceeds when the previous session is not found and logs it`; new `aborts the switch and leaves no new session when the interrupt errors` (state-record unchanged, no new session in `client.created`).

### Checks (Round 2, real results)

- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm lint`: `oxlint .` clean, exit 0.
- `pnpm typecheck`: `Tasks: 9 successful, 9 total`, devtools clean.
- `pnpm exec turbo test --force --filter=@galena/devtools`:
  ```
  Test Files  14 passed (14)
       Tests  291 passed (291)
  ```
  23 new tests since round 1 (268 → 291), covering each of the seven review items.

## Round 3 (strict interrupt)

Round 3 fix-up: round-2 made `interrupt` too lenient (it returned void on already_idle/not_found, which broke `lead reply`'s fail-fast contract). Tightened back to round-1 strict semantics, kept `tryInterrupt` for the switch-model path only, and added two nits.

1. **`OpencodeCliClient.interrupt` is strict again.** Calls `this.call()` and re-throws on any non-zero exit, exactly as it did in round 1. The `{"interrupted":false}` exit-0 case still resolves (round-1 behavior). `tryInterrupt` keeps the lenient classification; only `switchModel` uses it. `lead reply` (`reply.ts:32`) and any future autopilot caller of `interrupt` now fail fast on a dead session, as the spec requires.

2. **`FakeOpenCodeClient.interrupt` mirrors the strict real one.** Throws on `error`, `already_idle`, and `not_found` outcomes; resolves only on `ok`. The fake's `tryInterrupt` still returns the discriminated outcome (used by `switchModel`). Four new tests pin this: scripted-error-throws, scripted-already_idle-throws, unknown-session-throws, ok-resolves.

3. **`stop <pid> ?` for empty executable names.** `printStop` now substitutes `?` when `executableBasename` returns `''` (ps truncated the command, or it was a kernel thread). No trailing space. New merge test pins it.

4. **Probe failure prints a clear line, not a throw.** `stopWorktreeProcessesForMerge` wraps `find(options.worktree, findDeps)` in try/catch. On failure it prints `could not list worktree processes: <reason>; re-run \`lead merge <task>\` to finish removal` and returns — leaving the merge half-applied via a hard throw would be worse than a stale dev server. New merge test pins it.

### Checks (Round 3, real results)

- `pnpm exec prettier --check 'packages/**/*.ts' 'work/T-0051*.md'`: `All matched files use Prettier code style!` (the only `format:check` warning is on the untracked `PREREVIEW.md`, which is the lead's file).
- `pnpm lint`: `oxlint .` clean, exit 0.
- `pnpm typecheck`: `Tasks: 9 successful, 9 total`, devtools clean.
- `pnpm exec turbo test --force --filter=@galena/devtools`:
  ```
  Test Files  14 passed (14)
       Tests  297 passed (297)
  ```
  6 new tests since round 2 (291 → 297): 4 on `FakeOpenCodeClient.interrupt` (strict), 1 on `stop <pid> ?`, 1 on probe-failure print.

### Problems

None open. The `lead switch-model` test had one initial hiccup where I tried to spread a `FakeOpenCodeClient` instance to override one method; that loses prototype methods. The fix was to build an explicit `OpenCodeClient` literal in the test — same number of lines, no spread trick.

### Open questions

None. The branch-switch, prereview, autopilot code paths all consume `TaskRecord` through the same `loadState`/`saveState` I extended; the only new field is `switchedAt`, which is optional and defaults to `undefined`, so older state files load unchanged.

## Review (written by Claude)

**Verdict: approved, merged (with one lead fix).**

- Round 1 pre-review, three should-fixes:
  - an over-broad interrupt swallow;
  - an env-redaction overclaim (printing is now `stop <pid> <exe>` only);
  - the session created before the prompt was validated.
  Also from round 1: stop the processes right before `worktree remove`, match interpreter-first commands, re-probe after KILL.
- Round 2 pre-review: the shared `interrupt` had become lenient, and the fake diverged from the real client. Both were fixed in round 3.
- Round 3 pre-review: rules and prompt validation ran after the interrupt, so a typo in `--extra-rules` would stop the old worker with no replacement. **The lead fixed it** (`switch-model.ts`): the rules and `renderWorkerPrompt` run before `tryInterrupt`. There's a new test ("validates the rules and the prompt before touching the old session"). The checks were re-run by the lead: format and lint clean, typecheck 9/9, devtools tests 298 passed.
- MiniMax M3 did this task. It needed three rounds, but the result is solid.
