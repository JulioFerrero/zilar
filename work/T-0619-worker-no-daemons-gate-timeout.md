---
id: T-0619
title: "Workers can no longer start daemons or detached runs (deny launchctl, nohup, setsid, disown, crontab, at, osascript, screen, tmux in rules.json; reject the same in the autopilot policy with a clear message), and each gate step gets a time limit (tests 20 min, other steps 10 min) that fails the step with 'timed out' instead of hanging"
status: todo
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

## Review (written by Claude)
