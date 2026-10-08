---
id: T-0552
title: "Effect lane E, batch 8 (last): mobile tools-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged; no hand-validated mobile API client left"
status: todo
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

## Review (written by Claude)
