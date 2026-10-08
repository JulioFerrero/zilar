---
id: T-0552
title: "Effect lane E, batch 8 (last): mobile tools-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged; no hand-validated mobile API client left"
status: merged
milestone: M5
branch: task/T-0552-effect-mobile-api-batch-8
model: auto
effort: low
depends_on: [T-0547]
estimate: 1 day
---

# T-0552: mobile tools API client on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase moves to Effect 4, mobile included. After T-0550 and T-0551, `tools-api.ts` is the last hand-validated mobile API client.
- **Recipe:** `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect".
- **Recent example:** `apps/mobile/src/lib/ais-api.ts` (T-0547).
- **Shared lenient error envelope:** `apps/mobile/src/lib/api-error-body.ts`. Use it; never write a local `ErrorBodySchema`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/lib/tools-api.ts`** (613 lines) exports:
  - the types `ToolLastRunStatus`, `ToolListItem`, `ToolRunTrigger`, `ToolRunStatus`, `ToolDetail`, `ToolVersion`, `ToolVersionDetail`, `ToolRun`, `ToolRunResult` (a union), `RoutinePausedReason`, `RoutineLastStatus`, `Routine`, `RoutineStatus`, `ToolsApi`, `ToolDetailsApi`, `RoutineActionsApi`, `ToolActionsApi` and `AiToolsApi`;
  - `ToolsApiError` (line 151) and `createToolsApi` (461).
  
  **Every export stays the same.**
- **Tests that cover it (all unchanged):**
  - `apps/mobile/src/lib/{tools-api,routines-format}.test.ts`;
  - `apps/mobile/src/components/ais/{tool-actions,tool-detail-format}.test.ts`;
  - `apps/mobile/src/components/ais/{routines-section,tools-section,tool-detail-sheet}.test.tsx`.

### What to build
1. **Convert the file with the recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance: the `ToolRunResult` union and the status enums decode or default exactly as the hand validator did;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
2. **In the Report,** list each place where the hand validator dropped or defaulted a value, and the schema construct that now does it.
3. **Tests:** every existing test passes **unchanged**. You may add `apps/mobile/src/lib/tools-api.effect.test.ts`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/lib/tools-api.ts` and its tests.

### Allowed files
`apps/mobile/src/lib/tools-api.ts`, `apps/mobile/src/lib/tools-api.effect.test.ts`, `work/T-0552-effect-mobile-api-batch-8.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot tools routines tool-actions tool-detail
pnpm gate
```

### Acceptance
- The tools client decodes with Effect Schema and the shared envelope, and runs as an Effect pipeline, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Converted `apps/mobile/src/lib/tools-api.ts` to the T-0506 Effect recipe
(following `pins-api.ts` / `ais-api.ts`): Effect Schema decodes at the
boundary, the request runs as an Effect pipeline cut back to `Promise` with
`Effect.runPromise`, the shared `errorFieldsOf` envelope replaces the local
per-field guards, and no local `ErrorBodySchema` exists. Same exports, same
request paths/bodies/headers, same `ToolsApiError` status/code/message for
every failure (network throw, non-JSON body, error envelope, invalid row).

Hand-validator drop/default points and their schema constructs:
- `ToolListItem.groupId`/`topicId` (missing value failed the row):
  required `Schema.NullOr(Schema.String)` — missing/undefined still fails.
- `ToolListItem.lastRunStatus` (unknown string failed the row): required
  `Schema.NullOr(Schema.Literals(['ok', 'error']))`.
- `ToolListItem.approvedHosts` (optional, non-array failed the row):
  `Schema.optional(mutable Array(String))`; absent stays absent.
- `ToolListItem`/`Routine.scope` (invalid value failed the row, absent
  stayed absent): `Schema.optional(Schema.Literals(['personal','group']))`.
- `ToolVersion.toolName` (non-string failed the row, absent ok):
  `Schema.optional(Schema.String)` — a `null` value fails, as before.
- `ToolDetail`/`ToolVersionDetail.source` (missing/non-string failed the
  row): required `Schema.String` on the extended struct.
- `ToolRun.trigger`/`status` (unknown value failed the row): strict
  `Schema.Literals`; `errorKind`/`outputText` are required
  `Schema.NullOr(Schema.String)` (undefined fails, as before).
- `ToolRunResult` (unknown `ok` failed; `output.data` passed through when
  present): `Schema.Union([ok-true struct, ok-false struct])` with
  `Schema.Literal(true/false)` discriminants and
  `data: Schema.optional(Schema.Unknown)`.
- `Routine.aiId`/`toolId` (absent ok, `null` failed):
  `Schema.optional(Schema.String)`; `groupId`/`topicId` (absent or `null`
  ok): `Schema.optional(Schema.NullOr(Schema.String))`.
- `Routine.pausedReason`/`lastRunAt`/`lastStatus` (missing failed the row):
  required nullable schemas; `schedule` passes through as
  `Schema.Unknown`.
- Lists (one bad row failed the whole list): bare
  `Schema.mutable(Schema.Array(...))` decodes, same all-or-nothing.
- DELETEs (any 2xx body, incl. empty 204, accepted): shared `parseDelete`
  over `Schema.Unknown`, same as `ais-api.ts`.
- Error envelope: `errorFieldsOf` — a non-string `code` keeps the valid
  `message` (and vice versa); missing envelope keeps the fixed fallbacks.

Files changed:
- `apps/mobile/src/lib/tools-api.ts` (rewritten on the recipe; net -~90
  lines of guards gone; `createToolsApi` signature and all types unchanged).
- `apps/mobile/src/lib/tools-api.effect.test.ts` (new, 4 tests: network
  throw, non-JSON 500 body, malformed code with valid message, no-session
  401 + bad-row invalid_response).

Commands and real results:
- `pnpm install`: ok (1m).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/tools-api.test.ts`: 24 passed.
- Same for `src/lib/tools-api.effect.test.ts`: 4 passed.
- Same for `src/lib/routines-format.test.ts`,
  `src/components/ais/tool-actions.test.ts`,
  `src/components/ais/tool-detail-format.test.ts`: 36 passed (3 files).
- Same for `src/components/ais/routines-section.test.tsx`,
  `tools-section.test.tsx`, `tool-detail-sheet.test.tsx`: 64 passed.
- No existing test file was modified.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS tests @zilar/mobile`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.
  (Two intermediate gate runs failed first: prettier on my 2 files —
  fixed with the repo prettier binary on those files only; then oxlint
  unused `parseToolListItem`/`parseToolRun` — removed.)

Problems/deviations: one real deviation risk — the old `deleteRoutine` /
`deleteTool` bypassed `withToken`'s parse step (no validation at all); the
new code routes them through `withToken` with `parseDelete`, which accepts
every value, so behaviour is identical. Effect 4 note: `Schema.Union`
takes an array (`Schema.Union([A, B])`), not variadic args — the first
test run failed on this and I fixed it.

Security checklist: no secrets/tokens in errors or logs (typed errors
carry status/code/message only); no DB/authz surface (mobile client);
no new routes.

## Review (written by Claude)

Approved (lead, 2026-10-08). tools-api is on Effect Schema plus the T-0506 pipeline and the shared envelope, with the same exports and errors. It was the last hand-validated mobile API client. phone:smoke passed on / and /ais; the live test user has no AIs, so the tools screens are covered by the unchanged component tests. Nits accepted: an unreachable null branch in parseDelete, and the fetch signal now forwarded (as in the T-0506 recipe).
