---
id: T-0868
title: "Server sweep: approvals, audit, routines, directory onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0868-sweep-approvals-routines
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0868: Server sweep: approvals, audit, routines, directory onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/approvals/`, `apps/server/src/audit/`, `apps/server/src/routines/`, `apps/server/src/directory/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- `routines/api.ts:131` and `:296` declare `Void` but send 204

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
`apps/server/src/approvals/**`, `apps/server/src/audit/**`, `apps/server/src/routines/**`, `apps/server/src/directory/**`, `work/T-0868-sweep-approvals-routines.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/approvals src/audit src/routines src/directory src/authz-sweep.test.ts src/routes-manifest.test.ts
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

- **Commits:** `0390053c` directory, `c8a89004` audit, `764a4057` routines, `56cf5436` approvals (one per module).
- **Lines removed** (`git diff --numstat`, removed / added incl. the new `routes.expected.ts`): directory 108 / 40 (net -68); audit 36 / 15 (net -21); routines 178 / 114 (net -64); approvals 103 / 49 (net -54). Total net -207.
- **Recipe steps:** `runSql` copies deleted in `audit/service.ts`, `approvals/service.ts`, `approvals/rules.ts`, `approvals/api.ts` (routines had none left after T-0863; directory had none). Rate limit via `makeRateLimit` in directory (tag `zilar/effect/http/DirectoryRateLimit`, same message). Handlers via `handler(logger, ...)` in all four. `*_API_ROUTES` replaced by `mountApi`, old arrays moved to `<module>/routes.expected.ts`; `routes-manifest.test.ts` untouched.
- **Truthful status:** `routines/api.ts` `remove` now declares `HttpApiSchema.NoContent` (was `Schema.Void`), and the handler returns nothing instead of `HttpServerResponse.empty({ status: 204 })`, like `roles` remove. The wire stays 204 with no body (existing tests pass). Both cited sites (`:131` the `Schema.Void` declaration, `:296` the `empty({ status: 204 })` return) matched the code.
- **Kept local on purpose** (not plain, wire text would change with the shared class): `AuditSchemaErrors` (fixed text `Invalid audit query`) and `ApprovalsSchemaErrors` (fixed text `Invalid decision body`). Routines and directory now use the shared `SchemaErrors`; routines' old local one added `|| 'Invalid request'` for an empty message, which cannot fire (its params are plain strings).
- **Routines:** pause and resume share a local `changeStatus` helper (same access check, same `withServiceErrors` mapping, same re-read). The other handlers are `async` bodies; thrown `HttpError`s still travel as defects through the envelope.
- **Audit/approvals handlers** keep their `Effect.gen` bodies (audit returns raw `jsonUnsafe` responses and the 400 for both/neither id; approvals' decide keeps `catchDefect` mapping).
- **Checks:** combined vitest command (approvals, audit, routines, directory, authz-sweep, routes-manifest): 16 files, 234 tests passed, 3 of 3 runs, run at load average about 51 (`uptime`: 50.85 56.60 69.97), with 120 s timeouts. `pnpm --filter @zilar/server typecheck` clean. `oxlint` on the four folders clean.
- **Behaviour differences:** none.
- **Unsure:** none. `pnpm gate` not run (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** Directory, audit, routines and approvals are converted (net −207 lines), and the routines remove declares 204. Audit and approvals keep their own schema-error text, so the bytes stay identical. The merge with main keeps T-0852's `canDecideMany`. The combined wave 4 check passes.
