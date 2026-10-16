---
id: T-1637
title: "Size split: sandbox/run-tool.ts is at 398 lines — move the worker message schemas and sanitizeMessage into sandbox/run-tool-schemas.ts, no behaviour change"
status: merged
milestone: M5
branch: task/T-1637-split-run-tool
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1637: Split sandbox/run-tool.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/sandbox/run-tool.ts` is at 398 lines, against a limit of 400. Scheduled AI jobs (the T-1614 plan) run tools through it.

### Facts (the lead read them on 2026-10-16)
- **The schema and helper block:**
  - `nonNegativeInt` (`:35`), `workerResultSchema` (`:39`), `workerEventSchema` (`:65`) and `outputJsonSchema` (`:78`), all Effect `Schema`;
  - `class SandboxStartFailed` (about `:86`);
  - `function sanitizeMessage` (`:88-98`).
- **`export async function runTool(params)`** (`:105`) and `WORKER_HEAP_HEADROOM_BYTES` (about `:103`) stay.
- **`export interface RunToolParams`** (`:26`) stays.
- **The folder `apps/server/src/sandbox/`** has no `run-tool-schemas.ts` yet.
- **Test:** `apps/server/src/sandbox/run-tool.test.ts`.

### Steps
1. **Move `nonNegativeInt`, `workerResultSchema`, `workerEventSchema`, `outputJsonSchema` and `sanitizeMessage`** (with their comments) into a new file `apps/server/src/sandbox/run-tool-schemas.ts`. Export them from there, and import them in `run-tool.ts`.
   - Keep `SandboxStartFailed` where it is unless it's only used by moved code.
2. **No behaviour change.**
3. **Say in the Report** what moved and the new line counts.

### Allowed files
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/sandbox/run-tool-schemas.ts`
- `work/T-1637-split-run-tool.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/sandbox/run-tool.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`run-tool.ts` is under 340 lines.**
- **`run-tool.test.ts` passes unchanged.**

---

## Report (written by the worker when done)

### What I did

Moved the worker message schemas and the message sanitizer out of `apps/server/src/sandbox/run-tool.ts` into a new `apps/server/src/sandbox/run-tool-schemas.ts`, with no behaviour change:

- `nonNegativeInt`, `workerResultSchema`, `workerEventSchema`, `outputJsonSchema` and `sanitizeMessage` now live in `run-tool-schemas.ts` and are exported from there; `run-tool.ts` imports them.
- `runTool`, `RunToolParams`, `WORKER_HEAP_HEADROOM_BYTES` and `SandboxStartFailed` stayed in `run-tool.ts` (`SandboxStartFailed` is still used by `runTool`, so per the spec it stays).

Line counts: `run-tool.ts` **398 → 339** (acceptance: under 340); `run-tool-schemas.ts` is **58** lines.

Deviations from the spec, both type/formatting only, no behaviour change:
- The spec named five things to move, not the derived `type WorkerResultMessage = Schema.Schema.Type<typeof workerResultSchema>`. Moving that name out would have meant either a longer wrapped import or keeping a one-off alias, so I dropped the alias and let the single use site infer it (`const message = event;` — `event` is already narrowed to the result/error union at that point). No runtime change.
- Removed one blank line (between the `SandboxStartFailed` class and the `WORKER_HEAP_HEADROOM_BYTES` comment) to land `run-tool.ts` under the 340-line acceptance target; the schema move plus the new import alone left it at 340.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts` → **48 passed** (1 file), using the task's test path with the AGENTS.md worker cap/reporter.
- `pnpm gate` (from the repo root) → ended with:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.9s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.4s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/server  (49.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 3 changed files are `apps/server/src/sandbox/run-tool.ts`, `apps/server/src/sandbox/run-tool-schemas.ts` and this task file — all in the Allowed files.

### Notes for the lead

- `run-tool.test.ts` was not modified and passes unchanged.
- Open question: if you'd rather keep the explicit `WorkerResultMessage` alias, say so and I'll restore it; with it the file is 340 lines (the blank line I removed would come back as an import or a blank), just over the stated "under 340".

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The split:** `run-tool.ts` went from 398 to 339 lines, and the new `run-tool-schemas.ts` is 58.
- **The tests:** the lead ran `run-tool.test.ts`: 48 passed.
- **The worker's question:** no need to restore the `WorkerResultMessage` alias.

