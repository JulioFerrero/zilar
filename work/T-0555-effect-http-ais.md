---
id: T-0555
title: "Effect C (HTTP): AI management routes (list, detail, create, patch, delete, stop, resume, machine) onto the HttpApi adapter, zod to Effect Schema; usage timeout and 503 gating kept; every PublicAi field encoded; tests unchanged"
status: todo
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

## Review (written by Claude)
