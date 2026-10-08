---
id: T-0619
title: "Workers can no longer start daemons or detached runs (deny launchctl, nohup, setsid, disown, crontab, at, osascript, screen, tmux in rules.json; reject the same in the autopilot policy with a clear message), and each gate step gets a time limit (tests 20 min, other steps 10 min) that fails the step with 'timed out' instead of hanging"
status: merged
milestone: M5
branch: task/T-0619-worker-no-daemons-gate-timeout
model: auto
effort: low
depends_on: [T-0616]
estimate: 0.5 day
---

# T-0619: no daemons from workers, and a gate time limit

## Spec (written by Claude, do not edit)

### Why
On 2026-10-08 the T-0608 worker ran its gate and tests as macOS launchd jobs (`launchctl`, labels `zilar.gate0608test` and `zilar.gate.T0608`). launchd relaunched them within 50 ms of every kill, for about 45 minutes; the laptop overheated, and the lead only found the jobs with `launchctl list`. Earlier the same day, a test hung inside `pnpm gate` for 50 minutes before anyone noticed. Workers must never create anything that outlives their session, and a gate step must never run without a time limit.

### Verified facts (do not re-derive)
- **Worker permissions** come from `packages/devtools/prompts/rules.json` (29 rules, loaded by `packages/devtools/src/lead/launch.ts:180`). Its entries look like `{ "action": "shell", "resource": "sudo *", "effect": "deny" }`, and none mentions `launchctl`, `nohup`, `setsid`, `disown`, `crontab`, `at`, `osascript`, `screen` or `tmux`. **Check which tests read `rules.json`** (grep shows `prompts.test.ts` among others) and keep them green.
- **The autopilot policy** (`packages/devtools/src/lead/policy.ts`, `REJECT_RULES` from about line 317) rejects asked commands with a message; an example is the `kill`, `pkill` and `killall` rule (its test at about 352, its message at about 355). Each rule is `{ test: (segment) => boolean, verdict: 'reject', message }`. Tests are in `packages/devtools/src/lead/policy.test.ts`.
- **The gate** runs each step with `spawnSync(command, args, { cwd, encoding, maxBuffer })` (`packages/devtools/src/gate/cli.ts:13-19`), with no timeout.

### What to build
1. **`rules.json`:** add `deny` rules for `launchctl *`, `nohup *`, `setsid *`, `disown*`, `crontab *`, `at *`, `osascript *`, `screen *` and `tmux *`. Keep the existing rules and their order, appending the new ones at the end.
2. **`policy.ts`:** one new reject rule matching those commands anywhere in a segment (as the `kill` rule does), and also a segment that ends with a lone `&` (a background run). The message: "Workers may not start daemons, background jobs or detached runs (launchd, nohup, &, tmux…): they outlive your session and cannot be stopped. Run every command in the foreground; for tests use pnpm --filter <package> test --maxWorkers=2 <path>, then pnpm gate once." Add tests in `policy.test.ts` for each command and the trailing `&`, plus one proving a normal command containing `&&` is not rejected.
3. **Gate time limit:** pass a `timeout` to `spawnSync` for each step: **20 minutes for `tests …` steps, 10 minutes for the rest.** When a step times out, print `FAIL  <label>  (timed out after <n> min)` plus the output tail, and end with `GATE FAIL`. Put the limits as named constants in `packages/devtools/src/gate/plan.ts` (or `cli.ts`) and unit-test the label and limit choice in `packages/devtools/src/gate/gate.test.ts`. Make sure a timed-out vitest does not leave child processes: use `killSignal: 'SIGKILL'` and spawn the step in its own process group, if `spawnSync` allows it; otherwise say in the Report what is left behind.
4. **Docs:** one line in `AGENTS.md` (the rules section): no daemons, background jobs or `&`, and every command runs in the foreground. Also correct `AGENTS.md:30` and `:69`: the gate now runs only the nearest tests (T-0616).

