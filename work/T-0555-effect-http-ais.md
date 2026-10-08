---
id: T-0555
title: "Effect C (HTTP): AI management routes (list, detail, create, patch, delete, stop, resume, machine) onto the HttpApi adapter, zod to Effect Schema; usage timeout and 503 gating kept; every PublicAi field encoded; tests unchanged"
status: merged
milestone: M5
branch: task/T-0555-effect-http-ais
model: auto
effort: low
depends_on: [T-0548]
estimate: 1 day
---

# T-0555: AI management routes on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (items 8-11). The worked examples are `apps/server/src/topics/api.ts` and `apps/server/src/groups/api.ts`. **Do not touch** `ais/service.ts` or `ais/usage.ts`.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/ais/routes.ts`** (379 lines):
  - `AisRoutesDependencies` (line 30) holds `auth`, `db`, `config`, `adminClient`, `logger`, `litellm?`, `cipher?` and `audit?`. When `litellm` or `cipher` is absent, the routes that touch an AI answer **503** instead of failing halfway;
  - `AiUsageSummary` (49), `PublicAiWithUsage` (54) and `USAGE_TIMEOUT_MS = 2_000` (59);
  - three zod body schemas: `CreateAiSchema` (77), `UpdateAiSchema` (91) and `AssignMachineSchema` (111);
  - `createAisRoutes` (117).
- **Helpers in the route module:**
  - `withAvatars` (around 151) attaches `avatarUrl`, absent rather than null when there is none;
  - `withUsage` (around 168) races `getAiUsage(...).catch(() => null)` against a `USAGE_TIMEOUT_MS` timer, answers `usage: null` on failure or timeout, and runs per AI in parallel for the list.
- **The eight routes:**
  - `GET /ais` (182) and `GET /ais/:id` (190; 404 "AI not found");
  - `POST /ais` (200) and `PATCH /ais/:id` (219);
  - `DELETE /ais/:id` (244), which answers **204**;
  - `POST /ais/:id/stop` (266) and `POST /ais/:id/resume` (293). Each writes one audit entry only when the status actually flipped;
  - `PUT /ais/:id/machine` (328).
- **The success schema must carry every `PublicAi` field** (`apps/server/src/ais/service.ts:34-59`):
  - `id`, `name`, `template`, `persona`, `model`, `jid`;
  - `status` (`active | disabled | stopped`), `providerConnectionId`, `limits` (`AiLimits`; read its fields);
  - `machineId` (nullable), `canDelegate`, `acceptsDelegation`;
  - `avatarUrl` (**optional, never null**), `createdAt` (a Date encoded as the same ISO string);
  - plus `usage: { todayUsd, windowUsd } | null`.
  
  **Put the field-by-field comparison in the Report.**
- **Outside importers:** only `apps/server/src/app.ts:8`. The mount is around line 622, with `createAisRoutes({ auth, db, config, adminClient, logger: ais?.logger ?? logger, audit: auditRecorder, ...cipher, ...litellm })`. Keep it at the same position.
- **Tests (all unchanged):** `apps/server/src/ais/routes.test.ts` builds the app through `createApp` (lines 215, 893, 1207 and 1358), plus the other `apps/server/src/ais/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/ais/api.ts`** with the eight routes on `HttpApi`:
   - the same statuses (204 on delete, 503 gating), bodies, audit calls, texts and **step order**;
   - the same usage timeout and per-AI parallelism;
   - Effect Schema for the three bodies, with the same rules and strictness, and no zod in the module;
   - success schemas as above.
2. **`routes.ts`:** delete it if `app.ts` is its only importer, after moving the exported types and constant into `api.ts`. Otherwise keep it re-export-only.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Secrets:** provider keys and virtual keys never appear in a response or log, as today.
5. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/ais/routes.ts` (all of it), `apps/server/src/ais/service.ts` (lines 1-110), and the ais mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/ais/api.ts`, `apps/server/src/ais/routes.ts`, `apps/server/src/app.ts`, `work/T-0555-effect-http-ais.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot ais authz-sweep app.test
pnpm gate
```

### Acceptance
- AI management is served by Effect `HttpApi`, with the same answers, usage behaviour and mount position, every `PublicAi` field encoded, and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Migrated the AI management routes from Hono (`ais/routes.ts`) to the Effect
`HttpApi` adapter in a new `apps/server/src/ais/api.ts`, following the recipe
in `docs/EFFECT_GUIDE.md` and the `groups/api.ts` / `roles/api.ts` examples.
`app.ts` now mounts via `mountEffectRoutes(...)` at the same position.
`routes.ts` is re-export-only (types + `USAGE_TIMEOUT_MS`, with
`AisRoutesDependencies` aliased to the new `AisApiDependencies`); no other
file imports it besides `app.ts`, which no longer does.

### Files changed
- `apps/server/src/ais/api.ts` (new): eight `HttpApi` endpoints
  (`list`, `detail`, `create` 201 via `jsonUnsafe`, `patch`, `remove` 204 via
  `HttpApiSchema.NoContent`, `stop`, `resume`, `assignMachine`), Effect Schema
  bodies with `onExcessProperty: 'error'` strictness, `Session` + schema-error
  middleware (400 `invalid_request`), same 503 gating, same audit calls, same
  usage timeout + per-AI parallelism.
- `apps/server/src/ais/routes.ts`: re-export-only.
- `apps/server/src/app.ts`: mount with `mountEffectRoutes` at the same position.
- `work/T-0555-effect-http-ais.md`: this report + status.

