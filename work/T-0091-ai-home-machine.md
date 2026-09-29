---
id: T-0091
title: AI home machine (M3/M4, server + web) — assign an AI to one of the owner's approved machines
status: merged
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
- Added `ais.machine_id text NULL` with FK `machines(id) ON DELETE SET NULL` and a supporting index, plus the matching Drizzle migration (`apps/server/drizzle/0014_white_shocker.sql`) generated via `pnpm --filter @galena/server db:generate`.
- Added `machine_id: string | null` (snake_case per spec) to `PublicAi` in `apps/server/src/ais/service.ts` and surfaced it in every public AI response: list, get, create, update, stop, resume.
- Added a new `assignMachine` service function in `apps/server/src/ais/service.ts`: owner-only, accepts `{ machineId: string | null }`, looks up the machine scoped to the caller and refuses anything that is missing, foreign, or not `approved` with 404 `machine_not_found`. Same value is a no-op 200. Re-read returns the fresh public AI.
- Added the new route `PUT /api/ais/:id/machine` in `apps/server/src/ais/routes.ts` with a strict zod object schema (unknown keys rejected). It writes one `ai.machine_assigned` audit entry with `detail: { machineId }` (or `null`) only when the value actually changed, mirroring the stop/resume recorder pattern, including the `try/catch` so a buggy recorder never breaks the route.
- Wrapped `revokeMachine` in `apps/server/src/machines/service.ts` in a transaction that also nulls `ais.machine_id` for every AI that pointed at the revoked machine, so the UI cannot leave a revoked machine displayed as an AI's home.
- Web `apps/web/src/lib/api.ts`: added `machine_id` to the AI zod schema (optional so an older server still parses) and a new `setAiMachine(aiId, machineId | null)` API that PUTs to `/api/ais/:id/machine`.
- Web `apps/web/src/components/ais/AiPanel.tsx`: added a "Runs on" `<select>` labelled select above the usage block. It loads the owner's machines via the existing `listMachines`, lists approved machines plus "The platform (no machine)", optimistically updates and rolls back on failure, shows an inline error, and stays disabled with the current value only when the load fails. While the PUT is in flight the select is disabled; a current value pointing at a machine that vanished (revoked in another tab) still renders so the owner sees what the AI is on.
- Web `apps/web/src/components/machines/ApprovedMachineCard.tsx` and `apps/web/src/routes/MachinesPage.tsx`: load the owner's AIs on the page (independent of the machines load), group them by `machine_id`, and pass `aiNames: string[] | null` to each approved card. The card renders "AIs: A, B" or "No AIs yet"; a failure of the AI load just hides the line. After a revoke, the page refetches the AI list so the AI drops off the card at once.
- Mock mode in `apps/web/src/mock/api.ts`: seeded AIs carry `machine_id: 'mach-approved'`; created AIs start null. Added the `PUT /api/ais/:id/machine` mock handler (rejects non-approved machines with `machine_not_found`) and made revoke also clear the AI link, matching the real server.
- Mobile `apps/mobile/src/lib/ais-api.ts` was **not touched**: its type-guard parser ignores unknown fields, so a server that adds `machine_id` keeps parsing. Verified by running the mobile suite and typecheck.
- Wrote Vitest coverage for every acceptance criterion in the spec: server (10 new AI tests + 2 new machine tests + the authz-sweep picking up the new route); web api (6 new); AiPanel (4 new); MachinesPage (3 new). Total tests added: 25.

