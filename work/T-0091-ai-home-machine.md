---
id: T-0091
title: AI home machine (M3/M4, server + web) — assign an AI to one of the owner's approved machines
status: todo
milestone: M3
branch: task/T-0091-ai-home-machine
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0071, T-0072, T-0080]
estimate: 1 day
---

# T-0091: An AI's home machine

## Spec (written by Claude, do not edit)

### Goal

`docs/PROJECT_PLAN.md` §11.5: an owner can pick which of their machines is an AI's **home machine** (where its desk will live). The runner does not host desks yet, so this task only stores and shows the choice: a nullable `machine_id` on the AI, a route to set or clear it, and two small web changes. It must be safe: only the AI's owner, only their own approved machines, and it never leaves a link to a revoked machine.

### Decisions (follow them)
- Column `ais.machine_id` text, nullable, FK → `machines(id)` `ON DELETE SET NULL`. New AIs start with `null` (= "on the platform").
- Route **`PUT /api/ais/:id/machine`** with body `{ "machine_id": string | null }` (strict zod object, unknown keys rejected). It is a separate route on purpose: do **not** change `updateAi` or `PATCH /api/ais/:id`.
  - Session required. AI not found or not owned by the caller → 404 `not_found` (same shape as the other AI routes, no leak).
  - `machine_id` not found, not owned by the caller, or not `approved` (pending or revoked) → 404 `machine_not_found` (do not tell which).
  - `null` clears. Setting the same value again is fine (200, no change).
  - Answers the updated public AI. **`PublicAi` gains `machine_id: string | null`** (snake_case like the other fields) in every place a public AI is returned (list, get, create, update, stop, resume).
  - Writes an audit entry `ai.machine_assigned` (subject = the AI id, detail `{ machineId }` or `{ machineId: null }`) through the existing recorder, only when the value actually changed.
- Revoking a machine (`revokeMachine` in `machines/service.ts`) must also set `machine_id = null` on the AIs that point to it, in the same transaction as the revoke. Deleting a machine row is covered by `SET NULL`.
- A stopped or provisioning AI can still be assigned (it is only a pointer).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §11.5
- `apps/server/src/ais/routes.ts`, `service.ts` (`toPublicAi`, `PublicAi`), `routes.test.ts`; `apps/server/src/machines/service.ts` (`revokeMachine`) and its tests
- `apps/server/src/audit/service.ts` (action name pattern and how routes record entries, e.g. the stop/resume routes)
- `apps/web/src/lib/api.ts` (AI types, `stopAi`), `components/ais/AiPanel.tsx`, `components/machines/ApprovedMachineCard.tsx`, `routes/MachinesPage.tsx`, `mock/api.ts`
- Generate migrations only with `pnpm --filter @galena/server db:generate` (**never `npx`**). Another task may add a migration at the same time; if numbering collides after a rebase, delete yours and regenerate.

### Allowed files
- `apps/server/src/db/schema.ts` (the one column) and the generated migration under `apps/server/drizzle/`
- `apps/server/src/ais/` (routes, service for `toPublicAi`/`PublicAi` and a new `assignMachine`, tests)
- `apps/server/src/machines/service.ts` and its tests (revoke clears the link)
- `apps/web/src/lib/api.ts`, `api.test.ts`; `apps/web/src/components/ais/AiPanel.tsx` (+ test) and a new small component under `components/ais/` if you want; `apps/web/src/components/machines/ApprovedMachineCard.tsx`, `routes/MachinesPage.tsx` (+ tests); `apps/web/src/mock/api.ts`
- `apps/mobile/src/lib/ais-api.ts` **only if** its zod schema rejects the new `machine_id` field (it must keep parsing); otherwise do not touch mobile
- `work/T-0091-ai-home-machine.md`

**Not allowed:** `PATCH /api/ais/:id`, the runner, the tunnel hub, XMPP or gateway code, new dependencies, any other mobile file.

### What to build
1. Schema column + migration + `PublicAi.machine_id`.
2. `assignMachine` service function and `PUT /api/ais/:id/machine` as decided above, with the audit entry.
3. `revokeMachine` clears the link in its transaction.
4. Web `lib/api.ts`: `machine_id` on the AI type; `setAiMachine(aiId, machineId | null)`.
5. Web AiPanel: a labelled "Runs on" select listing the owner's **approved** machines plus "The platform (no machine)"; changing it calls `setAiMachine`, shows a pending state, restores the old value and shows an inline error on failure. Load machines with the existing `listMachines`; if that fails show the select disabled with the current value only. Owners only (the panel is already owner-only; do not show it elsewhere).
6. Web machine card (approved machines only): a line "AIs: A, B" (names of the owner's AIs whose `machine_id` is this machine) or "No AIs yet". Get the AIs from the existing AI list call; a failure there just hides the line.
7. Mock mode (`?mock=1`): the seed AIs and machines support the new route and field.

### Tests (Vitest)
- Server: owner assigns an approved machine → 200 with `machine_id`; clearing with `null`; another user's AI → 404; another user's machine → 404 `machine_not_found`; pending and revoked machine → 404 `machine_not_found`; unknown body key → 400; unauthenticated → 401; audit entry only on a real change; `revokeMachine` sets the AI's `machine_id` to null and leaves other AIs alone; deleting the machine row nulls it; every public AI response includes `machine_id`.
- Web: api client parses the field and calls the route; AiPanel change success, failure (rollback + error), machines failing to load; machine card lists AI names / "No AIs yet".
- Add the new route to nothing else: `authz-sweep.test.ts` will pick it up by itself and must still pass (it must answer 401 without a session).

### Live check (the lead does it)
Web `?mock=1` and the real stack: assign, reload, clear, revoke a machine and see the AI fall back to "The platform".

### Acceptance criteria
- [ ] Only the owner can assign, only to their own approved machine; other cases answer 404 with no hint.
- [ ] Revoking a machine unassigns its AIs.
- [ ] `PATCH /api/ais/:id` and everything else unchanged; mobile still parses AIs.
- [ ] Migration generated (not hand-written); no `any`, no `@ts-ignore`, **no lint or ts disable comments** (use the adjust-state-during-render pattern rather than setting state in an effect); lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Placing the desk on the runner, presence/away when the machine is offline, "needs" requirements, drag and drop, mobile UI.

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
