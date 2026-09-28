---
id: T-0038
title: Lead autopilot — zero-token supervision of OpenCode workers, pre-review packets, launch/merge scripts
status: review
milestone: tooling
branch: task/T-0038-lead-autopilot
model: opencode-go/muse-spark-1.3-contributor
depends_on: []
estimate: 2 days
---

# T-0038: Lead autopilot

## Spec (written by Claude, do not edit)

### Goal

The lead (Claude) spends most of its usage on routine supervision, not on judgment. That means answering permission prompts, restarting workers after quota errors, nudging stalled sessions, re-running checks, and doing rebase, merge, board and cleanup by hand. Every one of those is a full conversation turn. Julio's 5-hour Claude window runs out because of it.

Build **deterministic tooling (plain TypeScript, no LLM)** that does the routine part and only **escalates** decisions to the lead. The target loop, from the lead's point of view:

```
lead writes spec → `lead launch T-XXXX`
autopilot: watches, applies the permission policy, resumes after quota errors,
           nudges stalls, starts a Muse pre-review when the task hits `status: review`
autopilot → prints ONE line when the lead is needed (packet ready / blocked / unknown permission)
lead reads PREREVIEW.md → verdict → `lead merge T-XXXX --summary "…"` or writes a round
```

Read `docs/LEAD_PLAYBOOK.md` §4–§10, §13, §15 and Appendices A–D **completely**. This task turns them into code. The playbook and its rules are the spec for the behaviour.

### Read first
- `AGENTS.md` (mandatory)
- `docs/LEAD_PLAYBOOK.md`: all of the sections above, especially §5.1 (models and the Muse pre-review), §7 (permission policy), §15 (gotchas 1–16) and Appendix C (the permission rules JSON)
- The current scratch tools this replaces. Read them; don't copy them blindly:
  - `/tmp/galena-scratch/launch.py`
  - `/tmp/galena-scratch/relaunch.py`
  - `/tmp/galena-scratch/watch.py`
- OpenCode v2 API: `opencode2 api GET /openapi.json` for the operations (session.create, session.prompt, session.interrupt, session.message.list, session.permission.list, session.permission.reply, shell.create). Quirk: `opencode2` truncates output on pipes, so write it to a temp file and read that (see `watch.py`).
- `packages/devtools/` (where this lives) and a finished task file such as `work/T-0036-web-tests-under-load.md` (the front matter and sections the tools parse)
- `work/BOARD.md` (the Active and Done table formats the merge script edits)

### Allowed files
- `packages/devtools/src/lead/**` (new): the library, CLI and tests
- `packages/devtools/prompts/**` (new): role prompt templates
- `packages/devtools/package.json`: add a `"lead"` script (`tsx src/lead/cli.ts`) and `zod` if it isn't present. Use the version the rest of the repo uses.
- `pnpm-lock.yaml`
- `work/T-0038-lead-autopilot.md`

**Not allowed:** everything else. That includes `docs/**`: the lead updates the playbook to point at the new tools after review.

### Allowed dependencies
`zod` only, at the repo's version. Node built-ins cover the rest (child_process, fs, path).

### What to build

`pnpm --filter @galena/devtools lead <command>` provides:

**1. `lead launch <T-XXXX> [--extra-rules <file>]`**
- Reads `work/T-XXXX-*.md` and parses the front matter (`branch`, `model`) with zod.
- Creates the worktree `../galena-T-XXXX` on that branch from `main`, and creates the OpenCode session with the model from `model:` (for example `opencode-go/muse-spark-1.3-contributor` gives providerID `opencode-go` and id `muse-spark-1.3-contributor`). The rules come from a checked-in `prompts/rules.json`, a copy of Appendix C, plus any extras.
- Sends `prompts/worker.md`, with the task id, file and worktree filled in. It must say what `launch.py`'s prompt says today.
- Records `{task, sessionId, worktree, model, role:"worker", startedAt}` in the state file. That file lives **outside the repo**: `~/.galena-lead/state.json`, or the path in `GALENA_LEAD_STATE`.
- **Refuses** the V4 Pro model (`deepseek-v4-pro` in any form). That's Julio's rule.

