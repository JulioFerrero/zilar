---
id: T-0083
title: Audit entries for the AI kill switch — stop and resume are written to the audit log
status: todo
milestone: M4
branch: task/T-0083-audit-ai-stop-resume
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0079, T-0080]
estimate: 0.25 day
---

# T-0083: Audit the kill switch

## Spec (written by Claude, do not edit)

### Goal

The audit log (T-0079) records approval decisions and machine changes. The kill switch (T-0080) is the most important thing an owner can do to an AI and is not logged yet. Write one entry when an AI is stopped and one when it is resumed, exactly like the machines routes do it.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/audit/service.ts` (`createAuditRecorder`, `AuditEntry`) and `apps/server/src/machines/routes.ts` (how a route takes an optional `audit` recorder and writes an entry after the state change) and its tests (how the recorder is observed)
- `apps/server/src/ais/routes.ts` (`POST /ais/:id/stop` and `/resume`), `ais/service.ts` (`stopAi`, `resumeAi`), `apps/server/src/app.ts` (where the recorder is created and passed to the other routes)
- `apps/server/src/ais/routes.test.ts` (the kill-switch tests)

### Allowed files
- `apps/server/src/ais/routes.ts`, `apps/server/src/ais/routes.test.ts`
- `apps/server/src/app.ts` (pass the recorder to the AI routes)
- `work/T-0083-audit-ai-stop-resume.md`

**Not allowed:** `ais/service.ts` (the service stays free of audit code), the audit module itself, web, mobile, `packages/**`, new dependencies.

### What to build
1. `createAisRoutes` takes an optional `audit?: AuditRecorder`.
2. After a successful **stop** that actually changed the state, record `ai.stopped`; after a successful **resume** that changed the state, record `ai.resumed`. Fields: `actorUserId` = the owner, `aiId`, `groupId: null`, `subjectId` = the AI id, `argsHash: null`, no cost, `result: 'ok'`, `detail: null`. An idempotent repeat (the AI was already stopped or already active) writes **nothing**. To know whether the state changed without touching the service, compare the status before and after: read the AI with the existing `getOwnedAi` before calling the service (already owner-checked, so a stranger still gets the same 404) and record only if the status differs from the answer.
3. A 4xx (404, 409) writes nothing. A failing recorder never changes the response (the recorder already swallows errors).
4. No AI name, persona or free text in the entry.

### Tests
- stop writes exactly one `ai.stopped` entry with the right fields; a second stop writes none; resume likewise with `ai.resumed`; 404 and 409 write none; a recorder that throws does not change the 200; the entry is readable by the owner through `GET /api/audit?aiId=…` and not by a stranger.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] One entry per real state change, none for repeats or errors.
- [ ] No free text or names in entries.
- [ ] `ais/service.ts` untouched.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

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
- Room-admin stop, entries for other AI changes (create, edit, delete), the web view.

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
