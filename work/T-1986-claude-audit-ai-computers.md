---
id: T-1986
title: "Claude security audit 3/4: AI computers and tools — the desk jail, egress proxy, machines/runners pairing, web tools, file and media handling — findings go to a PRIVATE file"
status: merged
milestone: M5
branch: task/T-1986-claude-audit-ai-computers
model: anthropic/claude-opus-5-5
effort: high
estimate: 45 min
---

# T-1986: Claude security audit 3 (AI computers and tools)

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-18 to "find with Claude, fix with DeepSeek", using the Claude API credits. This is area 3 of 4. AIs run code in desk jails and reach the open web through a proxy, which makes this the riskiest surface. This task only **finds**.

### The one hard rule: findings stay private
**The repo is public.**
- **Where findings go.** Write every finding to `/Users/julio/.zilar-lead/audits/T-1986-ai-computers.md` (the folder exists, outside the repo).
- **What must never reach the repo.** Put no finding, `file:line`, attack description or hint in this task file, a doc, a commit message or a code comment.
- **What the Report holds.** In this task file's Report, write only the counts per severity and that path.
- **Read only.** Change no source file.

### Scope
| Area | Paths |
|---|---|
| Desk jail and egress | `packages/desk/src/` (agent, egress, `ip-guard.ts`) |
| Server side of desks | `apps/server/src/sandbox/`, `apps/server/src/agents/gateway/desk-exec.ts`, `apps/server/src/agents/gateway/tool-exec.ts` |
| Machines and runners | `apps/server/src/machines/`, `apps/server/src/hands/`, `apps/runner/src/` |
| Web tools | `apps/server/src/web-tools/` |
| Tools | `apps/server/src/tools/` |
| Files and media | `apps/server/src/files/`, `apps/server/src/media/`, `apps/server/src/agents/gateway/fetch-media.ts`, `apps/server/src/agents/gateway/save-text-media.ts` |
| Deploy wiring | the desk services in `deploy/coolify/docker-compose.app.yml` and `deploy/docker-compose.yml` (networks, caps, mounts, users) |

Follow calls into other files whenever you need to. Don't repeat `docs/audit/security-audit.md` (SEC-1..15) or the private audits 1 and 2.

### What to look for (each needs a concrete path)
- **Jail escape or crossing:**
  - code run for one user's AI reaching another user's files, desk, tokens or the server network;
  - the Docker socket or host mounts reachable;
  - missing gVisor, caps, seccomp or a read-only setting where the code assumes them.
- **Egress:**
  - the proxy letting a desk or web tool reach private, metadata or internal addresses through DNS rebinding, redirects, IPv6 forms, `CONNECT` to IP literals, or alternate ports;
  - approved-host lists that can be bypassed (suffix matching, userinfo, encoded hosts).
- **Machines and runners:**
  - pairing codes guessable or reusable;
  - a revoked machine still accepted;
  - a runner able to act for another user;
  - commands or results not bound to the right AI and user.
- **Tools:**
  - a tool reachable without its approval or host rule;
  - arguments the model controls flowing into shell commands, paths (traversal) or URLs unchecked.
- **Files and media:**
  - path traversal;
  - a download URL that serves another user's file;
  - missing size or type caps;
  - SVG or HTML served inline from the app origin.

### How to report (in the private file)
- **Format.** Use the same format as audit 1:
  - a header (date, commit, files read) and a summary table;
  - then, for each finding: an ID (`A3-01` …), severity, where (`file:line`), the attack (plain steps, no exploit code), why the code allows it (quoted lines), the fix, and confidence (confirmed or plausible);
  - then a "Ruled out" list.
- **Limits.** Report at most 15 findings. No style or generic hardening.

### Allowed files
- `work/T-1986-claude-audit-ai-computers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The private file exists, in the format above.
- The Report holds only counts and the path.
- No other repo file changed.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Did the read-only audit of area 3 (AI computers and tools) and wrote the findings to the private file `/Users/julio/.zilar-lead/audits/T-1986-ai-computers.md`, in the audit 1 format.
- Findings per severity:
  - high: 1
  - medium: 4
  - low: 8
  - total: 13
- I changed no source file. The only repo file changed is this task file.

### Checks run
- `pnpm gate` (run once, after the private file was written, before this Report was filled in):
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- I ran no tests; this task changes no code.

### Notes for the lead
- All details are in the private file above.

## Review (written by Claude)

Approved and merged (task file only).
- **Findings.** The lead read all 13 findings in the private file. Each has `file:line`, a concrete path, a fix and a confidence level. They become separate fix tasks.
- **Cost.** About $8.90 on `anthropic/claude-opus-5-5`: $2.75 for the main session plus three helper sessions.
