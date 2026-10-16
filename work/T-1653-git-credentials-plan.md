---
id: T-1653
title: "Plan (docs only): GitHub access for AI computers — the egress proxy injects a short-lived GitHub App installation token only for git/API requests to one allowed repo, the jail never sees it; map today's proxy, registry and server config with file:line and split into small tasks"
status: merged
milestone: M5
branch: task/T-1653-git-credentials-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1653: Plan for git credentials in AI computers

## Spec (written by Claude, do not edit)

### Why
AI computers (gVisor jails) are live since 2026-10-16. They reach the web through the egress proxy in `packages/desk/src/egress/`, one credential per jail.
- **Missing:** a safe way for an AI to clone and push its owner's private repos. The approved plan `docs/audit/desk-runner-plan.md` §8 "Task F — credential injection" describes it:
  - mint a GitHub App installation token (one repo; `contents` and `pull_requests`; one hour);
  - the proxy adds the header only for the configured host and `owner/repo` path;
  - the jail's env and `/proc` never hold the token;
  - an `Authorization` header from the jail is stripped.
- **That plan predates the code.** The proxy now lives in `packages/desk/src/egress/` (no `packages/egress-proxy`), and there's no `apps/server/src/git/`.

**This task maps today's code and writes the implementation plan. Docs only. No code.**

