---
id: T-1403
title: "P2 task A: new packages/desk with the jail base image (pinned digest) and the desk-tool daemon (bash, read, write, edit, grep, glob, git over newline JSON on stdio, path-escape and git hardening)"
status: merged
milestone: M5
branch: task/T-1403-desk-image-tool-daemon
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1403: Desk image and tool daemon

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs get a real Linux computer for commands, git, code search and file edits. It must be the **same** on Zilar cloud and on a user's runner (`docs/design/agent-system.md` §2.3 and §2.6).

**The plan is `docs/audit/desk-runner-plan.md`** (merged). This task is its **Task A** (§8). Read §2 (the daemon protocol), §3.1 (the image), §3.2 (the daemon and git hardening) and Task A.

Nothing here runs in production yet; Task B (the sidecar) and Task D (gVisor on the VPS) come next.

### What to build
1. **New workspace package `packages/desk`** (`@zilar/desk`, private, `type: module`, `effect: catalog:` only if you use it). Copy the shape of `packages/protocol/package.json` (scripts `typecheck`, `test`).
2. **`packages/desk/src/protocol.ts`:** the daemon's request and response schemas (Effect Schema), exactly as in plan §2 "The daemon protocol":
   - requests carry `id`, `tool` and `args`;
   - responses are `stream` chunks (`stdout`/`stderr`), then a `done` (with `exit_code` and `truncated`) or an `error` (with `code`);
   - the error codes are from plan §2 "Limits and errors".
3. **`packages/desk/src/serve.ts`:** `desk-tool serve` reads newline-delimited JSON requests on stdin and writes responses on stdout.
   - Requests may overlap (by `id`).
   - A per-request timeout (default 10 min) kills the whole process tree.
   - A total output cap per request (default 1 MB): truncate and set `truncated: true`.
