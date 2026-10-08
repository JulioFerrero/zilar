---
id: T-0595
title: "Tool args T-F: sandbox/types.ts (limits, tool output) and sandbox/run-tool.ts (worker result/event unions, output JSON) zod to Effect Schema; same accept/reject, same silent ignore of bad worker messages, same fixed invalid_output text; tests unchanged"
status: todo
milestone: M5
branch: task/T-0595-sandbox-schemas-effect
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0595: the sandbox schemas on Effect Schema (plan task T-F)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md`, §1.8, §1.9 and §4 T-F. These two files are independent of the tool registry.

### Verified facts (do not re-derive)
- **`apps/server/src/sandbox/types.ts`** (zod import at line 1):
  - **`limitsSchema` (41-51)** has nine fields, each `z.number().int()`. Each one is `.positive()`, except `maxFetches`, which is `.min(0)`. It is used in `resolveLimits` (55): a decode failure falls back to `{ ...DEFAULT_LIMITS }`.
  - **`toolOutputSchema` (110-113):** `{ text: string, data?: unknown }`. It is used in `parseToolOutput` (116): a failure gives `null`, and `data` appears in the result only when it is not `undefined`.
- **`apps/server/src/sandbox/run-tool.ts`** (zod import at line 5):
  - **`workerResultSchema` (36-58)**, a union of:
    - `{ type: 'result', outputJson: string, fetchCount: int ≥ 0, durationMs: number }`;
    - `{ type: 'error', kind: one of the 7 literals, message: string, fetchCount: int ≥ 0, durationMs: number }`.
  - `type WorkerResultMessage = z.infer<...>` (60).
  - **`workerEventSchema` (62-73)**, a union of: the result union, `{ type: 'log', text }`, and `{ type: 'fetch', id: int ≥ 0, url, method, headers: Record<string,string>, bodyPresent: boolean }`.
  - **`outputJsonSchema` (75-78):** `{ text: string, data?: unknown }`.
  - **The uses:**
    - `onMessage` (202): a decode failure **silently returns** (it ignores the message);
    - (304): a failure gives `fail('invalid_output', 'tool must return a string or { text, data }', ...)`. That text is fixed and stays byte-identical.
- **Zod parity rules:**
  - these zod objects are **not** strict, so extra keys are stripped; Effect's default (excess keys ignored) matches. Do **not** add `onExcessProperty: 'error'`;
  - `z.number()` rejects `NaN` and `Infinity`, but Effect's `Schema.Number` accepts `NaN`. Use `Schema.Finite`, plus `isInt` and the `>0` or `≥0` checks where zod had them (`docs/EFFECT_GUIDE.md`, "Effect 4 facts");
  - `durationMs` is `z.number()`, so it is `Schema.Finite` with no int check.
- **Decode helpers:** use `Schema.decodeUnknownOption`, `decodeUnknownExit` or a similar sync decode; no messages are needed.
- **Tests (all unchanged):**
  - `apps/server/src/sandbox/*.test.ts`;
  - `apps/server/src/tools/*.test.ts` (they run tools through the sandbox).

### What to build
1. Convert the five schemas and their uses in both files, with the same results.
2. `WorkerResultMessage` comes from the Effect schema (`Schema.Schema.Type<typeof ...>` or `typeof X.Type`).
3. Both files end with no `zod` import.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts"), `docs/audit/tool-args-schema-plan.md` (§1.8, §1.9 and §4 T-F), `apps/server/src/sandbox/types.ts` and `apps/server/src/sandbox/run-tool.ts`.

### Allowed files
`apps/server/src/sandbox/types.ts`, `apps/server/src/sandbox/run-tool.ts`, `work/T-0595-sandbox-schemas-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot sandbox tools
pnpm gate
```

### Acceptance
- There is no zod in `sandbox/`, and limits, tool output and worker messages decode the same way.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
