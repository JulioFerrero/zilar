---
id: T-0873
title: "Server sweep: voice-transcription, gifs, auth, contact-requests onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: todo
milestone: M5
branch: task/T-0873-sweep-voice-auth
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0873: Server sweep: voice-transcription, gifs, auth, contact-requests onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/voice-transcription/`, `apps/server/src/gifs/`, `apps/server/src/auth/`, `apps/server/src/contact-requests/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- PATCH /me decodes its payload by hand (`auth/api.ts:205,261-264`)
- `contact-requests/api.ts:334-339` sends 200 for a reverse request and 201 otherwise (give it both success statuses)

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
`apps/server/src/voice-transcription/**`, `apps/server/src/gifs/**`, `apps/server/src/auth/**`, `apps/server/src/contact-requests/**`, `work/T-0873-sweep-voice-auth.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/voice-transcription src/gifs src/auth src/contact-requests src/authz-sweep.test.ts src/routes-manifest.test.ts
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

## Review (written by Claude)
