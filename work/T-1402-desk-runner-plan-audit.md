---
id: T-1402
title: "Audit (no code): plan the AI computer (desk) and the runner: one jail image plus tool daemon for Zilar cloud (gVisor on the VPS) and the user's runner, the hands interface, the egress proxy, workspaces; reuse the existing runner, tunnel and machines code"
status: merged
milestone: M5
branch: task/T-1402-desk-runner-plan-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1402: Desk and runner plan (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs must be full agents that run Linux commands, clone git repos, search code, edit files, use a browser and MCP, without "a Docker per AI" cost. They must also run on a user's own **runner** that is "equal or better than our system" and just as seamless and secure.

The design is `docs/design/agent-system.md`. Read all of it, especially:
- §2.3 (hands);
- §2.4 (the scale path);
- §2.6 (runners);
- §3 (the security model);
- §6 P2 and P3;
- §7 (Julio's decisions: jails on the **current VPS**, open web through the egress proxy, no default budget).

This audit maps the existing code and makes P2 and P3 exact.

### Facts (the lead checked them, 2026-10-14)
- **The VPS** has 8 vCPU, 15 GB RAM (about 7.5 GB free) and a 1 TB disk (877 GB free). It is itself a VM: there is **no `/dev/kvm`**, so gVisor's systrap platform is the jail (no Firecracker). Docker uses runc today. SSH access is read-only for the audit's purposes. **Don't change the VPS**; write the install steps for the lead to run later with Julio's OK.
- **A runner already exists:**
  - `apps/runner` (README: `pair <CODE>`, which makes an ed25519 key pair and registers via `POST /api/runner/pair`; approval is in Settings → Machines; `run` keeps one outbound WebSocket to the server hub; `status`);
  - `packages/runner-tunnel` (`protocol.ts`, `mux.ts`, `server.ts`, `runner.ts`, `auth`, `keys`);
  - the server side is `apps/server/src/machines/` (`pairing.ts`, `hub.ts`, `registry.ts`, `service.ts`, `api.ts`);
  - `RUNNER_HUB_ENABLED` (`apps/server/src/config.ts:234`, off in compose: `deploy/coolify/docker-compose.app.yml:187`).
- **The current tool sandbox** is a Node worker-thread VM for small JavaScript actions (`apps/server/src/sandbox/run-tool.ts:99`, `tool-worker-vm.ts`, `ip-guard.ts` with `classifyIp` at `:175`). The guarded fetch is `apps/server/src/web-tools/guarded-fetch.ts:154`.
- **`packages/agent-drivers` is gone;** the simplify plan deleted it (`docs/audit/simplify-plan.md:166`).
- **The model call stays in the server** (T-1399, Effect AI): jails and runners never hold model keys.

### What to build
One document, `docs/audit/desk-runner-plan.md`, covering:
1. **Inventory of what we can reuse,** with `file:line`:
   - runner pairing and identity;
   - the hub and tunnel (auth, mux, streams, revoke);
   - the machines API and UI on web and mobile;
   - capabilities detection (`apps/runner/src/capabilities.ts`);
   - the IP guard and guarded fetch.

   Say what is solid, what is a spike to rework, and what to delete.
2. **The hands interface:** `provision / execute / stop / snapshot` (design §2.4), with types; one implementation for Zilar cloud and one for a runner, both talking to the **same tool daemon**. Messages, streaming of output, limits and errors.
3. **`packages/desk`:** the jail base image (pinned digest; tools: git, ripgrep, a shell, node, python, build-essential?) and the **tool daemon** inside it:
   - `bash` (with a timeout and output cap), `read`, `write`, `edit` (string replace), `grep` (ripgrep), `glob`, `git` (hooks off: `core.hooksPath=/dev/null`, no LFS filters);
   - how the server's agent loop exposes these as tools (names, schemas), following OpenCode's tool set where sensible.
4. **Zilar cloud (P2) on the VPS:**
   - the exact gVisor (`runsc`, systrap) install and Docker runtime config steps, to be run later with Julio's OK;
   - the per-task jail lifecycle: provision on first use, idle stop after about 2 minutes, workspace folder per AI per project, disk quota, cgroup limits (memory, pids, CPU share), read-only base, dropped capabilities;
   - **concurrency cap and fair queue** (start at 10 running jails);
   - how the server process starts and stops jails (Docker API over the socket? a small privileged sidecar?). Weigh the security of giving the app container the Docker socket, and recommend one.
5. **The egress proxy:**
   - where it runs, per host;
   - open web by default (Julio), private and internal ranges blocked (reuse `classifyIp`), an optional per-AI allowlist;
   - logging the hosts contacted;
   - **injecting short-lived, host-scoped credentials** (git push to the connected GitHub) so the jail never holds a token. Name the GitHub token type to use (GitHub App installation token or fine-grained PAT) and its scoping.
6. **The runner (P3):**
   - how `apps/runner` gains the same desk: Linux gVisor or bubblewrap; macOS Apple `container` or a Docker/OrbStack fallback; Windows via WSL2;
   - the runner-side egress proxy and token injection;
   - local policy that can only tighten;
   - Stop all; signed auto-update;
   - "Computer: Zilar cloud / My Mac / Auto" per AI (the data model and API);
   - offline waiting; moving a workspace between cloud and runner.
7. **The browser** (P4, short): a shared Playwright service in the cloud versus inside the jail on a runner; memory per context.
8. **The task split:** ordered tasks of at most about 600 changed lines; every file at most 400 lines. For each task: its files with `file:line`, what gets deleted, tests (security-relevant only: the IP guard, token injection scoping, the path escape in read/write/edit, runner auth), and **how the lead checks it live**.
9. **Risks and open questions** for Julio: the cost and RAM numbers, anything that needs a production change.

Change no code and nothing on the VPS. Read-only `ssh` (for example `docker info`, `uname -r`) is fine if the lead's SSH key is available to you; otherwise, write which checks the lead must run.

### Read first
`AGENTS.md`, `docs/design/agent-system.md`, `apps/runner/README.md`, the folders above, `docs/PROJECT_PLAN.md` (the desk and runner sections).

### Allowed files
`docs/audit/desk-runner-plan.md`, `work/T-1402-desk-runner-plan-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/desk-runner-plan.md
```

### Acceptance
- `docs/audit/desk-runner-plan.md` exists, cites `file:line` for every claim about our code, and gives the install steps, the task split and the open questions.
- No code changes.

---

## Report (written by the worker when done)

**Status:** review.

**What I did.** Read `AGENTS.md`, `docs/design/agent-system.md`, `docs/PROJECT_PLAN.md` §10–§13 and the
`apps/runner`, `packages/runner-tunnel` and `apps/server/src/machines`, `sandbox`, `web-tools` and
`agents` code, then wrote `docs/audit/desk-runner-plan.md` (documentation only; no code, VPS untouched).
The document:

- inventories what we reuse, with `file:line`: pairing and identity
  (`apps/server/src/machines/pairing.ts:81`, `apps/runner/src/identity.ts:43`), the hub and tunnel
  (`apps/server/src/machines/hub.ts:50`, `packages/runner-tunnel/src/server.ts:443`,
  `packages/runner-tunnel/src/mux.ts:50`), the machines API and its web/mobile UI
  (`packages/api-contract/src/machines.ts:132`, `apps/web/src/routes/MachinesPage.tsx:26`,
  `apps/mobile/src/app/settings/machines.tsx:31`), capabilities (`apps/runner/src/capabilities.ts:123`)
  and the IP guard / guarded fetch (`apps/server/src/sandbox/ip-guard.ts:175`,
  `apps/server/src/web-tools/guarded-fetch.ts:154`); it says what is solid, what is a spike, and what to
  delete (the model listener and `model.open`, and the stale `apps/runner/README.md:44` claim);
- gives the `provision / execute / stop / snapshot` hands interface as types, the four new `desk.*`
  control frames and the JSON-RPC byte stream over the mux, streaming, limits and the error taxonomy;
- specifies `packages/desk`: the pinned base image and the `desk-tool` daemon (`bash, read, write, edit,
  grep, glob, git`) with the git hooks/LFS hardening and the path-escape rule, and how the agent loop
  advertises and dispatches them (`apps/server/src/agents/tools/definitions.ts:229`,
  `apps/server/src/agents/gateway/tool-exec.ts:64`);
- gives the gVisor (`runsc`, systrap) install steps for the lead, the jail lifecycle and run flags, the
  running cap and fair queue, and recommends a privileged `desk-agent` sidecar over a unix socket rather
  than mounting the Docker socket into the app;
- specifies the egress proxy (open web, `classifyIp` reused, host logging, GitHub App installation-token
  injection scoped to one host and one repo) and the runner plan (protocol additions, isolation per OS,
  tighten-only local policy, Stop all, signed auto-update, `Computer: Zilar cloud / My Mac / Auto`,
  offline waiting, moving a workspace);
- gives the short browser (P4) plan, a 9-task ordered split (each ≤ ~600 lines, every file ≤ 400 lines,
  security tests only), risks and open questions, and the read-only VPS checks in Appendix A.

**Files changed.** `docs/audit/desk-runner-plan.md` (new, 752 lines) and this task file (Report +
status). No code, no VPS change, no `ssh`.

**Commands and their real results.**

- `pnpm install --prefer-offline` — succeeded (17.6 s).
- `pnpm exec prettier --check docs/audit/desk-runner-plan.md` — `All matched files use Prettier code style!`
- `pnpm gate` — real output (the final run, after this Report was written; two changed files, both in
  the Allowed set):

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.7s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

No package tests ran: the change is documentation only, so the gate had no changed package to test.

**Deviations and honest notes.**

1. I did not SSH to the VPS (its access is read-only and I treated it as production); the Spec allows
   this, so Appendix A lists the read-only checks for the lead instead.
2. The Spec says "start at 10 running jails". The VPS RAM (~7.5 GB free, 2 GB per jail) puts the safe
   number near 3, so the plan makes the cap a config value and asks Julio for the default (§9.1). This is
   a plan detail, not a Spec violation.

**Open questions for Julio.** All in §9 of the document: the VPS running cap (3 vs 10), the
disk-quota filesystem (`findmnt`), the privileged sidecar install and its Docker-restart window, the
GitHub App, and the P3 macOS/Windows scope. Set `status: blocked` if a decision is needed before the
next task.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit: §4.1 fetches release/latest; the P2 task must pin a dated gVisor release and its sha512). Appendix A run by the lead (read-only): kernel 6.12.57 Debian 13 trixie; 8 vCPU; 15996 MB RAM, 7243 MB available; / is ext4 on /dev/vda4 (872 GB free), so no XFS project quotas (§9.3 stays open); no /dev/kvm; Docker default runtime runc, overlayfs; daemon.json has log opts and address pools only; 38 containers (Coolify, Supabase stack, open-webui, uptime-kuma, Zilar). Julio asked about brig.sh (Apache 2.0 microVM CLI for local coding agents; needs KVM on Linux, Hypervisor.framework on macOS): note it as a candidate macOS/KVM isolation backend for the runner in P3, not for the VPS.
