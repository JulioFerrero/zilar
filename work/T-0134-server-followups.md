---
id: T-0134
title: Server follow-ups from the invite-links, pins and roles reviews
status: planned
milestone: M5
branch: task/T-0134-server-followups
model: meta/muse-spark-1.3-contributor
depends_on: [T-0114, T-0115, T-0116]
estimate: 1 day
---

# T-0134: Server follow-ups

## Spec (written by Claude, do not edit)

### Why
Server items the reviews recorded and did not block on, plus one item that only became possible after T-0116. Read `AGENTS.md` (test policy and security checklist) first. No schema change; if you think one is needed, stop and say so in the Report.

### Fixes
1. **Same user, two racing joins burn two uses** (`invite-links/service.ts` `joinByInviteLink`): the already-member check and the claim race, and the loser's insert is a no-op after the claim. Make the second request consume nothing: claim and insert in one transaction, or refund when the insert did nothing (`onConflictDoNothing` returned no row). Test with two concurrent joins by the same user: `uses` ends at 1.
2. **Per-IP join limiter behind a proxy** (`invite-links/routes.ts` `socketAddress`): behind Caddy every user shares the proxy IP, so the 60/hour budget is global. Add an optional config `TRUSTED_PROXY_HOPS` (integer 0 to 5, default 0, validated with zod, documented in `docs/SERVER_CONFIG.md`, added to `deploy/.env.example` as a comment). With N > 0 the client IP is the Nth address from the RIGHT of `x-forwarded-for` (an attacker controls the left side); with 0 headers are ignored as today. Use it only for the join limiter for now. Tests for 0, 1 and 2 hops and for a forged left-most entry.
3. **Pin "not found" messages** (`pins/service.ts` `unpinMessage`): answer the same message and body as an invisible chat ("Chat not found") so pin ids cannot be told apart. Update the test.
4. **Search with roles** (`search/**` `allowedArchives`): after T-0116 a role holder can see a private topic room through a role; the allowed archive set must include those rooms and exclude a user's rooms after they lose the role or leave the group. Tests with a role holder, a non-holder and a leaver.
5. **`GET /api/join/:token` preview** is not rate limited: add a generous per-user limit (120 per hour) so tokens cannot be probed at full speed. Test.
6. **ApprovalCard N+1**: the approvals list payload should carry each approval's topic approver names (ids resolved server-side, only for topics the caller can see) so the web card does not call `getTopic` per card. Add the field to the list response and its zod schema; the web change is out of scope (note it in the Report for a follow-up).

### Read first
`AGENTS.md`, the Reviews in `work/T-0115-invite-links.md`, `work/T-0114-pinned-messages.md`, `work/T-0116-group-roles.md`, `work/T-0117-message-search.md`; `apps/server/src/{invite-links,pins,roles,search,approvals}/`.

### Allowed files
`apps/server/src/{invite-links,pins,search,approvals,roles,config.ts,config.test.ts,app.ts}`, `authz-sweep.test.ts`, `docs/SERVER_CONFIG.md`, `deploy/.env.example` (comment only), `work/T-0134-server-followups.md`. Not allowed: schema, web, mobile, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm build
```
(Affected tests while working; the full server suite once at the end.)

### Acceptance criteria
- [ ] Each of fixes 1 to 6 has a test that fails without it.
- [ ] Server suite exits 0.

### Out of scope
Schema changes, UI, new features.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
