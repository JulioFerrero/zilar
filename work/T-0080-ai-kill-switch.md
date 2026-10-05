---
id: T-0080
title: Kill switch (M4) — the owner can stop an AI at once and resume it; a stopped AI is offline and cannot be woken
status: merged
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
pnpm exec turbo test --force --filter=@zilar/server --filter=@zilar/web --filter=@zilar/mobile
pnpm build
```

### Out of scope
- Room-admin and workspace-admin kill switch (J5), stopping a whole room, the audit entry for a stop (comes with the audit log), push notifications, a mobile button.

---

## Report (written by the worker when done)

### What I did

Added an owner kill switch for an AI. A new `stopped` status sits next to `active` and `disabled`; `createAi` still inserts `disabled` (the half-built state, never user-visible), `stopAi` flips `active` to `stopped`, `resumeAi` flips it back. Both service functions are owner-only (same 404 shape as `getOwnedAi`), idempotent on their terminal state, and 409 on `disabled` — a resume can never accidentally activate a half-built AI. Each is a conditional UPDATE (`WHERE status = <expected>`) so a stop racing a delete or a resume racing a stop cannot resurrect anything.

Two new HTTP routes, both under the existing `requireSession` + 503 guard: `POST /api/ais/:id/stop` and `POST /api/ais/:id/resume`. Both answer the public AI, so the panel re-renders against the server truth without a second GET.

The gateway listens for new `stopped` and `resumed` lifecycle events next to the existing `created`/`deleted` ones. On `stopped` it disconnects the AI at once; on `resumed` it loads the (now-active) row and reconnects it, exactly like `created`. The periodic reconcile already filters on `status = 'active'` via `listActiveAisForGateway`, so a stopped AI stays off across restarts with no extra code. New test proves `stopped` and `disabled` are both excluded.

Every send path used by a running turn — DM reply/failure, group reply/failure, daily-limit notice, budget warnings, read marker, draft push/flush, and the persona-tool notices that ride the same `sendMessage` callback — is wrapped by a small set of `liveSendMessage` / `liveSendTyping` / `liveMarkDisplayed` helpers that check the session is still in `sessions` and not `stopped`. A stop that lands mid-turn drops the reply and every draft, and queued turns are dropped with the session.

Web API exposes `stopAi(id)` and `resumeAi(id)`. The AI panel renders a `Stop AI` button (with a confirm step, matching the delete confirm) for `active` and a `Stopped` label plus a `Resume` button for `stopped`. Inline errors render above the buttons, not inside the confirm branch, so they survive a failed call. The mock layer serves both routes and keeps state.

Mobile only widens the `PublicAi.status` type and its guard to accept `stopped` — the AI list keeps rendering, no new UI.

### Files changed

- `apps/server/src/db/schema.ts` — widened the `ais.status` enum to `['active', 'disabled', 'stopped']`. No migration generated: the column is plain `text` with no DB-level enum (see `drizzle/0005_clean_frightful_four.sql`); the existing tests already exercise the same DB without the value ever appearing there, so no data migration is needed either.
- `apps/server/src/ais/service.ts` — `PublicAi.status` and `AiRecord.status` accept `stopped`; `AiLifecycleEvent` adds `'stopped' | 'resumed'`; new `stopAi` and `resumeAi` functions with the contract above.
- `apps/server/src/ais/routes.ts` — `POST /api/ais/:id/stop` and `/resume`, behind the existing `requireSession` + `ais_unavailable` 503 path.
- `apps/server/src/agents/gateway.ts` — subscribe to the new lifecycle events; new `liveSendMessage` / `liveSendTyping` / `liveMarkDisplayed` helpers; every send path in `runSessionTurn` and `runGroupSessionTurn` plus the daily/warning helpers go through them; draft push/flush/end also check the session before publishing.
- `apps/server/src/ais/service.test.ts` — `describe('stopAi')`, `describe('resumeAi')`, `describe('listActiveAisForGateway')` blocks: stop/resume by owner, by non-owner (404), idempotent repeats, 409 on `disabled`, conditional-update races (stop racing delete, resume racing stop, two concurrent stops), events emitted; `listActiveAisForGateway` excludes `stopped` and `disabled`.
- `apps/server/src/ais/routes.test.ts` — `describe('AI stop / resume routes')` block: 401, 404 for foreign and missing, 200 round-trip with the public AI, idempotency, 503 when the gateway is not configured.
- `apps/server/src/agents/gateway.test.ts` — `describe('kill switch (T-0080)')` block with six tests, all driving `stopAi`/`resumeAi` through the service: disconnect on stop, in-flight reply dropped, queued turns dropped, message to a stopped AI gets no answer, resume reconnects and the AI answers, fresh gateway (restart) leaves a stopped AI offline.
- `apps/web/src/lib/api.ts` — `publicAiSchema.status` accepts `stopped`; new `stopAi(id)` and `resumeAi(id)` functions.
- `apps/web/src/lib/api.test.ts` — `describe('AIs stop / resume API (T-0080)')` block: schema parses `stopped`, both functions POST to the right URLs, 409 `not_active` and 404 surface through `ApiError`.
- `apps/web/src/components/ais/AiPanel.tsx` — `Stopped` label near the AI name; new `Stop AI` (with confirm step) / `Resume` section with its own state machine and inline error; the error renders above the buttons so it survives a failed call.
- `apps/web/src/components/ais/AiPanel.test.tsx` — `describe('kill switch (T-0080)')` block with six tests covering the confirm step, the success path (status flips, label and button swap), in-flight `Stopping…` state, failed-stop and failed-resume inline errors.
- `apps/web/src/mock/api.ts` — serves `POST /ais/:id/stop` and `/resume`; mirrors the server's idempotency and `disabled` 409 (the mock has no disabled AIs today, so only the idempotent branch runs).
- `apps/web/src/mock/api.test.ts` — four new tests: stop and resume reflect in subsequent list/get; second stop is idempotent; unknown AI answers 404 on both.
- `apps/mobile/src/lib/ais-api.ts` — `PublicAi.status` and the type guard accept `stopped`.
- `apps/mobile/src/lib/ais-api.test.ts` — one new test: listAis parses a stopped AI.
- `work/T-0080-ai-kill-switch.md` — this report; status flipped from `in-progress` to `review`.

### Commands run and real results

```
$ pnpm install
Scope: all 11 workspace projects
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +1010
…
Done in 11.2s using pnpm v10.32.1