### Facts (the lead read them on 2026-10-16)
- **The egress proxy:** `packages/desk/src/egress/proxy.ts` (320 lines), `registry.ts` (218, one secret per desk), `policy.ts` (102), `ip-guard.ts` and `main.ts`. The agent registers desks through `packages/desk/src/agent/egress.ts`.
- **The server config:** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID` are optional and must be set together (`apps/server/src/config/server-schema.ts:38-42`, `apps/server/src/config/mail.ts:19-28`). The private key is in the logger's redact list (`apps/server/src/logger.ts:27`). Nothing else reads them.
- **The approved plan:** `docs/audit/desk-runner-plan.md` §8 Task F (`:660-670`), and the risks list, item 9 "Token lifetime vs long tasks" (`:733`).
- **The folder `docs/plan/`** holds `delivered-tick.md`, `smart-wake.md` and `plan.json`.

### Steps
1. **Write `docs/plan/git-credentials.md`** with:
   - **§1 Today:** the proxy request path (CONNECT handling, how a request is tied to a desk credential, where headers could be added), the registry, and how the agent reaches the proxy. Cite `file:line`. Say whether CONNECT tunnels (HTTPS) can be inspected at all today. **If they can't, say so plainly:** header injection on HTTPS needs the proxy to terminate TLS for `github.com`, or git must use a credential helper that asks the proxy. Compare the options.
   - **§2 Options** for giving git a token without the jail holding it:
     - (a) a MITM for `github.com` only, with a jail-trusted CA;
     - (b) a git credential helper in the jail that fetches a short-lived token from the proxy per operation (the jail does see a token briefly);
     - (c) a git-over-HTTP smart proxy endpoint on the proxy (`http://desk-egress/git/<owner>/<repo>`) that adds auth and forwards to GitHub.

     For each: security, effort, and what the AI types (`git clone …`). Recommend one.
   - **§3 Token minting:** where the server mints the installation token (a new `apps/server/src/git/` module), the scopes, the lifetime and refresh, and how it reaches the proxy (the agent's registration channel?). Which repo the AI may use, and who sets it (owner setting? per-AI?).
   - **§4 Safety:**
     - the jail never stores a long-lived token;
     - push only to `agent/<ai>/*` branches (branch protection, or a proxy check on push refs);
     - logs never carry tokens;
     - tests for the auth/keys area.
   - **§5 Task split:** small tasks with exact files and estimates in minutes. Keep every file under 400 lines.
   - **§6 Open questions for Julio,** each with a recommendation.
2. **Change no source file.**

### Allowed files
- `docs/plan/git-credentials.md`
- `work/T-1653-git-credentials-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan cites real `file:line` for every claim about today's code.**
- **It recommends one option** and splits the work into small tasks.
- **No source changes.**

---

## Report (written by the worker when done)

### What I did

Docs only — no source file changed. Wrote `docs/plan/git-credentials.md` with the six sections the spec asks for:

- **§1 Today:** the proxy request path (`packages/desk/src/egress/proxy.ts`), the per-desk credential and in-memory registry (`registry.ts`), and how a jail reaches the proxy (`agent/egress.ts`, `agent/docker-args.ts`), each with `file:line`. It states plainly that a `CONNECT` tunnel is a blind byte pipe (`proxy.ts:234-244`) and **cannot be inspected**, so the only injection hook (`BeforeForward`, `proxy.ts:20-26`) is never reached on the git-over-HTTPS path.
- **§2 Options** (a) MITM `github.com` with a jail-trusted CA, (b) a credential helper in the jail, (c) a git-over-HTTP smart endpoint on the proxy; each with security, effort and what the AI types. **Recommends (c)**: no CA and no TLS interception, the token stays only in the proxy, and the proxy can check pushed refs. Rejects (b) because the token would enter the jail, which `docs/design/agent-system.md:77` forbids.
- **§3 Token minting:** new `apps/server/src/git/app-token.ts` (`jose` is already a dependency), `contents` + `pull_requests`, one repo, one hour, with a small expiry-margin cache; the repo is a per-AI owner setting; the token rides the existing per-turn `desk.provision` frame and the registry registration.
- **§4 Safety:** the jail holds only its existing proxy secret; a proxy-side receive-pack ref check for `agent/<ai>/*`; the host log already carries no headers (`log.ts:9-17`); required tests for the auth/keys area.
- **§5 Task split:** six small tasks with exact files and minute estimates; every touched source file stays under 400 lines (the git logic goes in a new `packages/desk/src/egress/git.ts`, since `proxy.ts` is already 320).
- **§6 Open questions for Julio,** each with a recommendation.

Two facts I found that the spec did not mention and that shape the plan:

1. The wire shape for an allowed repo **already exists and is dead**: `DeskEgressPolicy.git` (`packages/desk/src/hands.ts:54-64`), the runner frame (`packages/runner-tunnel/src/desk-frames.ts:64-74`), the server fill (`apps/server/src/hands/runner-hands.ts:99-105`) and the runner fill (`apps/runner/src/desk/handler.ts:179-190`) all carry `{ host, ownerRepo }`, but the turn never sets `egress` (`apps/server/src/agents/gateway/desk-exec.ts:91-105`) and the sidecar ignores it (`packages/desk/src/agent/lifecycle.ts:210`).
2. The sidecar's re-provision re-registers with the **stored** spec, not the incoming one (`lifecycle.ts:129-142`); that must change for a rotated token to land.

### Checks run

- `pnpm install` — done, no errors (only a pre-existing peer-dependency warning in `apps/mobile`).
- `pnpm gate` (from the repo root) — ended with **GATE PASS**. Summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.1s)
PASS  lint  (1.4s)
PASS  typecheck  (1.2s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No package tests ran (and none were run by hand): the only changed files are Markdown, so no source package was touched. The changed files are `docs/plan/git-credentials.md` and `work/T-1653-git-credentials-plan.md` — both in the Allowed files.

### Notes for the lead

- Nothing implemented, per the spec; the plan is the whole deliverable.
- The recommendation in §2 (option c) **diverges from the wording** of the approved plan (`docs/audit/desk-runner-plan.md:489-492`, design `:222`), which assumed host+path header injection over HTTPS. That needs TLS interception, which today's proxy cannot do (CONNECT is blind). §2 explains why (c) is safer and cheaper and keeps (a) as a later transparent upgrade; §6 asks Julio to confirm.
- Open items needing a decision are in §6: the per-AI repo setting, option (c), the single global installation id, the push-ref gate, public clones with no repo set, and whether relying on per-turn re-mint (a 30-minute turn fits a one-hour token, `desk-exec.ts:29`) is enough for v1.
- No new dependency is proposed by the plan: `jose` (`apps/server/package.json:32`) is already there for the App JWT.

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean, 2 nits.
- **The plan's findings:** `docs/plan/git-credentials.md` maps today's proxy and finds that CONNECT tunnels can't be inspected. It recommends **(c)**: a git smart-HTTP endpoint on the proxy that injects a short-lived App token for one configured repo per AI and refuses pushes outside `agent/<ai>/*`. There's no CA, and the token never enters the jail. Six tasks.
- **Both nits become requirements for the implementation tasks:**
  1. `GIT_ALLOW_PROTOCOL` is process-wide, so allowing `http` must not open plain-http git to any other host. Scope it with a per-URL `insteadOf` plus a `protocol.<name>.allow` / `http.<url>.*` config, or keep `http` only for the proxy host.
  2. The `/git/` endpoint must look up the token **by the requesting desk's own proxy credential**, never by the path alone.
- **Implementation waits for Julio's answers to §6 Q1-Q6.** This is the auth/keys area, and the GitHub App must exist in Coolify. Listed in `work/NOW.md`.
