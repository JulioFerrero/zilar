---
id: T-1985
title: "Claude security audit 2/4: permissions — who can read, write, manage and spend in groups, topics, roles, pins, approvals, AI actions and AI budgets — findings go to a PRIVATE file"
status: merged
milestone: M5
branch: task/T-1985-claude-audit-permissions
model: anthropic/claude-opus-5-5
effort: high
estimate: 45 min
---

# T-1985: Claude security audit 2 (permissions and spend)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "find with Claude, fix with DeepSeek", using the Claude API credits. This is area 2 of 4. Audit 1 (T-1968) cost about $3 and found real issues. This task only **finds**; every confirmed finding becomes its own fix task.

### The one hard rule: findings stay private
**The repo is public.**
- **Nothing about a finding goes in the repo:** no finding, file:line, attack description or hint, in this task file, a doc, a commit message or a code comment.
- **Write every finding to `/Users/julio/.zilar-lead/audits/T-1985-permissions.md`.** That folder already exists outside the repo.
- **This task file's Report** gets only the counts per severity and that path.
- **Read only.** Change no source file. The only repo file you change is this task file's Report.

### Scope (paths under `apps/server/src/`)
| Area | Files |
|---|---|
| Groups | `groups/access.ts`, `groups/members.ts`, `groups/member-roles.ts`, `groups/ownership.ts`, `groups/bans.ts`, `groups/join.ts`, `groups/visibility.ts`, `groups/delete-group.ts`, `groups/ais.ts`, `groups/api.ts`, `groups/service.ts` |
| Topics | `topics/access.ts`, `topics/ai-access.ts`, `topics/members.ts`, `topics/roles.ts`, `topics/patch.ts`, `topics/public-compat.ts`, `topics/preview.ts`, `topics/api.ts`, `topics/service.ts` |
| Roles | `roles/access.ts`, `roles/api.ts`, `roles/service.ts`, `roles/sync.ts` |
| Pins | `pins/access.ts`, `pins/api.ts`, `pins/service.ts` |
| Approvals | `approvals/access.ts`, `approvals/api.ts`, `approvals/api-reads.ts`, `approvals/rules.ts`, `approvals/service.ts`, `approvals/verify.ts` |
| AI actions | `actions/policy.ts`, `actions/approval-path.ts`, `actions/decisions.ts`, `actions/gateway.ts`, `actions/registry.ts` |
| AIs and spend | `ais/api.ts`, `ais/service.ts`, `ais/usage.ts`, `ais/usage-store.ts`, `ais/stop-turn.ts`, `agents/gateway/budget.ts`, `agents/gateway/group-turn-access.ts`, `agents/gateway/request-action.ts`, `agents/gateway/ask-people.ts`, `agents/gateway/question-answer.ts` |
| Contacts and blocks | `contacts/service.ts`, `blocks/service.ts`, `contact-requests/` |

Follow a call into any other file whenever you need it to confirm or rule out a path. The old review `docs/audit/security-audit.md` (SEC-1..15) and the private audit 1 cover other areas; don't repeat them.

### What to look for (each needs a concrete path through the code)
- **Broken access:**
  - a member, a non-member, a banned or blocked user, or a removed AI reading or writing what they shouldn't: topics they aren't in, private topics, another group's data, approvals of another user's AI;
  - an IDOR, where an id from the request isn't checked against the caller;
  - a manager-only action a plain member can do;
  - an owner action an admin can do, where the code means owner-only.
- **Role and ownership edges:** removing the last owner, transferring ownership, a role change racing a membership change, a ban not removing access everywhere (rooms, topics, AI access, invite links).
- **Approvals:**
  - approving your own request when it shouldn't be allowed;
  - approving a request for an AI you don't own;
  - replaying or reusing an approval;
  - a rule ("always allow") wider than the user chose;
  - the time-of-check / time-of-use gap between approval and execution.
- **Spend:**
  - a budget or limit check that can be skipped, raced or double-spent;
  - usage not counted on some path (failures, retries, delegation, routines);
  - one user making another user's AI spend money.
- **AI access:** an AI acting in a room or topic it isn't in, or with tools its owner didn't allow. A question card answered by someone not allowed to answer.

### How to report (in the private file)
The same format as audit 1:
- **Header:** date, commit, files read.
- **A summary table**, then for each finding:
  - **ID:** `A2-01`, `A2-02` and so on;
  - **Severity:** critical, high, medium or low;
  - **Where:** `file:line`;
  - **The attack:** plain steps, no exploit code;
  - **Why the code allows it:** quoted lines;
  - **The fix:** one or two sentences;
  - **Confidence:** confirmed or plausible.
- **A "Ruled out" list.**
- **At most 15 findings.** No style issues, no generic hardening.

### Allowed files
- `work/T-1985-claude-audit-permissions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The private file exists in the format above.
- The Report holds only counts and the path.
- No other repo file changed.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Read-only audit of the files in scope (and the code they call), at commit `87e38cf14`.
- Findings are in the private file `/Users/julio/.zilar-lead/audits/T-1985-permissions.md` (outside the repo), in the audit 1 format: header, summary table, one section per finding, a "Ruled out" list.
- Counts: critical 0, high 1, medium 6, low 4 (11 findings).
- No source file changed. The only repo file changed is this task file (status and Report).

### Checks run
- `pnpm install`: done.
- No single tests run (no code changed).
- `pnpm gate` (exit 0):
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.0s)
  PASS  lint  (1.5s)
  PASS  typecheck  (1.5s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Two of the medium findings depend on what the product intends; the private file says which ones.

## Review (written by Claude)

Approved and merged (task file only).
- **Findings:** the lead read all 11 findings in the private file. Each one has its `file:line`, the path through the code, a fix and a confidence level. They become separate fix tasks.
- **Cost:** about $6.96 on `anthropic/claude-opus-5-5`, in one session with no helpers.
