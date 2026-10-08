---
id: T-0595
title: "Tool args T-F: sandbox/types.ts (limits, tool output) and sandbox/run-tool.ts (worker result/event unions, output JSON) zod to Effect Schema; same accept/reject, same silent ignore of bad worker messages, same fixed invalid_output text; tests unchanged"
status: merged
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
`apps/server/src/sandbox/types.ts`, `apps/server/src/sandbox/run-tool.ts`, `apps/server/src/sandbox/limits.ts` and `apps/server/src/sandbox/tool-worker.ts` (both added by the lead on 2026-10-08 for the worker-safe limits split), `work/T-0595-sandbox-schemas-effect.md`.

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

### Summary

All five sandbox schemas are on Effect Schema and `sandbox/` has no `zod` left. Per the
lead's decision on the BLOCKED round, I took option 1: the values the worker thread needs
were split into a schema-free `sandbox/limits.ts`, so the worker no longer loads `types.ts`
(and therefore no longer loads Effect on every spawn). `pnpm gate` ends `GATE PASS` and the
sandbox/tools suite is green.

### Why the split (resolution of the blocked round)

`tool-worker.ts` imports `MAX_SOURCE_BYTES`, `resolveLimits`, `withFetchPrefix` and the
`SandboxLimits` type from `types.ts`. Converting `types.ts` to Effect made every worker
thread `require('effect')` under its `tsx/cjs` bootstrap (~0.7-2 s per spawn vs ~0.19 s for
zod). That erased the ~600 ms margin in `run-tool.test.ts` > "times out a tool that awaits
a fetch that never answers" (worker timer `fetchTimeoutMs + 1000` = 2000 ms vs parent
`wallMs + 500` = 3500 ms), turning `fetch_denied` into `timeout`.

The bisect that led to the fix (same machine/load, 3 runs each):

| types.ts | run-tool.ts | result |
| --- | --- | --- |
| Effect (mine) | Effect (mine) | failed |
| Effect (mine) | zod (original) | failed |
| zod (original) | Effect (mine) | passed |
| zod (original) | zod (original) | passed |

`tool-worker.ts` now imports from `./limits`, which has no schema import, so the worker is
back to a zod-sized startup. The `wallMs + 500` margin in `run-tool.ts` is unchanged, as
the lead required.

### What I did (one commit per item)

1. **`apps/server/src/sandbox/limits.ts` (new).** `MAX_SOURCE_BYTES`, `DEFAULT_LIMITS`,
   `HARD_MAX_LIMITS`, `SandboxLimits`, `resolveLimits`, `FETCH_DENIED_PREFIX`,
   `withFetchPrefix`. It imports no schema library. `resolveLimits` keeps exact behaviour
   with plain checks: every field must be `Number.isInteger` and `> 0`, except `maxFetches`
   (`>= 0`); any failure falls back to `{ ...DEFAULT_LIMITS }`; then the same
   `HARD_MAX_LIMITS` clamp and the `wallMs >= cpuMs` fix. It also drops unknown keys the way
   the old `z.object` decode did (only the nine limit keys are copied).
2. **`apps/server/src/sandbox/types.ts`.** Re-exports the names above from `./limits` so
   every other importer is unchanged, and keeps the Effect `toolOutputSchema` +
   `parseToolOutput` (and the rest of the file).
3. **`apps/server/src/sandbox/tool-worker.ts`.** Imports `MAX_SOURCE_BYTES`, `resolveLimits`,
   `withFetchPrefix` and `type SandboxLimits` from `./limits`. Nothing else changed.
4. **`run-tool.ts`.** Unchanged in this round; the timing margin is untouched.

The Effect conversion itself (types.ts `toolOutputSchema`/`parseToolOutput`; run-tool.ts
`workerResultSchema`/`WorkerResultMessage`, `workerEventSchema`, `outputJsonSchema`,
`onMessage`):
- `toolOutputSchema` -> `Schema.Struct({ text: Schema.String, data:
  Schema.optional(Schema.Unknown) })`.
- `parseToolOutput` -> `Schema.decodeUnknownOption`; `null` on failure, `{ text }` when
  `data === undefined`, otherwise `{ text, data }`.
- `workerResultSchema` -> `Schema.Union` of the result and error structs
  (`Schema.Literal`, `Schema.Literals([...7 kinds])`, `Schema.Finite` for `durationMs`,
  non-negative int for `fetchCount`).
- `WorkerResultMessage` -> `Schema.Schema.Type<typeof workerResultSchema>`.
- `workerEventSchema` -> `Schema.Union([workerResultSchema, log, fetch])` with
  `Schema.Record(Schema.String, Schema.String)` for `headers`.
- `outputJsonSchema` -> `Schema.Struct({ text, data: optional(Unknown) })`.
- `onMessage` -> `Schema.decodeUnknownOption`; a failed decode still silently returns.
- The fixed text `'tool must return a string or { text, data }'` is byte-identical at all
  four call sites. No `onExcessProperty` was added; no `any`.

### Commands run (real results)

- The previously failing timeout test, 3x in isolation (load ~32):
  `run-tool.test.ts > runTool limits > times out a tool that awaits a fetch that never
  answers` — **passed 3/3**, 2479 ms / 2145 ms / 2261 ms (each vs the 3500 ms parent limit).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot sandbox tools`
  (the task's check): `Test Files 15 passed (15)`, `Tests 319 passed (319)`, 128.90 s.
- `pnpm gate` from the repo root:
  - `PASS install (frozen) (4.8s)`, `PASS format (62.2s)`, `PASS lint (1.3s)`,
    `PASS typecheck (23.3s)`, `PASS tests @zilar/server (22.3s)`,
    `scope: every changed file is inside the Allowed files`, **`GATE PASS`**.

### Notes

- Changed files: `apps/server/src/sandbox/limits.ts` (new),
  `apps/server/src/sandbox/types.ts`, `apps/server/src/sandbox/tool-worker.ts`, and this
  task file; `run-tool.ts` was already converted in the first commit. All inside Allowed.
- No secrets, routes, deletes, caps or audit paths are involved; the security checklist has
  nothing new to enforce.
- Tests are unchanged.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:43) is newer than HEAD 91030ba0.
- **No test file changed.**
- **Lead check:**
  - the new `sandbox/limits.ts` imports nothing; it holds `resolveLimits`, a plain check with the same fallback and clamp;
  - `tool-worker.ts` imports from `./limits`, so worker threads no longer load Effect;
  - the timeout test that failed passed 3 times out of 3 (about 2.1 to 2.5 s against the 3.5 s limit);
  - there is no zod left in `sandbox/`.
