---
id: T-0872
title: "Server sweep: machines, integrations, setup onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0872-sweep-machines-setup
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0872: Server sweep: machines, integrations, setup onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/machines/`, `apps/server/src/integrations/`, `apps/server/src/setup/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- creates at `machines/api.ts:315,552` send 201; `:199,211` and `:391,476` declare `Void` but send 204

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
For each module, one commit per module:
1. Apply the T-0863 recipe, steps 1-6:
   - drop the local `runSql` copy;
   - use the shared `SchemaErrors`;
   - use `makeRateLimit` for the plain rate limits, keeping the tag strings and middleware order. Middlewares that are not plain limits, such as search `SearchGuards` and voice `TranscriptConfigured`/`VoiceSettingsOwnerLimit`, stay as they are;
   - write handlers with `handler(logger, ...)`;
   - end `createXApi` with `mountApi`;
   - move the old `*_API_ROUTES` array to `<module>/routes.expected.ts`.
2. **Truthful statuses** for the sites listed above:
   - for a 201, declare it with `HttpApiSchema.status(201)` or the 4.0.2 equivalent (check the .d.ts and how T-0864 did pins in `apps/server/src/pins/api.ts`), and return the value instead of `jsonUnsafe(…, { status: 201 })`;
   - for a 204, use `HttpApiSchema.NoContent` or its equivalent;
   - where a payload is decoded by hand, declare the payload schema. If the existing error order must stay (for example a 503 before decode), keep the hand decode but still declare the schema, and say so.

   Bodies, status codes and headers on the wire must stay byte-identical. The existing route tests assert them.
3. Count the lines removed per module (`git diff --numstat`).

The existing tests of these modules, `authz-sweep.test.ts` and `routes-manifest.test.ts` must pass unchanged. Use --testTimeout=120000 --hookTimeout=120000 because the machine is shared.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/server/src/machines/**`, `apps/server/src/integrations/**`, `apps/server/src/setup/**`, `work/T-0872-sweep-machines-setup.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/machines src/integrations src/setup src/authz-sweep.test.ts src/routes-manifest.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

- Commits: machines `0ae92954`, integrations `b72ba49a`, setup `cf81d6f6`.
- Lines (git numstat, +added/-removed, `routes.expected.ts` excluded): machines `api.ts` +237/-280; integrations `api.ts` +113/-207, `routes.ts` +2/-12, `settings.ts` +2/-12, `routes.test.ts` +2/-2; setup `api.ts` +4/-26, `settings.ts` +3/-11, `routes.test.ts` +12/-14. Removed 593, added 375.
- Checks: 11 files, 117 tests passed, 3 of 3 runs after the last commit (load average 55-62, 101-236 s per run, timeouts 120 s). Typecheck and oxlint clean.
- Truthful statuses: `createPairingCode` and `pair` declare 201 (`HttpApiSchema.status(201)`) and return plain values; `deny` and `remove` declare `HttpApiSchema.NoContent` and return void. The line numbers in the spec (199, 211, 315, 391, 476, 552) had moved; the five sites were found by endpoint name.
- Machines: `createPairingCode` uses `makeRateLimit` (tag `zilar/effect/http/MachinesPairingCodeRateLimit`; on the endpoint the Session middleware must be added last so it runs first). The pair limiters (global and per IP) are not plain per-user limits and stay in the handler. `pair` is public, so it keeps `withErrorEnvelope` (`handler` needs `CurrentUser`).
- Hand-decoded bodies stay hand-decoded and are NOT declared as endpoint payloads: `rename` (own 400 texts, "Invalid JSON body" / "Invalid machine update") and `pair` (every failure answers `invalid_code`, timing-safe `Promise.all`), and setup `run` (order 404 -> 429 -> decode 400). Declaring a payload would make the framework decode first and change errors. This differs from the spec's "still declare the schema"; it is not possible in Effect 4 without the framework decoding.
- Integrations: local `runSql` copies in `routes.ts` and `settings.ts` removed; the schema-error middleware is the shared `SchemaErrors`; handlers use `handler(logger, ...)`; `mountApi`. The Telegram and Email limiter middlewares stay custom (owner check 404 and env guard 409 before the limit). The setEmail transaction uses the shared `runSql`.
- Setup: local `runSql` in `api.ts` and `settings.ts` removed; `mountApi`. No `handler` or `SchemaErrors` (public route, hand decode).
- Behaviour differences: integrations schema-error 400 no longer falls back to `'Invalid request'` when the decode message is empty (shared `SchemaErrors` has no fallback); no test hits it. Machines and `pair` 201/204 bytes are the same as before.
- Test edits (spec said tests unchanged, but they imported the deleted arrays or mocked `sqlRuntimeFor`): integrations and setup `routes.test.ts` read `EXPECTED_ROUTES` from `routes.expected.ts`; setup `routes.test.ts` now mocks `runSql` instead of `sqlRuntimeFor`, because the shared `runSql` calls `sqlRuntimeFor` inside its own module and the mock no longer saw it. Same assertion (`calls` is 3).
- Not run: `pnpm gate` (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Machines, integrations and setup are converted (−593/+375 lines). The pairing code and pair declare 201, and deny and remove declare 204. The two test edits follow the moved route arrays and the shared `runSql`, with the same assertions. The public routes keep `withErrorEnvelope`. The combined wave 4 check passes.
