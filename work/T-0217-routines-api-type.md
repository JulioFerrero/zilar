---
id: T-0217
title: "Mobile: RoutinesSection takes AiToolsApi (no cast) and ignores a second tap while an action runs"
status: merged
milestone: M5
branch: task/T-0217-routines-api-type
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0212]
estimate: 0.1 day
---

# T-0217: RoutinesSection API type and tap guard

## Spec (written by Claude, do not edit)

### Why
Follow-up F1 and nit F2 of T-0212's pre-review. `RoutinesSection` declares the read-only `ToolsApi` and casts it to `AiToolsApi` to run pause, resume and delete; a caller passing a real read-only `ToolsApi` would crash on the first tap. And two taps before React re-renders can send the same action twice (a double delete shows a wrong "You may not change this routine.").

### Verified facts (do not re-derive)
- `apps/mobile/src/lib/tools-api.ts`: `ToolsApi` (line 55), `RoutineActionsApi` (line 64), `export type AiToolsApi = ToolsApi & RoutineActionsApi` (line 71); `createToolsApi` (line 246) already returns `AiToolsApi` (line 250).
- `apps/mobile/src/mock/tools.ts` line 105: `createMockToolsApi(): AiToolsApi`.
- `apps/mobile/src/components/ais/use-tools-api.ts`: imports `type ToolsApi` (line 4); `ToolsApiHandle.api: ToolsApi` (line 32).
- `apps/mobile/src/components/ais/routines-section.tsx`: import line 13; `RoutinesSection({ api, aiId }: { api: ToolsApi; aiId: string })` (line 257); `run` (lines 292-309) with the comment (lines 296-297) and `api as AiToolsApi` (line 299). `loadAiRoutines(api: ToolsApi, ...)` (line 64) stays as is.
- `apps/mobile/src/app/ais/[id].tsx` passes the hook's `api` to both `ToolsSection` (takes `ToolsApi`) and `RoutinesSection`; `AiToolsApi` satisfies both. The Save button guards double taps with `savingRef` (lines 78, 177, 209).

### What to build
1. `use-tools-api.ts`: `ToolsApiHandle.api` becomes `AiToolsApi` (import it instead of `ToolsApi`). Nothing else.
2. `routines-section.tsx`: the `RoutinesSection` prop becomes `api: AiToolsApi`; remove the cast and its two-line comment in `run`; drop `ToolsApi` from the import only if nothing else in the file uses it (`loadAiRoutines` does, so it likely stays).
3. In `run`, a `runningRef = useRef(false)`: return at once when it is true; set it true before the async body and false where `setBusyId(null)` runs (also when `applyRoutineAction` throws: use `try/finally`).
4. Test in `apps/mobile/src/components/ais/routines-section.test.tsx`: only if the file already has a way to call `run` twice (read it first); otherwise none: the typecheck is the test for items 1-2.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ais/use-tools-api.ts`, `apps/mobile/src/components/ais/routines-section.tsx` (lines 1-20 and 250-320), `apps/mobile/src/lib/tools-api.ts` (lines 50-75).

### Allowed files
`apps/mobile/src/components/ais/use-tools-api.ts`, `apps/mobile/src/components/ais/routines-section.tsx`, `apps/mobile/src/components/ais/routines-section.test.tsx`, `work/T-0217-routines-api-type.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot routines-section
pnpm gate
```

### Acceptance
- No `as AiToolsApi` left in `routines-section.tsx`; the hook and the section declare `AiToolsApi`.
- A second tap while an action runs does nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Any visible change, the tools section, the API.

---

## Report (written by the worker when done)

### What I did
1. `apps/mobile/src/components/ais/use-tools-api.ts`: changed the import of `ToolsApi` to `AiToolsApi` and changed `ToolsApiHandle.api` to `AiToolsApi`. Nothing else in the file.
2. `apps/mobile/src/components/ais/routines-section.tsx`:
   - Changed `RoutinesSection({ api, aiId }: { api: ToolsApi; aiId: string })` to use `AiToolsApi`.
   - Removed `api as AiToolsApi` and the 2-line comment in `run`.
   - Added `runningRef = useRef(false)`: `run` returns at once when it's true; sets it true before the async body and clears it (with `setBusyId(null)`) inside a `try/finally` so a throw from `applyRoutineAction` still resets state. `ToolsApi` import stays because `loadAiRoutines` still uses it.
3. `apps/mobile/src/components/ais/routines-section.test.tsx`: not touched. The file has no way to call `run` twice (it only exercises `RoutinesSectionContent` and the pure helpers). Per the spec: "otherwise none: the typecheck is the test for items 1-2".

### Files changed
- `apps/mobile/src/components/ais/routines-section.tsx`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `work/T-0217-routines-api-type.md` (status and report only)

### Commands and real results
- `pnpm install`: succeeded, 1053 packages added.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot routines-section`: 1 test file passed, 26 tests passed (stderr noise from React DOM warnings is expected for these tests).
- `pnpm gate`:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (11.0s)`
  - `PASS  lint  (0.7s)`
  - `PASS  typecheck  (5.6s)`
  - `PASS  tests @zilar/mobile  (1.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Acceptance
- No `as AiToolsApi` left in `routines-section.tsx` (verified with grep).
- Hook and section both declare `AiToolsApi`.
- Second tap while an action runs returns immediately via the early `if (runningRef.current) return;`.
- Gate passes and lists only files inside Allowed files.

### Deviations / notes
- The two-line comment about "useToolsApi still declares the read-only ToolsApi" was removed along with the cast.
- I did not add a unit test for the new `runningRef` guard. The spec's wording ("only if the file already has a way to call `run` twice (read it first); otherwise none") points to skipping it; `run` is internal and not exposed, and the existing tests don't render `RoutinesSection` against a controllable API with a hook to trigger `run` synchronously.

## Review (written by Claude)

**Verdict:** Approved, clean pre-review (MiniMax, first round). The hook and `RoutinesSection` declare `AiToolsApi`, the cast is gone, and `run` ignores a second tap through `runningRef`, reset in a `finally` with `setBusyId(null)`. Read the whole diff (2 code files). No test for the guard, as the spec allowed. Emulator smoke PASS on home; no visible change.
