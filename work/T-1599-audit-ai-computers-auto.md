---
id: T-1599
title: "Audit (no code): map every change needed so AI computers turn on with one host command and no variables (desk services in every stack, agent waits for gVisor, server asks the agent, image follows the release); write docs/deploy/ai-computers-auto-plan.md with file:line and a task split"
status: merged
milestone: M5
branch: task/T-1599-audit-ai-computers-auto
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1599: Audit for "AI computers without variables"

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-15), on turning on Zilar cloud computers: "needs to be easy to do, dont write and made commands and installs, needs to be part of the zilar flow of install and updates".

**Today:** after `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`, a Coolify user must paste 4 variables (`DESKS_ENABLED`, `COMPOSE_PROFILES=desks`, `DESK_IMAGE=<digest>`, `DESK_AGENT_SOCKET`) and redeploy. The pinned `DESK_IMAGE` never moves on updates (`deploy/lib/desk-image.sh:60` only fills an empty value).

**The target the lead chose:**
1. **The desk services are in every stack, with no profile and no variables to set:** `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml` (the template) and `deploy/coolify/docker-compose.app.yml` (live).
2. **The desk agent waits for gVisor.** At start, and every ~30 s, it checks whether Docker lists the `runsc` runtime.
   - **Until then:** it answers a status request on its socket ("host not set up") and refuses jails.
   - **Once `runsc` is there:** it resolves and pins the jail image, then becomes ready, with no restart and no redeploy.
3. **The jail image follows the release:** the agent pulls `zilar-desk:<its own version>` and pins the digest it got for its lifetime. `DESK_IMAGE` stays only as an optional override. Builds from git (live) need a defined fallback tag; find what `images.yml` publishes.
4. **The server asks rather than assumes:**
   - `DESK_AGENT_SOCKET` gets a default path;
   - the AI routes' `cloud` comes from the agent's live status (short cache), not from "socket configured";
   - a missing or not-ready agent means not available.
5. **The UI** tells the server's admins "Set up on your server" plus the one command, instead of "Not available yet". **Text only, in the existing card;** a layout change would need a D24 canvas first.
6. **The install and update flows:**
   - the plain installer already offers host-setup; check that it still fits with no `DESKS_ENABLED`;
   - `--desks-host` stops printing variables and just says computers turn on within a minute;
   - `./zilar update` and `up` lose the `DESK_IMAGE` pin step, or keep it only as an override.

### What to do
Read the code and write **`docs/deploy/ai-computers-auto-plan.md`**. No code changes.

1. **For each of the 6 points above:** the exact files and lines that change (`file:line`, quoting the current line), and what each change is, in one or two sentences.
   - **Start from (the lead read these):**
     - **The agent:** `packages/desk/src/agent/main.ts:38` and `:53`, `packages/desk/src/agent/config.ts:79-89` (`DESK_IMAGE` required and digest-pinned), `packages/desk/src/agent/server.ts:153-165`, `packages/desk/src/agent/docker.ts`, `packages/desk/src/protocol.ts`;
     - **The server:** `apps/server/src/hands/wiring.ts:7-10` (built only when `DESK_AGENT_SOCKET` is set), `apps/server/src/startup/components.ts:174-184` (`ais: { cloud: desk !== null }`), `apps/server/src/ais/api.ts:53-55`, `apps/server/src/app/routes-ai.ts:111`, `apps/server/src/config/server-schema.ts:190`;
     - **The UI:** `apps/web/src/components/ais/AiComputerSection.tsx:39` and the phone's twin (find it);
     - **The compose files:** the desk blocks in the three files (the `profiles: ['desks']` and `DESKS_ENABLED` guard lines);
     - **The scripts:** `deploy/lib/desk-image.sh`, `deploy/lib/host-setup.sh:169-175`, `deploy/zilar:52` and `:90-94`, `deploy/install.sh` (`--desks-host`), `.github/workflows/images.yml` (the tags the jail image gets);
     - **The docs:** `docs/INSTALL.md`, `docs/INSTALL_DOCKER.md` (the Coolify path), `deploy/coolify/LAYOUT.md`.