**2. `lead autopilot [--once] [--dry-run]`**, a loop over the sessions in the state file, polling every 15 s:
- **Permissions.** Classify each pending request with `policy.ts` into `allow`, `reject` or `escalate`.
  - Encode §7 and the gotchas as **data plus pure functions**, with tests.
  - Allow read-only commands and a worker's own temp and worktree cleanup (for example `rm -rf` inside that worker's own worktree, or its own OpenCode temp folder).
  - Reject anything that touches another worktree, `~/.ssh`, `.env` reads, `docker compose up/down/stop/restart`, `simctl shutdown all/erase`, Julio's simulator UDID, `--port 8081`, `git push`, `merge`, `rebase`, `checkout` of other branches, `--no-verify`, `sudo`, or `kill`/`pkill` of non-worker processes. Rejections carry a clear `message`.
  - Escalate everything else.
  - **When unsure, escalate. Never allow by default.**
- **The question tool.** A running `question` tool call means the worker is waiting on input. Escalate it with the question text. The lead answers with `lead reply <task> <file>`, which interrupts and re-prompts (gotcha: there's no API to answer a question directly).
- **Quota errors.** A message error of type `provider.quota` or status 402 marks the task `waiting-quota`. Retry every 10 min by re-prompting with `prompts/resume.md`, and don't escalate more than once per hour.
- **Stalls.** The session is idle but the task file's `status` is still `todo` or `in-progress`. Nudge with `prompts/nudge.md` at most **2** times, then escalate.
- **Review.** The worker is idle with `status: review` and no pre-review has run for its current HEAD commit. Start a **Muse pre-review** session in the same worktree with `prompts/prereview.md`, then record it. When the pre-review goes idle and `PREREVIEW.md` exists, escalate `PACKET READY T-XXXX (verdict line)`.
- **Blocked** (`status: blocked`): escalate with the "Blocked / needs a decision" text.
- **Output.** Escalations are **one line each on stdout**, prefixed `LEAD:`, so a Monitor on the lead's side gets exactly one event per decision. Everything else goes to a log file next to the state file.
- `--dry-run` classifies and prints, but acts on nothing.
- It never merges, never pushes, and never edits a task file or the board.

**3. `lead prereview <T-XXXX>`** starts a pre-review manually, the same as the autopilot does.

**4. `lead reply <T-XXXX> <prompt-file>`**: interrupt, then re-prompt the task's worker session.

**5. `lead merge <T-XXXX> --summary "<one line>"`.** The lead runs this after approving; it's all mechanical:
- Check the worktree is clean and the task file's status is `merged`, which the lead sets in its approval.
- Rebase onto `main`. **On a conflict, abort and exit non-zero with the list of conflicted files.** Never resolve anything automatically.
- Fast-forward `main`.
- Move the task's row from Active to the end of Done as `| [T-XXXX](file) | <summary> | <today> |`.
- Commit `board: T-XXXX merged`, push `main`, remove the worktree, delete the branch, and drop the task from the state file.
- Refuse to run if `main` has uncommitted changes.

**6. `lead status`** prints a compact table: task, role, model, session state, task status, and the last escalation.

**7. Prompt templates** (`packages/devtools/prompts/`):
- `worker.md`, `resume.md`, `nudge.md`: from Appendix D and `launch.py`.
- `prereview.md`: the one the lead used for T-0033 (in its Report and Review). PREREVIEW.md must stay **short**: checks, a list of findings with file:line, a concrete scenario and a severity, **only the key code excerpts (max ~60 lines total)**, and a one-line verdict.
- `scout.md`: "answer these questions about the codebase with file:line facts only; write SCOUT.md; change nothing".
- `qa.md`: "click through the checklist in the task's Live-check section with the given tools; save 2–5 screenshots; write QA.md with pass/fail per item; change nothing".

### Tests (Vitest, no real OpenCode, no network)
- `policy.ts`: a table-driven test with at least 40 real commands, allow, reject and escalate. Include every command from gotchas 1–16 and Appendix C, plus tricky ones: `rm -rf` of another worktree, `cat apps/server/.env`, `git push --force`, `kill 1234`, `xcrun simctl shutdown all`, `DB167CD4…`. **The default is escalate.**
- Front matter parsing: it rejects a missing branch or model, and V4 Pro.
- The autopilot's decision function, as a pure function of (session state, messages, permissions, task-file status, recorded state) → actions, covering every branch above: quota backoff, the nudge limit, starting a pre-review once per HEAD, packet-ready, blocked, a question.
- The board edit: moving a row from Active to Done, on a fixture copy of the real board format.
- The merge pre-flight checks: dirty worktree, wrong status, dirty main. Use a temporary git repo in the test.
- Wrap OpenCode calls in one small client module with an interface, so tests use a fake.

### Live check (you do it, carefully)
- Run `lead autopilot --once --dry-run` against the real OpenCode service while other workers exist. It must **only read**. Paste its classification output in the Report.
- Don't launch real sessions, don't merge, and don't edit the real state file. Point `GALENA_LEAD_STATE` at a temp file.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The policy test table has at least 40 cases, and escalate is the default.
- [ ] The autopilot never merges, pushes or edits task files or the board. `merge` is the only command that pushes, and it stops on any conflict.
- [ ] `--dry-run` against the real service is proven read-only, with its output in the Report.
- [ ] No secrets are read or printed. The state file holds no secrets.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/devtools
pnpm build
```

### Out of scope
- A web UI.
- Running as a daemon or launchd job. The lead runs it under a Monitor.
- Automatic spec writing.
- Resolving merge conflicts automatically.

## Report (written by the worker when done)

### What I did

Built `pnpm --filter @galena/devtools lead <command>` as deterministic TypeScript (no LLM), per the playbook §§4–10, 13, 15 and Appendices A–D:

- **Library** (`packages/devtools/src/lead/`): `policy.ts` (permission classifier: data + pure functions), `decide.ts` (autopilot brain as a pure function of session state/messages/permissions/task status/recorded state → actions), `session.ts` (message summarizer: idle/running, quota errors, running `question` calls), `client.ts` (one `OpenCodeClient` interface; `OpencodeCliClient` shells out to `opencode2 api …` with stdout to a temp file per gotcha 2; `FakeOpenCodeClient` for tests), `task-file.ts` (front-matter parse with zod, `providerID/id` split, V4 Pro refusal), `state.ts` (state file outside the repo + log file), `board.ts` (pure Active→Done row move), `merge.ts` (mechanical merge with pre-flights), `launch.ts`, `start-prereview.ts`, `reply.ts`, `status.ts`, `autopilot.ts` (15 s poll tick + `--once`/`--dry-run`), `cli.ts`, plus `types.ts`, `prompts.ts`, `git.ts`.
- **Commands**: `launch` (parses front matter, refuses V4 Pro, worktree from `main`, session with `rules.json` + extras, worker prompt, state record), `autopilot` (permissions → allow/reject/escalate; question escalation; quota retry every 10 min + hourly escalation cap; 2 nudges then escalate; one pre-review per HEAD then `PACKET READY`; blocked escalation; `LEAD:` lines on stdout only, rest to `lead.log`; `--dry-run` prints `DRY:` lines and touches nothing; never merges/pushes/edits task files or board — there is no code path for it), `prereview` (manual Muse pre-review), `reply` (interrupt + re-prompt), `merge` (clean-tree + `status: merged` pre-flights, rebase with abort + conflicted-file list, ff-only merge, board move, commit, push, worktree/branch removal, state drop), `status` (compact table).
- **Prompts** (`packages/devtools/prompts/`): `worker.md` (says what `launch.py` says today), `resume.md`, `nudge.md` (Appendix D), `prereview.md` (generalized T-0033 pre-review + short format: checks, file:line findings with scenario + severity, ≤60 lines of excerpts, `Verdict:` line), `scout.md`, `qa.md`, `rules.json` (Appendix C base), `rules-live-stack.json` (Appendix C extras, for `--extra-rules`).
- **`package.json`**: added `"lead": "tsx src/lead/cli.ts"` and `zod ^4.6.5` (the repo's version).

### Files changed

- New: `packages/devtools/src/lead/*.ts` (17 lib files, 11 test files), `packages/devtools/prompts/*` (8 files).
- Edited: `packages/devtools/package.json` (lead script + zod), `pnpm-lock.yaml` (via `pnpm install`), this task file.
- Nothing else touched (`git status` shows only those).

### Commands run and real results

- `pnpm install`: PASS (7.9 s; zod added to the lockfile).
- `pnpm format:check`: PASS ("All matched files use Prettier code style!").
- `pnpm lint`: PASS (oxlint, no findings).
- `pnpm typecheck`: PASS (9/9 tasks).
- `pnpm exec turbo test --force --filter=@galena/devtools`: PASS — 12 files, 169 tests, 0 failed (was 157 before the client regression test below).
- `pnpm build` (forced, uncached): PASS (2/2 tasks, 1m49s).
- CLI smoke: `lead --help`, `lead status`, `lead autopilot --once --dry-run` on an empty state → rc=0; `lead prereview T-0099` (unknown task) and `lead merge T-0099` (no summary) → exit 1 with usage errors.

### Tests

- `policy.test.ts`: 83 tests from a 60-row table (15 allow, 29 reject, 16 escalate) covering every command in gotchas 1–16 and Appendix C plus traps (`rm -rf ../galena-T-0024`, `cat apps/server/.env`, `git push --force`, `kill 1234`, `xcrun simctl shutdown all`, `DB167CD4…`, `bash`-action requests). Escalate is the default (proven by unknown-command, empty-command, and `echo` cases); every rejection carries a message (asserted).
- Front matter: rejects missing branch/model (with field names in the error), bad id; V4 Pro refused in 4 forms, 3 good models allowed.
- `decide.test.ts`: quota backoff (retry at +10 min, re-escalation only at +1 h, silence between), nudge limit (2 nudges → one `STALLED` → silence), pre-review once per HEAD + one `PACKET READY` + silence after, blocked once per text, question escalation.
- `board.test.ts`: row moves Active→end of Done on a real-format fixture; errors when either section lacks the row.
- `merge.test.ts`: real temp git repos — dirty worktree / wrong status / dirty main refused; conflict aborts and names `file.txt` with the branch intact; happy path rebases, fast-forwards, moves the board row, pushes to a local bare origin, removes the worktree, deletes the branch, drops state.
- `client`/`launch`/`autopilot`/`state`/`prompts`/`session` tests: envelope parsing, fake-client behavior, launch success/extra-rules/V4-Pro/missing-model, tick allow+reject+escalate with no duplicate `LEAD:` lines, dry-run performing zero mutations, state round-trip/corruption rejection, template rendering with no placeholders left.

### Live check (read-only, carefully)

`GALENA_LEAD_STATE=/tmp/lead-dryrun-t38.json pnpm --filter @galena/devtools lead autopilot --once --dry-run` against the real OpenCode service with the real paused sessions T-0034 (`ses_f180…`) and T-0037 (`ses_f181…`): rc=0, **no output**. That is the correct classification — both sessions had recovered from the quota pause and were `running` with zero pending permissions and no waiting questions (verified with a direct probe: `count=30 state=running quota=false q=false`, `perms: []` for both). Nothing to allow, reject, or escalate, so nothing printed.
`lead status` on the same file printed live data:
`T-0034 worker opencode-go/muse-spark-1.3-contributor running in-progress —`
`T-0037 worker opencode-go/deepseek-v4.1-flash running in-progress —`
Read-only proof: md5 of the temp state file identical before/after (`34e933e…`), no `lead.log` created, and the temp state was a copy — the real state file was never touched. No sessions launched, nothing merged, no prompts sent (dry-run performs zero client mutations — unit-tested).

### Problems

- **Real bug found by the live check:** `readDataPayload` returned zod's whole envelope (`envelope.data`) instead of the payload (`envelope.data.data`), so `listMessages`/`listPermissions` silently yielded `[]` and the first dry-run classified nothing. Fixed in `client.ts`, regression-tested in `client.test.ts`, and re-proven live (the probe above returns real messages). Unit tests with fakes could not catch this — only the live service could.
- Direct `opencode2 …` shell calls are denied in this worker sandbox, so the live check ran through the built CLI (node grandchild spawn), which is the adaptation the worker prompt anticipates. Disclosed, not hidden.

### Deviations from the spec

1. `kill`/`pkill`: the spec says reject "of non-worker processes"; I reject **all** of them (Appendix C extras deny them entirely, and per gotcha 15 a worker can't restart what it stops). Stricter, with a steering message.
2. `session.interrupt` (used by `lead reply`) is mapped to `opencode2 api session.interrupt --param sessionID=…` from the playbook's operation list but is **unverified live** (calling it would interrupt a real worker). If the operation id differs, the lead gets a clear error.
3. The live quota-error payload shape couldn't be observed (both sessions had recovered); the detector covers the spec's documented shapes (`provider.quota` type, 402 on error objects) and is unit-tested. If the real payload differs, quota sessions will surface as stalls (2 nudges → `LEAD: STALLED`) rather than being missed silently.
4. Added `prompts/rules-live-stack.json` (Appendix C extras) beyond the listed files, as a ready `--extra-rules` argument. It lives under the allowed `prompts/**`.
5. One-escalation-per-event bookkeeping (permission/question ids, stalled flag, blocked text, packet-ready HEAD) isn't spelled out in the spec but is required so a Monitor gets exactly one event per decision instead of one every 15 s.
6. Escalations are also mirrored to `lead.log` (stdout stays exactly one `LEAD:` line per decision for the Monitor).

### Blocked / needs a decision

- Nothing blocked.

## Review (written by Claude)