4. **The tools** in `packages/desk/src/tools/` (one file each, all at most 400 lines), with the args and behaviour from plan §3.2's table:
   - `bash` runs `/bin/bash -lc` in a new process group;
   - `read`, `write` and `edit` (edit fails when `oldString` isn't unique, unless `replaceAll`);
   - `grep` (ripgrep `--json`, capped) and `glob` (sorted, capped);
   - `git` with the plan's hardening: config from /dev/null, `core.hooksPath=/dev/null`, `GIT_LFS_SKIP_SMUDGE=1`, `GIT_TERMINAL_PROMPT=0`, `protocol.file.allow=never`. It refuses `-c`, `--config-env`, `--exec` and `--upload-pack` in args, and accepts only `https://` remotes.
5. **`packages/desk/src/paths.ts`:** every path resolves inside the workspace root (default `/workspace`, overridable for tests). Refuse `..`, absolute paths outside the root and **symlink escapes** (resolve with `realpath` on the deepest existing parent) with `path_escape`.
6. **`packages/desk/Dockerfile`**, following plan §3.1:
   - base `node:24-bookworm-slim` **pinned by digest**: look the digest up yourself, for example with `docker buildx imagetools inspect node:24-bookworm-slim`, and write the date in a comment;
   - git, ripgrep, python3, build-essential, ca-certificates and jq;
   - a user `desk` with uid 10001; workdir `/workspace`;
   - the daemon built to one JS file (use `esbuild` if it's already in the repo, else `tsx` at runtime; say which in the Report);
   - `ENTRYPOINT ["/opt/desk/desk-tool","serve"]`.

   Docker is available on this Mac (`docker version` answers 29.8.1). **Build the image once locally** and pipe a `bash` request and an `edit` request into it; paste the exchange in the Report. Don't push the image anywhere.
7. **`packages/desk/README.md`:** a short page with the protocol, the tools, how to build, and how to run one request by hand.

### Tests (security only, per AGENTS.md)
- **`packages/desk/src/paths.test.ts`:** `..`, an absolute path outside the root, a symlink pointing outside, and a legitimately nested path.
- **`packages/desk/src/git.test.ts`:** a repo hook doesn't run; `-c core.hooksPath=…` is refused; a `file://` remote is refused.

### Read first
`AGENTS.md`, `docs/audit/desk-runner-plan.md` (§2, §3, Task A), `docs/design/agent-system.md` §2.3 and §3.

### Allowed files
`packages/desk/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `work/T-1403-desk-image-tool-daemon.md`.

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- The two test files pass.
- The Report shows the local `docker build` result (image size) and one piped `bash` plus one `edit` exchange.

---

## Report (written by the worker when done)

**Status: done, ready for review.** Everything in the Spec is built; `pnpm gate` ends `GATE PASS`
with every changed file inside the Allowed files.

### What I built

New workspace package `packages/desk` (`@zilar/desk`, private, `type: module`, `effect: catalog:`):

- `src/protocol.ts` — the request/response Effect Schemas exactly as plan §2: request `{id,tool,args}`;
  responses are `stream` chunks (`stdout`/`stderr`), then `done` (`exit_code`, `truncated`) or
  `error` (`code`). The eight error codes from plan §2 ("Limits and errors"). Also `DeskError`.
- `src/serve.ts` — `desk-tool serve`: newline JSON on stdin/stdout. Requests overlap by `id`; each
  gets its own timeout (default 10 min; `args.timeout_ms` overrides) and a total stdout+stderr cap
  (default 1 MB). On timeout or cap the tool's whole process group is killed. Invalid JSON/request
  lines get an `error` line.
- `src/paths.ts` — every path resolves inside the workspace root (default `/workspace`,
  `DESK_WORKSPACE_ROOT` to override). Refuses `..`, absolute paths outside the root and symlink
  escapes (`realpath` of the deepest existing parent) with `path_escape`; a NUL byte too.
- `src/process.ts` — `runCommand` spawns in its own process group, caps output, kills the tree on cap
  or abort. Used by `bash`, `grep`, `glob` and `git`.
- `src/capture.ts`, `src/tool.ts` — the byte cap and the `ToolContext`/`ToolOutcome` contract.
- `src/tools/` — `bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`, one file each (all < 100
  lines). `edit` fails when `oldString` is not unique unless `replaceAll`. `grep`/`glob` use
  ripgrep (`--json` / `--files`), capped and sorted. `git` runs with `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `-c core.hooksPath=/dev/null`,
  `-c core.fsmonitor=false`, `-c protocol.file.allow=never`, `GIT_LFS_SKIP_SMUDGE=1`,
  `GIT_TERMINAL_PROMPT=0`; refuses `-c`, `--config-env`, `--exec`, `--upload-pack` (`tool_failed`)
  and any remote that is not `https://` (`host_blocked`).
- `Dockerfile` — base `node:24-bookworm-slim` pinned by digest; git, ripgrep, python3, python3-pip,
  build-essential, ca-certificates, jq; user `desk` uid 10001, workdir `/workspace`;
  `ENTRYPOINT ["/opt/desk/desk-tool","serve"]`.
- `build.mjs` — esbuild bundles the daemon (including `effect`) to one self-contained `dist/desk-tool`
  with a `node` shebang. `README.md` documents the protocol, tools, build and a manual run.

**Digest (resolved 2026-10-14 with `docker buildx imagetools inspect node:24-bookworm-slim`, index
digest, so it resolves per platform):**
`sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`. Written in the Dockerfile
comment with the date.

**Bundler:** `esbuild` (not tsx at runtime). It is already a dependency of `@zilar/server@0.28.2`; I
added `"esbuild": "0.28.2"` to `packages/desk` `devDependencies` so the build is reproducible, and
`build.mjs` mirrors `apps/server/build.mjs`. The image installs no `node_modules`.

### Files changed

Added under `packages/desk/`: `package.json`, `tsconfig.json`, `build.mjs`, `.dockerignore`,
`Dockerfile`, `README.md`, and `src/` `index.ts`, `protocol.ts`, `paths.ts`, `process.ts`,
`capture.ts`, `tool.ts`, `serve.ts`, `paths.test.ts`, `git.test.ts`, `tools/{index,bash,read,write,edit,grep,glob,git}.ts`.
Modified: `pnpm-lock.yaml` (new workspace package + esbuild), `work/T-1403-desk-image-tool-daemon.md`
(status + this Report). `pnpm-workspace.yaml` did not need a change (`packages/*` already matches).

### Commands and real results

```
pnpm --filter @zilar/desk exec vitest run --reporter=dot
  Test Files  2 passed (2)
       Tests  8 passed (8)

pnpm --filter @zilar/desk build
  dist/desk-tool  672.2kb

docker build -t zilar-desk:dev packages/desk
  (build finished; image size 861.7 MB, aarch64 — see notes)

pnpm gate
  gate: 25 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/desk
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
```

**Image size:** `docker image inspect zilar-desk:dev` → 861.7 MB (`903,271,372` bytes). This is much
larger than `node:24-bookworm-slim` because the Spec requires build-essential and python3-pip. Built
for this Mac's architecture (aarch64); the pinned digest is multi-arch, so the VPS pulls amd64.

**Piped `bash` and `edit` exchange (real output).** Requests overlap by design, so in one pipe an
`edit` can race the `bash` that creates its file (I hit that first). To show the edit deterministically
I mounted a named volume at `/workspace` and ran one request per `docker run`:

1. bash —
```
$ printf '%s\n' '{"id":1,"tool":"bash","args":{"command":"uname -m; node --version; git --version; rg --version | head -1; printf \"alpha\\nbeta\\n\" > notes.txt; echo wrote notes.txt"}}' \
    | docker run --rm -i -v zilar-desk-ws:/workspace zilar-desk:dev
{"id":1,"stream":"stdout","data":"aarch64\nv24.21.0\ngit version 2.39.5\nripgrep 13.0.0\nwrote notes.txt\n"}
{"id":1,"done":true,"exit_code":0,"truncated":false}
```
2. edit —
```
$ printf '%s\n' '{"id":2,"tool":"edit","args":{"path":"notes.txt","oldString":"beta","newString":"gamma"}}' \
    | docker run --rm -i -v zilar-desk-ws:/workspace zilar-desk:dev
{"id":2,"stream":"stdout","data":"replaced 1 occurrence(s) in notes.txt\n"}
{"id":2,"done":true,"exit_code":0,"truncated":false}
```
3. read (proves the edit landed) —
```
$ printf '%s\n' '{"id":3,"tool":"read","args":{"path":"notes.txt"}}' \
    | docker run --rm -i -v zilar-desk-ws:/workspace zilar-desk:dev
{"id":3,"stream":"stdout","data":"alpha\ngamma\n"}
{"id":3,"done":true,"exit_code":0,"truncated":false}
```

### Notes, deviations and open questions

- **Effect ratchet.** My first `pnpm gate` runs failed on format, lint (`no-useless-spread`), typecheck
  (`types`/`lib` needed `"types": ["node"]`) and the Effect ratchet, which flagged `paths.ts` and
  `process.ts` as `needs-effect`. I fixed the code rather than using `// effect-plain:` markers:
  `paths.ts` models the `realpath` I/O as an `Effect` and runs it with `Effect.runSync`, and
  `process.ts` keeps a `Promise` module boundary with `Effect.runPromise(Effect.promise(...))`,
  matching `docs/EFFECT_GUIDE.md`'s Promise-boundary rule. Both now classify as `effect`.
- **Output is chunked at the end, not live-streamed.** The wire format allows repeated chunks; this
  daemon emits one `stdout` chunk and one `stderr` chunk, then `done`/`error`. The 10-min timeout and
  the 1 MB cap still kill the process tree mid-run, so a runaway command never hangs. If real-time
  streaming to the card matters, that is a small follow-up in `process.ts`/`serve.ts`.
- **`grep`/`glob` need ripgrep in the image**; both return `tool_failed` if `rg` is missing (the image
  installs it).
- **`git` scans `args` for the remote.** It blocks a URI whose scheme is not `https` (`scheme://`), a
  `file:`/`http:`-style prefix, and scp syntax `user@host:path`. A plain local path is left to git
  (no egress). A commit message such as `fix: x` is not affected (no `://`, not scp-shaped); the
  `git.test.ts` commit uses exactly that message.
- **Not done (out of scope, later tasks):** no run under `--runtime=runsc` (Task D), no sidecar
  (Task B), no server wiring (Task C). The image is not pushed anywhere.
- **Open question for the lead:** the daemon depends on `effect` only for Schema and the two Effect
  boundaries above. That is fine, but if you would rather the jail binary pull in no Effect runtime at
  all, say so and I will swap `paths.ts`/`process.ts` to `// effect-plain:` markers instead. No other
  decisions needed.

### Fix round (pre-review findings)

PREREVIEW had **0 must-fix, 1 should-fix, 4 nits**. I fixed the should-fix; the four
nits are untouched (none sits in a line I changed). One commit:
`T-1403: fix finding 1 - scope the git remote check to remote operands`.

- **Finding 1 (should-fix) — `git` remote scan over-blocked.** `git.ts` no longer scans
  every arg. It first extracts the *positional operands* (skipping `-`/`--` flags and the
  values of value-taking options) and then checks only the operands git reads as a remote:
  the first positional after `clone`/`fetch`/`push`/`pull`/`ls-remote`, and the URL of
  `remote add` / `remote set-url` / `submodule add`. A commit message such as
  `see http://example.com/issue-12` or `git: fix the hook` now runs (exit 0) instead of
  returning `host_blocked`; `file://`, `ssh://`, `http://` and scp remotes are still refused.
  The scan is still conservative on the security side: `submodule add` was added to the list.
- **Tests added** to `git.test.ts`: a real commit whose `-m` contains a URL, a real commit
  whose `-m` starts with a scheme-like prefix (`git: …`), and `push file:///…` refused with
  `host_blocked`. Both commit tests would have failed before the fix.
- **Finding 2 (nit, documentation only)** — the Report's quoted digest had a one-character
  typo (`…02ea1ddbc2…`); corrected to the Dockerfile value (`…02ea1dbbc2…`). The Dockerfile
  is unchanged.
- **Findings 3, 4, 5 (nits)** — left as-is; no code line in this fix touches `serve.ts` or
  `process.ts`.
- Single test: `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot` →
  `Test Files 2 passed (2), Tests 11 passed (11)`.
- `pnpm gate` → `PASS install / format / lint / typecheck / effect / tests @zilar/desk`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Round 3 (PREREVIEW findings, 2026-10-14)

PREREVIEW.md at the worktree root: **0 must-fix, 2 should-fix, 3 nits**. Both should-fix findings
are fixed, each in its own commit; the three nits are untouched (none sits in a line I changed).

**Finding 1 (should-fix) — `git` refused flags / operands used exact matches.**
`packages/desk/src/tools/git.ts` now resolves git's unambiguous long-option prefixes:
- `refusedFlag` refuses `-c…` and any prefix of `--config`, `--config-env`, `--exec`,
  `--exec-path`, `--upload-pack` (so `--config core.hooksPath=…` and `--uploa=` no longer bypass
  the daemon's `-c core.hooksPath=/dev/null`). `--` (the arg separator) is not matched.
- `operands()` uses `takesValue()`, which treats an abbreviated long value-option
  (`--recei x`, `--uploa x`) as consuming the next token, so a hidden remote becomes the checked
  operand again.
- `isForbiddenRemote` also refuses `ext::` remote-helper remotes.
Tests added to `git.test.ts`: long-form `--config` on clone refused (`tool_failed`); abbreviated
`--uploa=` refused (`tool_failed`); `push --recei x file:///…` refused (`host_blocked`); `ext::`
remote refused (`host_blocked`). The last three would have passed the old filter.

**Finding 2 (should-fix) — `read`/`edit` loaded whole files with a stale/no cap.**
New `readCappedFile(absolute, maxBytes)` in `packages/desk/src/capture.ts` reads at most
`maxBytes + 1` bytes with `openSync`/`readSync`/`closeSync` (in a loop, so a short read is handled)
and reports `tooLarge`. `read.ts` and `edit.ts` both use it and refuse with `output_too_large`; a
file grown after the caller's `stat` (read) or `edit`, which had no size check at all, can no longer
load unbounded bytes. The `fs` calls are wrapped in `Effect.try` + `Effect.runSync` like `paths.ts`,
so the Effect ratchet stays green. Tests added in `packages/desk/src/file-tools.test.ts`: a small
read, a read over the cap, and an edit over the cap (all refused with `output_too_large`).

**Nits** (3: `serve.ts` CLI at import; 4: overlapping same-file edits; 5: `timeout_ms` overflow)
left as-is: no fix touches `serve.ts` or `process.ts`.

Commands and real results:

```
pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/git.test.ts src/file-tools.test.ts
  Test Files  2 passed (2)
       Tests  14 passed (14)

pnpm --filter @zilar/desk exec vitest run --reporter=dot
  Test Files  3 passed (3)
       Tests  18 passed (18)

pnpm gate
  gate: 26 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/desk
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
```

Commits: `T-1403: fix finding 1 - abbreviation-aware git flag and remote checks` and
`T-1403: fix finding 2 - bound read and edit file reads` (plus this Report). During the round the
first gate run failed on Prettier formatting in `git.test.ts` and then on the Effect ratchet
flagging `capture.ts`; both were fixed and folded into their finding's commit before the final
green gate.

### Fix round (lead, 2026-10-14)

Replaced the git argument parsing with git's own transport enforcement, per the lead.

- **`packages/desk/src/tools/git.ts`** now runs every command with `GIT_ALLOW_PROTOCOL=https`, so
  git refuses `file`, `ssh`, `ext`, `git` and local paths for clone, fetch, push, submodules and
  remotes whatever the arguments spell. Deleted `remoteOperands`, `operands`,
  `VALUE_SHORT_OPTIONS`, `VALUE_LONG_OPTIONS` and the URL scan (`isForbiddenRemote`). Kept a small
  refusal, matched exactly and with `=value`: `-c` in any form (`-c foo=bar`, `-cfoo=bar`), `-u` as
  its own argument, `--config-env`, `--exec`, `--exec-path`, `--receive-pack`, `--upload-pack`. All
  the env/config hardening is unchanged (`GIT_CONFIG_GLOBAL`/`SYSTEM=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, `core.hooksPath=/dev/null`, `GIT_LFS_SKIP_SMUDGE=1`,
  `GIT_TERMINAL_PROMPT=0`, `protocol.file.allow=never`).
  - **One addition to the list:** I also kept `--config` refused. It is `git clone`'s config option
    (a config injection, like `-c`), and dropping it would reopen the round-2
    `clone --config core.hooksPath=…` hole. Say the word and I will remove it.
  - The comment above `REFUSED_OPTIONS` records that the jail is the security boundary (the `bash`
    tool exists) and this hardening stops a repo from running hooks or reaching local files.
- **`packages/desk/src/git.test.ts`** now covers: the kept hook test and `-c` refusal; `-u /tmp/x`
  refused; a `file://` clone failing with `fatal: transport 'file' not allowed`; `remote add -t main
  origin file:///…` (accepted, exit 0) then `fetch origin` failing with the same transport error; and
  a commit message containing `https://example.com` succeeding. The old argument-parsing tests
  (abbreviated flags, `ext::`, `push file://…`) were removed with the code they tested.
- **`packages/desk/src/serve.ts`** (nit): `main` no longer runs at import time; it runs only when
  `import.meta.url === pathToFileURL(process.argv[1]).href`, so a test or library import cannot start
  reading stdin or set `process.exitCode`.

Commands and real results:

```
pnpm --filter @zilar/desk exec vitest run --reporter=dot
  Test Files  3 passed (3)
       Tests  13 passed (13)

pnpm gate
  gate: 26 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/desk
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
```

Commits: `T-1403: let git enforce the transport (GIT_ALLOW_PROTOCOL=https)`,
`T-1403: cover the git transport enforcement in git.test.ts`,
`T-1403: run serve's CLI only as the entry point`, plus this Report.

**Lead follow-up:** stopped refusing the bare `-u` (`push -u`/`add -u`/`stash push -u`; the transport is already pinned) and clamped `timeoutFor` to `2_147_483_647` ms — tests 13 passed, `GATE PASS`.

**Lockfile:** after the effect 4.0.4 rebase, `pnpm install --no-frozen-lockfile` changed only the `packages/desk` importer entry (4.0.2 → 4.0.4); `pnpm gate --base main` → `GATE PASS`.

## Review (written by Claude)
Lead, 2026-10-14: approved after 2 auto rounds and 2 lead rounds. The git command-line parsing was replaced by GIT_ALLOW_PROTOCOL=https plus a small config/exec option refusal (bare -u allowed again). Final re-review CLEAN, nit 4. Lead checks: base pinned (node:24-bookworm-slim@sha256:d6aa75…), 13 desk tests pass locally, image 861.7 MB arm64 (build-essential dominates; a slim variant is a later follow-up). Nothing deployed: the jail runs in P2 Task D after the gVisor install.