2. **Risks, each with the evidence you found:**
   - a privileged desk-agent with the Docker socket now runs on every install while idle (what else it can reach while not ready);
   - how Coolify shows a service that runs but is idle;
   - the jail tag for git builds;
   - an older server talking to a newer agent, or the reverse;
   - what happens to an existing install that has `DESKS_ENABLED=true` and a pinned `DESK_IMAGE` (live has `DESKS_ENABLED=false`).
3. **A task split:** 3–5 tasks, each under 400 lines per file, each listing its Allowed files with full paths and what can run in parallel. Mark which tasks touch auth, keys or permissions, since those need tests.
4. **Open questions for Julio,** if any, as plain one-line choices.

### Tests
None.

### Allowed files
- `docs/deploy/ai-computers-auto-plan.md` (new)
- `work/T-1599-audit-ai-computers-auto.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every claim in the plan cites `file:line`** from the code as it is on the branch.
- **The task split covers all 6 points.**

---

## Report (written by the worker when done)

### What I did

Wrote `docs/deploy/ai-computers-auto-plan.md` (new, ~250 lines). No code changed, as the spec says.

- **§0** lists every gate that has to go, each with the `file:line` and the quoted current line
  (the profile `deploy/docker-compose.yml:301`, the guard `:318`, `DESKS_ENABLED` `:322`, the
  server's two wiring gates `apps/server/src/hands/wiring.ts:10` and `:24-28`, the agent's
  `DESK_IMAGE is required` `packages/desk/src/agent/config.ts:80-88`, the write-once pin
  `deploy/lib/desk-image.sh:60`, and the four variables `deploy/install.sh:344-352`).
- **§1** maps each of the 6 points to a table of `file:line` / the current line / the change:
  - point 1: the compose profiles, guards and variables, in **four** files, not three. The spec
    named `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml` and
    `deploy/coolify/docker-compose.app.yml`; `deploy/coolify/zilar-core.yml` is a fourth file
    (`:7`, `:27-28`) that copies the same desk guards and would otherwise drift.
  - point 2: the readiness loop in `main.ts`, a new `runtimeAvailable()` on the Docker layer
    (`docker.ts:12-26`), the `status` fields (`wire.ts:85-89`), and the refusal in
    `lifecycle.ts:78-79`.
  - point 3: `DESK_IMAGE` becomes an optional override; the agent resolves
    `zilar-desk:<DESK_IMAGE_TAG>` and pins it with the same two docker commands
    `deploy/lib/desk-image.sh:46-53` uses. Fallback tag for a git build: **`latest`**, which
    `images.yml:303-305` publishes for every green main; `:271-273` for a version tag.
  - point 4: the socket default (`server-schema.ts:190`), a new `status()` on the cloud client
    plus a short-cache probe, `deps.ts:55-56` / `routes-ai.ts:111` / `api.ts:178-181` /
    `components.ts:184`, and the per-turn gateway resolution (`desk-exec.ts:161-185`).
  - point 5: the two card strings only (`AiComputerSection.tsx:39`,
    `computer-picker.tsx:38`), plus the contract comment `packages/api-contract/src/ais.ts:28-30`.
  - point 6: `deploy/zilar:52-54, 89-109, 514, 551, 475-494, 843-893`, `desk-image.sh:58-78`,
    `install.sh:287-310` and `:318-353`, `preflight.sh:139-145`, and the four docs. The plain
    installer still fits with no `DESKS_ENABLED`: `host-setup` plus the gVisor sandbox check
    (`install.sh:281-285`) is the whole job.
- **§2** has 6 risks with evidence: the always-on privileged agent with the Docker socket
  (`docker-compose.yml:308-309, 336, 339`) and the 0666 socket (`server.ts:170`); Coolify showing
  "healthy" while idle (`:345` health check passes as soon as `listen()` runs); the git-build
  jail tag; version skew both ways (`cloud-hands.ts:124` ignores extra fields, `server.ts:112` is
  strict, so a missing `ready` must read as ready); an install with `DESKS_ENABLED=true` and a
  stale pin; and live getting the privileged agent on its next push.
- **§3** splits the work into 4 code tasks + 1 live check, each with full Allowed-file paths,
  parallelism notes, and the tests it needs. T1 (agent) and T2 (server) touch the sandbox
  confinement and the cloud-availability gate, so both are marked as needing tests; T3 owns
  `deploy/tests/install.test.sh` and `deploy/tests/host-setup.test.sh`, which encode the old
  four-variable flow and will fail until updated.
- **§4** has 5 open questions for Julio.

### Checks run

- `pnpm install` — done, no error (peer-dependency warning only, pre-existing).
- `pnpm gate` (once, from the repo root):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.2s)
PASS  lint  (1.5s)
PASS  typecheck  (1.6s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Single test files: none. This task changes only `docs/deploy/ai-computers-auto-plan.md` and this
  task file, so there is no package to test and no test to run before the gate. `docs/` and
  `work/` are in `.prettierignore`, which is why the format step passes without touching them.

### Notes for the lead

- The plan is an audit: every claim carries a `file:line` taken from this branch (`f46bf847b`).
  Line numbers are as of this branch and will move as T1-T4 land.
- Deviation from the spec, deliberately: point 1 names three compose files, but a fourth
  (`deploy/coolify/zilar-core.yml`) carries the same desk profile/guard block and its own header
  says it copies them from the app file, so the plan includes it to stop the drift.
- The plan does not choose between "status reports the digest" and "make `DeskSpec.imageDigest`
  optional" for point 3; it recommends the first and notes that `runner-hands.ts:86` still sends
  the field, so "optional" is safer than "remove". That is a design detail for the lead.
- Risk 2.1 (privileged agent on every install, idle) is the one item I would not decide alone; it
  is open question 1.

### Round 1 (fix round 1 — PREREVIEW.md: must-fix=0, should-fix=1, nit=2)

- **Finding 1 (should-fix) — fixed.** `deploy/.env.example` is a separate file from the
  `deploy/zilar:475-494` inline template the plan already covered, and it still teaches the old
  four-step flow ("2. set DESKS_ENABLED=true", "`./zilar up` pulls the published jail image and pins
  `DESK_IMAGE` itself") plus the Coolify `COMPOSE_PROFILES=desks` note. Added `deploy/.env.example`
  to §1.6's "Files that change" line, a `deploy/.env.example:189-214` row in the §1.6 table, and to
  T3's Allowed files. Commit `5dadd8eda`.
- **Findings 2 and 3 (nits) — left as-is.** Both sit on lines this round does not change (finding 2:
  the `desk?` doc comment `apps/server/src/agents/gateway/contracts.ts:64-67` and T2's file list;
  finding 3: the missing "`packages/desk/src/protocol.ts` needs no change" sentence). Per the
  fix-round rule, nits outside changed lines are untouched. Disagreements: none.
- **Tests added: none.** The fix is docs only; the spec's Tests section says "None", finding 1 names
  no test, and no code path changed.
- **Gate:** `pnpm gate` once from the repo root, after the fix:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.0s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  Single test files: none to run (docs-only diff).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one automatic round, 2 nits left.
- **What the lead read:** all of `docs/deploy/ai-computers-auto-plan.md` (410 lines, docs only).
  - It maps all 6 points to `file:line`, with the risks and their evidence (§2) and a 5-task split (§3).
  - It found a fourth compose file the spec missed (`deploy/coolify/zilar-core.yml`), the deploy tests that encode the old flow, and the old-agent/new-server compatibility rule (a missing `ready` counts as ready; `DESK_IMAGE` stays an override forever).
- **The lead's answers to §4**, decided 2026-10-15:
  1. **The agent runs idle on every install.** Accepted: Julio was told the trade-off before he asked for the variable-free flow. The closed wire protocol and the server-only socket volume must stay as they are.
  2. **On `./zilar update`,** clear a `DESK_IMAGE` pin that `./zilar` wrote itself (`ghcr.io/<owner>/zilar-desk@sha256:…`); keep any other value as an override and print a one-line warning.
  3. **Git builds fall back to `latest`.**
  4. and 5. **Both cards say "Needs setup on your server"** (one line on the phone). The command lives in the installer messages and the install docs.
- **Line numbers have moved:** T-1598 (startup/components, leader/start) and T-1600 (server-schema, −1 line after `:139`) changed files the plan cites. The implementation specs re-check every line before launch.
- **The split as launched:**
  - **T1 (agent) and T2 (server)** run in parallel, sharing a status shape both specs define;
  - **T3 (compose and scripts)** launches after T1, because it edits the same compose files;
  - **T4 (UI text)** runs in parallel;
  - **T5 (live)** is the lead's job, with Julio's "yes, now". Merge order: T1, T2, T3, then T5.

