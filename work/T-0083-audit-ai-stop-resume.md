---
id: T-0083
title: Audit entries for the AI kill switch — stop and resume are written to the audit log
status: merged
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

- Added an optional `audit?: AuditRecorder` to `AisRoutesDependencies` and passed it through to both `POST /ais/:id/stop` and `POST /ais/:id/resume`.
- For each, the route reads the AI with `getOwnedAi` (owner-checked, same 404 as the service) before calling the service, and records one audit entry **only when the status actually changed** (an idempotent repeat writes nothing).
- On a real status flip, the entry is `ai.stopped` or `ai.resumed` with `actorUserId`, `aiId`, `subjectId` set to the owner and the AI id, `groupId: null`, no args hash, no cost, `result: 'ok'`, `detail: null`. No AI name, persona or free text.
- A `try { … } catch { /* swallow */ }` wraps `audit.record` as a defensive backstop: the standard `createAuditRecorder` already swallows, but a custom recorder that throws must not turn a 200 into a 500 here.
- Wired the recorder in `app.ts`: passed `audit: auditRecorder` to `createAisRoutes`, alongside the existing wiring to the machines and approvals routes.
- Added a new `describe('AI stop / resume audit entries')` block with 6 tests covering: real stop + real resume write exactly the right entries; repeats write nothing; 404 (foreign + missing) write nothing; 409 (disabled AI) writes nothing; a throwing recorder does not change the 200 and writes no row; the owner reads the entries via `GET /api/audit?aiId=…` and a stranger does not.

### Files changed

- `apps/server/src/ais/routes.ts` — added `audit` to the dependencies interface, imported `AuditRecorder`, pre-read the AI before stop/resume, and wrote `ai.stopped` / `ai.resumed` on real status changes (guarded by `try/catch`).
- `apps/server/src/app.ts` — passed `audit: auditRecorder` to `createAisRoutes`.
- `apps/server/src/ais/routes.test.ts` — added an `audit` option to `mount()` for the kill-switch suite, added imports for `createAuditRecorder`, `AuditRecorder`, and `auditLog`, and added the new `describe('AI stop / resume audit entries')` block (6 tests).
- `work/T-0083-audit-ai-stop-resume.md` — front-matter `status: review` and this Report.

### Commands run and real results

- `pnpm install` → `Done in 7.3s using pnpm v10.321` (lockfile up to date, +1010 packages).
- `pnpm format:check` → `All matched files use Prettier code style!` (after `pnpm exec prettier --write apps/server/src/ais/routes.test.ts` once; the rest was already clean).
- `pnpm lint` → exit 0.
- `pnpm typecheck` → all 10 packages successful, exit 0.
- `pnpm exec turbo test --force --filter=@galena/server` → **46 test files passed, 5 skipped (51); 677 tests passed, 7 skipped (684)** in 2m 39s. New audit entries describe block: 6/6 green.
  - `writes exactly one ai.stopped entry on a real stop and one ai.resumed on a real resume, with no free text` ✓
  - `a second stop writes nothing; a second resume writes nothing` ✓
  - `a 404 on a missing or foreign id writes nothing` ✓
  - `a 409 (resume on active, stop on disabled) writes nothing` ✓
  - `a recorder that throws does not change the 200 and writes no audit row` ✓
  - `is readable by the owner through GET /api/audit?aiId=… and not by a stranger` ✓
- `pnpm build` → 2 tasks successful, exit 0.

### Problems, deviations from the spec, open questions

- **Defensive `try/catch` around `audit.record`:** the spec said "the recorder already swallows errors", which is true for `createAuditRecorder`. But the same spec also said the test must prove "a recorder that throws does not change the 200". The route now wraps the call in `try { … } catch { /* swallow */ }` to satisfy that test. This is the only place in the audit-writing routes that does this; the approvals and machines routes rely on the recorder's own swallow. If the lead prefers one consistent pattern (e.g. wrap everywhere or wrap nowhere), I can follow up — but the spec as written requires the wrap here.
- **Pre-read of the AI in the route:** the spec explicitly says to do this in the route rather than touch `ais/service.ts`. It is owner-checked, so a stranger still gets the same 404. There is an inherent race between the `getOwnedAi` and the service call (a concurrent stop/resume could change status in between), but the spec says this is the intended approach.
- **No live proof done** (per "Live check (the lead does it)" in the spec).

### Blocked / needs a decision

- Nothing blocked.

---

## Review (written by Claude)

**Verdict:** approved and merged (lead, 2026-09-29). Rebased on main; format, lint, typecheck, test (server 677 passed, 7 skipped) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand.

**Checked:** `ais/service.ts` is untouched; the route reads the AI first with `getOwnedAi` (owner-checked, so a stranger still gets the same 404) and writes `ai.stopped` / `ai.resumed` only when the status differs after the call, so idempotent repeats and 4xx answers write nothing; entries carry ids only (no name, persona or free text); a recorder that throws does not change the 200 (the worker wrapped the call; it is redundant with `createAuditRecorder` but harmless and required by the spec's test). The pre-read and the service call are not atomic: two simultaneous stops can, in theory, both log. Accepted for an audit trail that is meant to be complete rather than exact.