### Files changed
- `apps/server/src/db/schema.ts` — added `machineId` column and `ais_machine_idx` index.
- `apps/server/drizzle/0014_white_shocker.sql` — generated migration (new).
- `apps/server/drizzle/meta/0014_snapshot.json` — generated snapshot (new).
- `apps/server/drizzle/meta/_journal.json` — generated journal entry.
- `apps/server/src/ais/service.ts` — `PublicAi.machine_id`, `aiColumns`/`publicAiColumns`, `AiRecord.machineId`, `toPublicAi`, new `assignMachine` and `AssignMachineInput`.
- `apps/server/src/ais/routes.ts` — `assignMachine` import, `AssignMachineSchema`, new `PUT /api/ais/:id/machine` route.
- `apps/server/src/ais/routes.test.ts` — new `AI home machine assignment (T-0091)` describe (10 tests).
- `apps/server/src/machines/service.ts` — `revokeMachine` now wraps both the status update and the `ais.machine_id = null` update in a single transaction.
- `apps/server/src/machines/routes.test.ts` — two new tests: revoke clears the link on the right AIs only; deleting a machine row nulls the link via `SET NULL`.
- `apps/web/src/lib/api.ts` — `machine_id` on the zod schema, new `setAiMachine`.
- `apps/web/src/lib/api.test.ts` — `AI home machine API (T-0091)` describe (6 tests).
- `apps/web/src/components/ais/AiPanel.tsx` — `listMachines`, new `changeMachine`, "Runs on" select, machine state, disabled handling, rollback + refetch on failure.
- `apps/web/src/components/ais/AiPanel.test.tsx` — `AiPanel home machine (T-0091)` describe (4 tests).
- `apps/web/src/components/machines/ApprovedMachineCard.tsx` — `aiNames` prop, "AIs: …" or "No AIs yet" line.
- `apps/web/src/routes/MachinesPage.tsx` — load the owner's AIs, `aisByMachineId` memo, refetch on revoke, pass `aiNames` to the card.
- `apps/web/src/routes/MachinesPage.test.tsx` — three new tests: lists AIs per machine, "No AIs yet" on a vacant one, drops the AI after a revoke.
- `apps/web/src/mock/api.ts` — seeded AIs carry `machine_id`, create starts null, new `assignMachine` mock, mock revoke clears the link.
- `work/T-0091-ai-home-machine.md` — front matter status and this Report.