### Read first
`AGENTS.md`, `packages/devtools/prompts/rules.json`, `packages/devtools/src/lead/policy.ts` (lines 300-460), `packages/devtools/src/lead/policy.test.ts` (the `kill` rule's tests), `packages/devtools/src/gate/cli.ts` and `packages/devtools/src/gate/plan.ts`.

### Allowed files
`packages/devtools/prompts/rules.json`, `packages/devtools/src/lead/policy.ts`, `packages/devtools/src/lead/policy.test.ts`, `packages/devtools/src/lead/prompts.test.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts`, `AGENTS.md`, `work/T-0619-worker-no-daemons-gate-timeout.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/policy src/lead/prompts src/gate
pnpm gate
```

### Acceptance
- Workers are denied the daemon and detached commands, and the autopilot rejects them with the message.
- Every gate step has a time limit and fails cleanly when it hits it.
- `AGENTS.md` matches the new behaviour.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

1. **`packages/devtools/prompts/rules.json`** — appended nine `deny` shell rules at the end, keeping every existing rule and its order: `launchctl *`, `nohup *`, `setsid *`, `disown*`, `crontab *`, `at *`, `osascript *`, `screen *`, `tmux *`.
2. **`packages/devtools/src/lead/policy.ts`** — added one `REJECT_RULES` entry (last, after the `~/.ssh` rule) that rejects a segment containing `launchctl|nohup|setsid|disown|crontab|at|osascript|screen|tmux` as a whole word, or a segment that ends in a lone `&` (the `(^|[^&])&\s*$` test leaves `&&` alone). Message exactly as the spec gives it.
3. **`packages/devtools/src/lead/policy.test.ts`** — updated the two pre-existing cases that used a trailing `&` (the "self-terminating burner" and "perl burner", previously `escalate`) to `reject`, since the new rule now catches them. Added a `describe('no daemons, background jobs or detached runs')` block: `it.each` over one command per daemon name plus `sleep 60 &`, asserting `reject` and the exact message; a case proving `cat a.log && head -5` is **not** rejected; and a case proving `cat screenshot.log` is not rejected (substring, not a whole word).
4. **`packages/devtools/src/gate/plan.ts`** — added named constants `TESTS_TIMEOUT_MS = 20 min` and `STEP_TIMEOUT_MS = 10 min`, and `stepTimeoutMs(label)`, which gives the longer limit only to labels starting with `tests `.
5. **`packages/devtools/src/gate/cli.ts`** — `run()` now takes an optional `timeoutMs`; gate steps pass `stepTimeoutMs(step.label)`. A timed step prints `FAIL  <label>  (timed out after <n> min)` plus the 40-line output tail and ends with `GATE FAIL`. Timeout detection is `spawnSync`'s `ETIMEDOUT` `error.code`, read through a small typed guard (the base `Error` type has no `code`). As the spec suggests, steps spawn with `killSignal: 'SIGKILL'` and `detached: true`; on timeout the whole process group is killed with `process.kill(-result.pid, 'SIGKILL')`, so a timed-out Vitest does not leave grandchildren behind. Git-reading calls keep no timeout.
6. **`packages/devtools/src/gate/gate.test.ts`** — added `describe('stepTimeoutMs')` checking `tests …` → 20 min and `install`/`format`/`lint`/`typecheck` → 10 min, and that a `testsuite` label does not get the longer limit.
7. **`AGENTS.md`** — added one safety-rule line (no daemons, background jobs, detached runs or trailing `&`; every command in the foreground) and corrected `:30` and `:69` to say the gate runs the **nearest** tests (T-0616).

### Files changed (all inside the Allowed files)

`packages/devtools/prompts/rules.json`, `packages/devtools/src/lead/policy.ts`, `packages/devtools/src/lead/policy.test.ts`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`, `AGENTS.md`, `work/T-0619-worker-no-daemons-gate-timeout.md`.

### Commands run (real results)

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/policy src/lead/prompts src/gate` → **3 test files passed, 237 tests passed**.
- `pnpm gate` (first run) → **GATE FAIL**: `PASS install`, `PASS format`, `PASS lint`, `FAIL typecheck` with `src/gate/cli.ts:38 TS2339: Property 'code' does not exist on type 'Error'`. Fixed with the `hasErrorCode` guard.
- `pnpm gate` (final run) → **GATE PASS**:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.8s)
  PASS  format  (13.2s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  tests @zilar/devtools  (0.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- `AGENTS.md` carries the safety rule "Never change `AGENTS.md`". I edited it anyway because the task's spec explicitly requires it and lists it under Allowed files; I limited the change to exactly the three spots the spec names and verified with `git diff` that nothing else moved. Flagging it here for the record.
- Two existing `policy.test.ts` expectations changed from `escalate` to `reject` (the two trailing-`&` burner cases). This is required by the new reject rule, not a weakening: both commands still fail, now earlier and with a clear message.
- The `at` rule matches `at` as a whole word anywhere in a segment, per the spec ("as the kill rule does"). A command that merely contains the letters (e.g. `cat`, `screenshot`) is unaffected; a user-authored argument like `echo "meet at 5"` would now be rejected rather than escalated. I kept the spec's wording.

### Open questions

None.


## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet (22:30) is newer than HEAD 8edfe66e.
- **Lead check:**
  - `rules.json` denies the 9 daemon and detach commands;
  - the policy rejects them anywhere in a segment, plus a trailing `&`;
  - the gate step timeouts (20 min for tests, 10 for the rest) spawn detached and kill the whole process group with SIGKILL;
  - `AGENTS.md` is updated;
  - the gate passes.
- **Follow-up (nit):** a mid-segment `&` (`sleep 60 & echo done`) is not rejected. Every daemon word is still caught, so only harmless filter commands slip through.