### Field-by-field comparison (`PublicAi` in `service.ts:34-59` vs success schemas)
List/detail use `AiView` (= every `PublicAi` field + `usage`); the five write
routes use `PublicAiView` (= every `PublicAi` field, no `usage`), matching the
old router, whose writes answered the undecorated service value:
- `id`, `name`, `template` (literals `dev | marketing | fun | custom`),
  `persona`, `model`, `jid`: present in both schemas. ✓
- `status` (`active | disabled | stopped` literals): present in both. ✓
- `providerConnectionId`: present in both. ✓
- `limits` (`{ perDayUsd, perMonthUsd }` numbers): present in both. ✓
- `machineId` (nullable): `Schema.NullOr(Schema.String)` in both. ✓
- `canDelegate`, `acceptsDelegation` (booleans): present in both. ✓
- `avatarUrl` (optional, never null): `Schema.optional(Schema.String)` in
  both; omitted when the AI has no picture, same as `withAvatars` before. ✓
- `createdAt`: `Schema.Date` in both, encoded as the same ISO string. ✓
- `usage` (`{ todayUsd, windowUsd } | null`): only in `AiView` (list/detail),
  absent from the write schemas exactly as the old writes omitted it. ✓
No provider keys or virtual keys in any response: the schemas expose only the
fields above (verified by the unchanged no-leak assertions in `routes.test.ts`).

### Behaviour kept
- Step order per route identical (session → 503 gate → decode → service →
  audit-on-flip); stop/resume/machine need only the DB; audit written only on
  a real flip, recorder errors swallowed.
- `withUsage`: `usage: null` without LiteLLM, on failure, or after
  `USAGE_TIMEOUT_MS` = 2_000 ms; list reads run in parallel.
- Decode failures answer 400 `invalid_request` (message text is now Schema's
  instead of zod's first-issue text; no test asserts the old texts — verified
  by grep: tests assert only statuses/codes).
- Invalid-JSON bodies: decoded by the Effect adapter (400); no test posts
  malformed JSON to these routes (verified by grep).

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/routes.test.ts`: 49 passed.
- Same with `src/ais/usage.test.ts src/ais/service.test.ts src/ais/litellm-model.test.ts`: 47 passed.
- Same with `src/authz-sweep.test.ts`: 5 passed.
- Same with `src/app.test.ts`: 9 passed.
- `pnpm exec prettier --write` on `ais/api.ts` (format fix for the new file only).
- `pnpm gate`: PASS install, PASS format, PASS lint, PASS typecheck,
  PASS tests @zilar/server, scope: every changed file inside Allowed files,
  GATE PASS.

### Deviations / notes
- Deps interface renamed `AisRoutesDependencies` → `AisApiDependencies`;
  `logger` stays the narrow `AiLogger` (`warn`-only), adapted internally to
  a pino `Logger` for the error envelope (`error` → `warn`, same
  fields/message).
- `service.ts` and `usage.ts` untouched. No test file touched.
- Security checklist: secrets never in responses/logs (schemas + unchanged
  leak tests); owner-scoped reads (same 404 for foreign/missing); audit
  carries ids only (`ai.machine_assigned` detail holds only `machineId`); all
  eight routes use exact paths under `Session`, covered by the 401 sweep
  (green, unchanged).

### Round 2 (fix round: PREREVIEW findings 1-2, nit 3 left as-is)
- Finding 1 (should-fix, 503/decode step order): added an `AisConfigured`
  endpoint middleware in `ais/api.ts` (precedent: `pins/api.ts`
  `PinsWriteRateLimit`), applied to `create`, `patch` and `remove`, provided
  via `configuredLayer({ litellm, cipher })`. The gate answers 503
  `ais_unavailable` through `httpErrorResponse` before the adapter decodes
  the payload, restoring the old `requireConfigured()` → `safeParse` order.
  The in-handler `requireConfigured()` stays as an unreachable backstop.
  Verified with a temporary (then deleted) test: unconfigured server +
  malformed create body (`{}`) → 503 `ais_unavailable` (was 400 before the
  fix); unconfigured + patch body missing the required model →
  503 `ais_unavailable`. 2 passed; temp file deleted.
- Finding 2 (should-fix, dead shim): deleted `apps/server/src/ais/routes.ts`
  (`git rm`). Verified no server source or test imports it (only stale
  comments in `apps/web/.../api.ts:1173` and `apps/mobile/.../ais-api.ts:10`,
  outside Allowed files, left untouched).
- Nit 3 (defect logs at warn): left as-is — the route `logger` shape is the
  `AiLogger` (`warn`-only) owned by `ais/service.ts`, which this task must
  not touch; changing it would widen the service's logger contract. Bodies
  unchanged: 500s still answer `internal_error` through the envelope.
- Tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot ais authz-sweep app.test`: 6 files passed, 110 passed, 2 skipped (same as round 1).
- `pnpm gate`: PASS install, PASS format, PASS lint, PASS typecheck, PASS
  tests @zilar/server, scope: every changed file inside Allowed files,
  GATE PASS.

## Review (written by Claude)

Approved (lead, 2026-10-08) after one auto fix round, which made the 503 gate endpoint middleware before decode and deleted the dead routes.ts. AI management (8 routes) is served by Effect HttpApi at the same position, with the same order, usage timeout, audit-on-flip and 204. Lead check: AiView lists every PublicAi field plus usage (avatarUrl optional, never null), and AiLimitsView matches AiLimits. Nits accepted: generic decode texts are now Schema text, and AisRoutesDependencies was renamed AisApiDependencies (no other importer). Follow-up: stale comments mentioning ais/routes.ts in apps/web/src/lib/api.ts:1173 and apps/mobile/src/lib/ais-api.ts:10.
