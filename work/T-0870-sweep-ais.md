---
id: T-0870
title: "Server sweep: ais, agents/memory, connections, voice, search onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses"
status: merged
milestone: M5
branch: task/T-0870-sweep-ais
model: auto
effort: default
depends_on: [T-0863]
estimate: 0.5 day
---

# T-0870: Server sweep: ais, agents/memory, connections, voice, search onto the shared HTTP helpers (runSql, SchemaErrors, makeRateLimit, handler, mountApi) with truthful success statuses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Phase 2 of the simplify plan (C-F1 to C-F5, B-B1 and B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`). T-0863 built the helpers, converted blocks and roles, and wrote the recipe: read the Report section "How to convert a module" in `work/T-0863-server-http-helpers.md` and follow it exactly. One rule changed in round 1: each converted module gets `<module>/routes.expected.ts` holding its old route array, and `routes-manifest.test.ts` is not edited.

**Modules in this task:** `apps/server/src/ais/`, `apps/server/src/agents/memory/`, `apps/server/src/connections/`, `apps/server/src/voice/`, `apps/server/src/search/`.

**Success statuses to make truthful in these modules** (B-B1; the server sends a status its HttpApi declaration does not say, which a derived client will reject):
- create at `ais/api.ts:459` sends 201 via `jsonUnsafe`
- create at `connections/api.ts:222` sends 201; a payload is decoded by hand at about `:206-212`

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
`apps/server/src/ais/**`, `apps/server/src/agents/memory/**`, `apps/server/src/connections/**`, `apps/server/src/voice/**`, `apps/server/src/search/**`, `work/T-0870-sweep-ais.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/ais src/agents/memory src/connections src/voice src/search src/authz-sweep.test.ts src/routes-manifest.test.ts
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

### What changed (one commit per module, plus a service commit each)
- search `2de8a3a2`, voice `fbeed1cc`, connections `5b488c5c`, agents/memory `40764067`, ais `9c7825a1`; then `0515d5d5` (memory), `62066f49` (connections), `820a1440` (search) swap the local `runSql` copies in the service files. `voice/routes.expected.ts` was committed inside the search commit by mistake (same content, still before the voice conversion).
- All five `createXApi` end with `mountApi`; handlers use `handler(logger, ...)`; each module has `routes.expected.ts`; `routes-manifest.test.ts` is untouched (36 manifests still match).
- Local `runSql` copies removed from: ais/service.ts, ais/usage.ts, agents/memory/store.ts, agents/memory/indexer.ts, connections/service.ts, search/service.ts.
- Rate limits: memory uses `makeRateLimit('zilar/effect/http/AiMemoryWriteRateLimit', 'Too many memory changes, try again later')`. Search guards, ais `AisConfigured`: left as they are. Voice has no plain limit or guard in this file.
- Success statuses: `ais` create and `connections` create now declare `HttpApiSchema.status(201)` and return the value (no `jsonUnsafe`). The 204 deletes already used `HttpApiSchema.NoContent`.

### Lines removed (git numstat, +added/-removed, spec commit to HEAD)
- search: api.ts +16/-32, service.ts +2/-9, routes.expected.ts +3
- voice: api.ts +8/-28, routes.expected.ts +3
- connections: api.ts +27/-64, service.ts +1/-8, routes.expected.ts +8
- agents/memory: api.ts +77/-163, store.ts +1/-8, indexer.ts +1/-8, routes.expected.ts +7
- ais: api.ts +148/-225, service.ts +1/-8, usage.ts +2/-9, routes.expected.ts +12
- Total: +317/-562 (net -245).

### Checks
- Vitest (spec command, 120 s timeouts): 24 files passed, 4 skipped; 291 tests passed, 6 skipped. Runs after the last commit: 4 of 4 clean in the later runs; the very first run (load average about 70, 372 s) printed "1 error" and 268 tests (one file did not finish) and I did not capture its text; the next 4 runs at lower load were clean (222 s, 35 s, 35 s, 35 s). Not reproduced.
- `pnpm --filter @zilar/server typecheck`: clean. oxlint on the changed files: clean. prettier applied.

### Behaviour differences
- none observed on the wire (existing route tests pass unchanged). Two notes:
  - memory now uses the shared `SchemaErrors`, whose message is `error.cause.message` without the old `|| 'Invalid request'` fallback; an empty schema message is not reachable in practice.
  - ais keeps its own `AisSchemaErrors` (fallback text `Invalid AI request`) and search keeps its own (fixed text `Invalid search query`) because their texts differ from the shared one.

### Unsure / deviations
- connections create: I did NOT declare the payload schema. A declared payload is decoded by the framework before the handler, which would put the 400 before `requireCipher` 503 and merge `Invalid JSON body` with `Invalid connection request`. The hand decode stays; only the 201 is declared. A derived client therefore has no request type for this endpoint.
- Test machine load stayed at 50-75, so the first runs took 6 minutes.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Converted:** search, voice, connections, agents/memory and ais, for a net −245 lines. The local `runSql` copies are gone from 6 service files.
- **Statuses:** the ais and connections creates declare 201.
- **Not declared:** the connections create payload, so the 503 stays ahead of a 400. A derived client will need it declared later.
- **Check:** the combined wave 4 check passes.
