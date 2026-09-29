---
id: T-0087
title: Approvals sweeper — expired pending requests are denied in the background
status: todo
milestone: M4
branch: task/T-0087-approvals-sweeper
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073, T-0079]
estimate: 0.25 day
---

# T-0087: Sweep expired approvals

## Spec (written by Claude, do not edit)

### Goal

T-0073 has `expireStale(db, now)`: it turns past-due `pending` approval requests into `denied` (note `expired`), and its comment says "used by the future sweeper". Reads already show a past-due request as `expired`, so nothing is wrong for users, but the rows stay `pending` forever, which inflates the per-AI pending cap (50) and any future "pending" query. Run the sweep on a timer and write one audit entry per swept request.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/approvals/service.ts` (`expireStale`, the pending cap in `createApproval`) and `service.test.ts` (its tests)
- `apps/server/src/audit/service.ts` (`createAuditRecorder`, `AuditEntry`)
- `apps/server/src/index.ts` (startup and the shutdown sequence, including how the runner hub and the gateway are started and stopped; keep the hard-exit behavior), `apps/server/src/machines/hub.ts` (an existing unref'd timer with `close()` as a model)

### Allowed files
- `apps/server/src/approvals/service.ts`, `service.test.ts` (let `expireStale` return the swept rows' ids and AI/group ids instead of only a count, keeping existing tests meaningful)
- `apps/server/src/approvals/sweeper.ts` (new), `sweeper.test.ts` (new)
- `apps/server/src/index.ts` (start and stop the sweeper)
- `work/T-0087-approvals-sweeper.md`

**Not allowed:** anything else, the schema, `packages/**`, web, mobile, new dependencies.

### What to build
1. `expireStale` returns `Array<{ id, aiId, groupId }>` for the rows it changed (from the `RETURNING` it already has); the conditional `WHERE status = 'pending' AND expires_at < now` stays, so a concurrent decision is never overwritten.
2. `startApprovalsSweeper({ db, audit, logger, intervalMs = 60_000, now })` runs `expireStale` on a timer (first run after one interval, not at boot), writes one audit entry per swept request: `approval.expired`, `subjectId` = the approval id, `aiId`, `groupId`, `actorUserId: null`, `argsHash: null`, `result: 'denied'`, `detail: null`. A failing sweep logs `{ err }` (no request data) and the timer keeps running; a sweep never overlaps the previous one. Returns `{ close(): void }`; the timer is `unref`'d and `close` stops it.
3. `index.ts` starts it after the server listens and closes it in the shutdown sequence.

### Tests (Vitest, PGlite, fake timers where useful)
- `expireStale` returns exactly the swept rows and leaves decided and unexpired ones alone; a request decided just before the sweep is not touched.
- The sweeper: one tick sweeps and writes the audit entries (assert them in `audit_log`); a failing sweep does not stop the timer; no overlap; `close` stops it; nothing leaks between tests.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] Expired pending requests become `denied` with note `expired`, once, with one audit entry each.
- [ ] A decision racing the sweep always wins (conditional update).
- [ ] The sweeper cannot take the API down and does not keep the process alive.
- [ ] No `any`, no `@ts-ignore`, no new dependencies; lint passes (re-run it after your last edit).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Retention or deletion of old requests, notifying anyone about an expiry, a configurable interval through env.

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
-

---

## Review (written by Claude)

**Verdict:**