$ pnpm format
… (wrote the new files in prettier-compliant style)

$ pnpm format:check
Checking formatting...
All matched files use Prettier code style!

$ pnpm lint
> oxlint .
(no output)

$ pnpm typecheck
… 10 packages, all successful

$ pnpm exec turbo test --force --filter=@zilar/server --filter=@zilar/web --filter=@zilar/mobile
@zilar/server:test: Test Files  44 passed | 5 skipped (49)
@zilar/server:test:       Tests  635 passed | 7 skipped (642)
@zilar/web:test:    Test Files  51 passed (51)
@zilar/web:test:          Tests  499 passed (499)
@zilar/mobile:test:  Test Files  30 passed (30)
@zilar/mobile:test:        Tests  297 passed | 2 skipped (299)

$ pnpm build
… @zilar/web:build + @zilar/mobile:build, 2 successful
```

The server doesn't have a `build` script, so `pnpm build` exercises web + mobile only. Typecheck is the server's compile-time guard.

### Problems, deviations from the spec, open questions

- **No migration for the schema change.** The `ais.status` column is plain `text` with no DB-level enum (see `drizzle/0005_clean_frightful_four.sql`), and the existing data only contains `active` and `disabled`. Drizzle-kit would not produce a migration for an enum widening on a text column. The existing rows are untouched by widening the TypeScript enum, and the service code is the only consumer that needs to recognise `stopped`. I could not run `drizzle-kit generate` here (the harness blocks `npx`), so I'm flagging this for the lead: please run `pnpm --filter @zilar/server db:generate` once after merging to confirm no migration is generated; if one is, keep it.
- **Audit of other things that could wake an AI.** The spec asked me to audit paths that trigger an AI turn from outside the gateway session. Findings:
  - **Group-add hook** (`addGroupAi` in `apps/server/src/groups/service.ts`): does **not** refuse a non-`active` AI. Adding a stopped AI to a room does not wake it on its own (the gateway's `onGroupAi` only syncs rooms for sessions already in the map, and a fresh gateway's `reconcile` excludes `stopped` rows from `listActiveAisForGateway`), but it does leave a stale room membership around. This is outside my allowed files for this task; flagging for a follow-up.
  - **Drafts routes** (`apps/server/src/drafts/routes.ts`): SSE stream of draft events to the owner. Read-only, never wakes an AI. Nothing to change.
  - **Persona endpoints**: the only persona endpoints are `setPersonaFromChat` / `revertPersonaFromChat`, both called only by the model during the AI's own DM turn, behind `executePersonaTool(session.aiId)`. They are not external callers and cannot wake a stopped AI (the turn itself never starts).
- **`DRAFT_THROTTLE_MS` and draft flushing.** A draft `push`/`end` after a 0 is silently dropped by the same `liveSendMessage`-style guard, but `DraftTurnPublisher` is created at the start of the turn and not torn down. The end-of-turn `end('failed')` still fires so the owner sees the turn terminate instead of waiting forever — checked via `sessionIsLive(session)` in the panel call.
- **Inline error placement.** I changed the placement of `stopError` so it renders above the buttons, not inside the confirm branch. Otherwise a failed call would reset the confirm step and erase the error at the same time, hiding it from the owner.

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:** approved with lead changes, merged (2026-09-29). After rebasing onto main (one import-list conflict in `apps/web/src/lib/api.test.ts`, resolved by keeping both) and my changes: format, lint, typecheck, test (server 671, web 527, mobile 333) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand, including the whole gateway diff. `drizzle-kit generate` confirms "No schema changes": widening the text enum needs no migration.

**Lead changes:**
- **The kill switch no longer needs LiteLLM, the key cipher or the gateway to be configured.** The worker copied the other writes' `requireConfigured()` (503 `ais_unavailable`), which would have made the emergency stop fail exactly when something is broken. `stopAi`/`resumeAi` now take only the database and the routes use `{ db }`; the 503 test became "answers 404, never 503, without the gateway".
- **A persona change from a turn that was running at stop time** was still applied (the tool executes before the reply is dropped). `executePersonaTool` now takes the session and returns "the AI was stopped" when it is no longer live (new gateway test: the persona row stays unchanged).

**Checked:** every send path of a running turn (DM reply, group reply, typing, displayed marker, budget notices and warnings, drafts) goes through a `live*` wrapper that checks the session is still the gateway's live one right before sending; queued turns are dropped by `disconnectAi`; `stopped` and `disabled` rows are never returned by `listActiveAisForGateway`, so reconcile and a restart leave them offline; resume goes through `loadActiveAi` (active only); stop/resume use conditional updates and are owner-only with the same 404 for a stranger; `disabled` (provisioning) gives 409 and can never be activated by resume. Web: Stop with a confirm step, "Stopped" label, Resume, inline errors, mock routes; mobile: only the status guard.

**Follow-ups (not blocking):**
- `addGroupAi` does not refuse a stopped AI: it can be added to a room (it does not wake, but the membership is stale). Decide whether to allow this.
- Audit entries for `ai.stopped`/`ai.resumed` (the audit log exists now, T-0079).
- Room-admin and workspace-admin kill switch (J5).

**Open for Julio (live check):** stop and resume a real AI from the web panel while it answers in a DM and in a group; the AI should go offline at once (ejabberd `connected_users`), a reply that was being generated must not arrive, and resume must bring it back.
