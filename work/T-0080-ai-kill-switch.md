---
id: T-0080
title: Kill switch (M4) — the owner can stop an AI at once and resume it; a stopped AI is offline and cannot be woken
status: todo
milestone: M4
branch: task/T-0080-ai-kill-switch
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0034, T-0058]
estimate: 1 day
---

# T-0080: Kill switch for an AI

## Spec (written by Claude, do not edit)

### Goal

`docs/PROJECT_PLAN.md` §15.5: "Every AI has a kill switch that stops it immediately and prevents it from being woken." Today an AI can only be edited or deleted. This task adds **stop** and **resume** for the AI's **owner** (room admins and workspace admins are a later step, decision J5):

- **Stop:** the AI goes offline right away, does not answer anything (DMs, rooms, mentions), and no message that was still being generated is sent afterwards. It stays in its rooms as a member; nothing is deleted.
- **Resume:** the AI reconnects and works again.
- A stopped AI **cannot be woken** by anything: not by the periodic reconcile, not by a lifecycle event, not by a restart of the server.

### Design (decided; follow it)

Add a third AI status, **`stopped`**, next to `active` and `disabled`. Do not reuse `disabled`: that value means "still being provisioned" (`createAi` inserts it and flips it to `active` at the end), and a resume must never be able to activate a half-built AI. `listActiveAisForGateway` already returns only `active` rows and `reconcile` already disconnects sessions that are not in that list, so a stopped AI stays off after a restart with no extra code; the gateway only needs an **immediate** path on top of the periodic one.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §15.5 and the J5 row of the decisions table
- `apps/server/src/ais/service.ts` (statuses, `createAi`'s provisioning flow, `getOwnedAi`, `emitAiLifecycle`, `AiLifecycleEvent`, `PublicAi`), `routes.ts`, `service.test.ts`, `routes.test.ts`
- `apps/server/src/agents/gateway.ts` (`connectAi`, `disconnectAi`, `reconcile`, the lifecycle subscription inside `start`, `session.stopped`, how a running turn sends its reply, `runSessionTurn`, `runGroupSessionTurn`, and the group-turn pump) and its tests
- `apps/web/src/lib/api.ts` (`publicAiSchema`, the AI calls and their tests), `apps/web/src/components/ais/AiPanel.tsx` and its test, `apps/web/src/mock/api.ts` (mock AI routes)
- `apps/mobile/src/lib/ais-api.ts` and its test (the type guard for the AI shape)

### Allowed files
- Server: `apps/server/src/ais/service.ts`, `service.test.ts`, `routes.ts`, `routes.test.ts`, `apps/server/src/agents/gateway.ts` and its test file(s) (edit only what the kill switch needs), `apps/server/src/db/schema.ts` **only** to widen the `status` enum type of `ais` (text column: no data migration; if `drizzle-kit generate` produces a migration for it, keep the generated file, otherwise say so in the Report)
- Web: `apps/web/src/lib/api.ts`, `api.test.ts`, `apps/web/src/components/ais/AiPanel.tsx`, `AiPanel.test.tsx`, `apps/web/src/mock/api.ts`, `mock/api.test.ts`
- Mobile: `apps/mobile/src/lib/ais-api.ts`, `ais-api.test.ts` — **only** to accept `stopped` in the status type and guard, so a stopped AI does not break the AI list
- `work/T-0080-ai-kill-switch.md`

**Not allowed:** anything else, `packages/**`, `docs/**`, new dependencies, showing new UI on mobile.

### What to build
1. **Service.** `stopAi(deps, aiId, ownerId)` and `resumeAi(deps, aiId, ownerId)`: owner only (`getOwnedAi`: someone else's or a missing AI is the same 404 as today). `stopAi` accepts only `active` (idempotent: already `stopped` returns the AI unchanged; `disabled` is a 409 `not_active`). `resumeAi` accepts only `stopped` (already `active` returns it unchanged; `disabled` is a 409). Both update `status` and `updated_at` with a conditional update (`WHERE status = <expected>`), and emit lifecycle events `stopped` / `resumed`. Extend `AiLifecycleEvent` accordingly. `PublicAi.status` includes `stopped`.
2. **Routes.** `POST /api/ais/:id/stop` and `POST /api/ais/:id/resume`, `requireSession`, answering the public AI (200). Same 503 behavior as the other AI routes when the service is not configured.
3. **Gateway.**
   - On `stopped`: immediately `disconnectAi(aiId)`. Nothing sent afterwards: audit every send path used by a running turn (DM turn, group turn, budget warnings, persona-tool replies, draft/streaming updates) and make each check that the session is still live (`session.stopped` or "session no longer in `sessions`") **right before sending**. A turn already in the middle of an LLM call may finish computing, but its output must be dropped, not delivered. Also drop any queued, not yet started turns for that session.
   - On `resumed`: load the AI with `loadActiveAi` and `connectAi` it (same pattern as `created`).
   - `reconcile` and `connectAi` must never bring a `stopped` AI online (it is not returned by `listActiveAisForGateway`; add a test proving that `stopped` and `disabled` rows are excluded).
   - Other things that can wake an AI must respect the flag: look for any path that triggers an AI turn from something other than the gateway session (e.g. a group-add hook, draft or persona endpoints) and, if one exists, make it refuse a non-`active` AI. List what you found in the Report even if nothing needed changing.
4. **Web.** `publicAiSchema.status` accepts `stopped`. `api.ts`: `stopAi(id)` and `resumeAi(id)`. In the AI panel: when `active`, a "Stop AI" button (destructive-styled but not a delete; a confirm step in the same style as the delete confirm) that calls `stopAi`; when `stopped`, a clear "Stopped" label near the name and a "Resume" button. While the call is in flight the button is disabled; errors show inline like the other panel actions. The mock layer serves both routes and keeps state.
5. **Mobile.** Only the status type/guard accepts `stopped`.

### Tests (Vitest, PGlite, no network)
- Service: stop and resume by owner, by non-owner (404), idempotent repeats, 409 on `disabled`, the conditional update (a resume racing a delete or stop does not resurrect anything), events emitted.
- Routes: 401, 404, 200 shapes, 503 when not configured.
- Gateway (with the existing fake XMPP/LLM harness): a stop disconnects the AI at once; a reply that was in flight when the stop arrived is **not** sent; queued turns are dropped; a message to a stopped AI gets no answer; resume brings it back and it answers; a server "restart" (fresh gateway, `reconcile`) leaves a stopped AI offline.
- Web: api functions, panel states (active → stop with confirm, stopped → label and resume, in-flight disabled, error), mock routes. Mobile: the guard accepts `stopped`.

### Live check (the lead does it)
Not needed from you; say in the Report what you could not verify without a real XMPP server.

### Acceptance criteria
- [ ] A stopped AI is offline, silent, and stays off across reconcile and restart; a resumed AI works again.
- [ ] No message generated before the stop is delivered after it.
- [ ] Only the owner can stop or resume; `disabled` (provisioning) AIs can never be activated by resume.
- [ ] The web AI list and detail still load with a stopped AI; mobile does not break on it.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server --filter=@galena/web --filter=@galena/mobile
pnpm build
```

### Out of scope
- Room-admin and workspace-admin kill switch (J5), stopping a whole room, the audit entry for a stop (comes with the audit log), push notifications, a mobile button.

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