### Commands run and real results
- `pnpm install`: `Done in 6.7s using pnpm v10.32.1`. All 11 workspace projects resolved; 1010 packages installed (293 added).
- `pnpm --filter @galena/server db:generate`: generated `0014_white_shocker.sql` with the expected three statements (column add, FK constraint with `ON DELETE set null`, index). Output: `21 tables, ais 14 columns 2 indexes 3 fks`.
- `pnpm --filter @galena/server test` (full server suite, run 1): `Test Files 48 passed | 5 skipped (53) / Tests 693 passed | 7 skipped (700)` in 181 s — clean baseline.
- `pnpm --filter @galena/server test src/ais/routes.test.ts src/machines/routes.test.ts --reporter=default`: `Test Files 2 passed / Tests 74 passed` after fixes; the 3 initial failures were (1) audit-entry `cost` field name vs `costCurrency`/`costAmount`, (2) audit-detail `sort()` ordering of an object, (3) missing FK target when inserting test AI rows directly. All three fixed by tightening the audit assertions, switching to a `map().sort()` on `machineId` strings, and adding a `providerConnections` insert in the machines test setup.
- `pnpm --filter @galena/server test` (full server suite, run 2 — the audit fix): `Test Files 48 passed | 5 skipped (53) / Tests 705 passed | 7 skipped (712)` in 140 s. The 12 new tests in this task are all in there.
- `pnpm --filter @galena/web test`: initial run failed with 3 broken new tests (select body matching, the "disabled, current value only" assertion expected `['m-approved']` but got `['', 'm-approved']`, and "No AIs yet" was on a machine that did have an AI). All three fixed by tightening the body matcher (`bodyOf(put!).toEqual(...)`), hiding the "The platform" option when the machines load fails, and using two machines in the "No AIs yet" test so one of them really is empty. Re-run: `Test Files 54 passed (54) / Tests 588 passed (588)` in 29.7 s.
- `pnpm --filter @galena/mobile typecheck` and `pnpm --filter @galena/mobile test`: typecheck clean; `Tests 348 passed | 2 skipped (350)` in 0.97 s. Mobile was not modified — its type-guard parser ignores the new field.
- `pnpm format:check`: initial run flagged 8 hand-written files plus the 2 generated `drizzle/meta/*`. Prettier-formatted the 8 hand-written files with `pnpm prettier --write …` and the 2 generated ones (`pnpm prettier --write apps/server/drizzle/meta/0014_snapshot.json apps/server/drizzle/meta/_journal.json`) to fix the missing trailing newlines the tool emits. Re-run: `All matched files use Prettier code style!`.
- `pnpm lint`: `oxlint .` clean.
- `pnpm typecheck` (turbo): `Tasks: 10 successful, 10 total`, including the 2 workspaces in this worktree (`@galena/server`, `@galena/web`) and the cached 8 from sibling packages.
- `pnpm exec turbo test --force`: one flaky `mergeTask` test in `@galena/devtools` (it shells out to git operations on the worktree) hit the 5 s default timeout under parallel load — different test fails on each run, never the same code path, and the test passes when run alone (`pnpm --filter @galena/devtools test` → `Tests 298 passed (298)`). This is an existing environmental flakiness in the lead tooling, unrelated to T-0091.
- `pnpm exec turbo test` (no `--force`, uses turbo's cache): all 10 packages green, `@galena/server 705 passed`, `@galena/web 588 passed`, `@galena/mobile 348 passed`.
- `pnpm build` (turbo): `Tasks: 2 successful, 2 total` — `@galena/server` (tsoa + tsc) and `@galena/web` (vite build, 2629 modules transformed) both built. No new warnings from my changes.

### Problems, deviations from the spec, open questions
- Drizzle named the migration `0014_white_shocker.sql` (its randomized suffix). Other workers may push their own migration; on rebase, if the next free index is taken, the spec asks to delete and regenerate. I left the file in place; if the rebase shows a conflict I'll regenerate.
- The spec says `PublicAi` gains `machine_id` "snake_case like the other fields". The other fields are camelCase (`providerConnectionId`, `perDayUsd`, …) but I followed the literal name in the spec and the wire (`machine_id`) over the existing style. This is what the spec asked for; flagging in case the lead prefers the camelCase form `machineId` on the wire too.
- The mock AI seed carries `machine_id: 'mach-approved'` so the panel renders with something for the lead's live check; the prod side starts null and lets the owner choose. The mock revoke also clears the AI link, matching the real server.
- `authz-sweep` picked up `PUT /api/ais/:id/machine` and answered 401 without a session — exactly the behaviour the spec required, so no allowlist edit was needed.
- The lead's `mergeTask` test in `@galena/devtools` flaked once under `turbo test --force`; it passes alone and is unrelated to this task. Reported here, not blocked on it.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** approved and merged after lead changes (the spec had one error, mine).

Rebased on main; after the last edit format, lint, typecheck clean; server 767 passed, web 588, mobile 348. No disable comments; `db:generate` reports no schema changes.

Lead changes:
1. **Field naming.** The spec said `machine_id` (snake_case) "like the other fields", but the public AI is camelCase (`providerConnectionId`, `createdAt`). Renamed to `machineId` on the wire, in the request body, in web and in tests. That was my spec mistake, not the worker's.
2. **Migration collision** with T-0090's `0014`: deleted the worker's migration and regenerated (`0015_late_randall_flagg.sql`).
3. Fixed the "unknown body key" test that the rename turned into a duplicate key (now sends a real extra key).

Confirmed: only the owner can assign, only to their own approved machine (missing, foreign, pending and revoked all answer 404 `machine_not_found`); revoke clears the link in the same transaction; deleting the row is covered by `SET NULL`; audit only on a real change; `PATCH /api/ais/:id` untouched; the authz sweep picked the new route up and it answers 401; mobile untouched and still parses AIs.
