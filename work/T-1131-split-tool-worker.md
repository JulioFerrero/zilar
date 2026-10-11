---
id: T-1131
title: "Size split: apps/server/src/sandbox/tool-worker.ts (616) — one failRun() replaces the repeated error finish literals, and the fetch bridge and VM helpers move to sandbox/tool-worker-*.ts; sandbox tests unedited"
status: merged
milestone: M5
branch: task/T-1131-split-tool-worker
model: auto
effort: default
depends_on: [T-1128]
estimate: 0.3 day
---

# T-1131: Split the sandbox tool worker

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, chose "finish the leftovers". `apps/server/src/sandbox/tool-worker.ts` has 616 lines; the plan is `docs/audit/size-plan.md` #49. This is the QuickJS sandbox that runs AI-built tools (`docs/TOOL_SANDBOX.md`), so the limits and the fetch guard must stay exactly as they are. The tests are `apps/server/src/sandbox/run-tool.test.ts`, `host-fetch.test.ts` and `ip-guard.test.ts`.

**What the lead read:**
- **Before `run`:** `WorkerParams` (`:11`), `WorkerFetchPayload` (`:18`), `WorkerErrorKind` (`:26`), `dumpVmError` (`:35`), `logToParent` (`:53`), `Deferred` (`:57`), `waitForFetchResponse` (`:61`) and `disposeQuietly` (`:113`).
- **`const run = Effect.gen(…)`** (`:116`) is one large generator.
  - `finish(message)` is defined at `:121-133`.
  - There are **16** `finish({ … durationMs: Date.now() - startedAt })` calls, at `:136`, `:396`, `:400`, `:409`, `:422`, `:436`, `:454`, `:457`, `:486`, `:496`, `:514`, `:518`, `:527`, `:560`, `:570` and `:579`. Most are `{ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt }`.

### What to build
1. **Inside `run`,** add `failRun(kind, message)`, which calls `finish({ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt })`, and replace every call that has **exactly** that shape.
   - Keep the calls with a different shape as they are: the `...interrupted` spreads (`:396`, `:454`, `:514`), the `:136` one (`fetchCount: 0, durationMs: 0`), and the result at `:579`.
   - `fetchCount` must be read at call time, as today; it is a `let` that changes.
2. **Move helpers out of `run`** into new files, **byte-for-byte**, taking as parameters the values they used from the closure:
   - `apps/server/src/sandbox/tool-worker-fetch.ts`: the types and `waitForFetchResponse`, plus the host-fetch bridge code inside `run` if it can move with only parameter passing;
   - `apps/server/src/sandbox/tool-worker-vm.ts`: `dumpVmError`, `logToParent`, `disposeQuietly` and the VM setup helpers, if they can move with only parameter passing.

   **Whatever needs more than parameter passing stays in `tool-worker.ts`. Do not restructure the generator's control flow.**
3. **No behaviour change:** the same limits (`limits.ts`), the same error kinds and messages, the same order of checks, and the same messages posted to the parent.
4. **Tests** (the sandbox runs AI-built code): run `run-tool.test.ts`, `host-fetch.test.ts` and `ip-guard.test.ts`. **Do not edit them.** Paste the results.
5. **Line counts:** every file stays at most 400 lines. If `tool-worker.ts` cannot get under 400 without restructuring the generator, stop at the smallest safe size and say so in the Report. **Do not force it.**

### Read first
`AGENTS.md`, `docs/TOOL_SANDBOX.md`, `apps/server/src/sandbox/tool-worker.ts`, `apps/server/src/sandbox/run-tool.ts` and `apps/server/src/sandbox/limits.ts`.

### Allowed files
`apps/server/src/sandbox/tool-worker.ts`, `apps/server/src/sandbox/tool-worker-fetch.ts`, `apps/server/src/sandbox/tool-worker-vm.ts`, `work/T-1131-split-tool-worker.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/sandbox/run-tool.test.ts src/sandbox/host-fetch.test.ts src/sandbox/ip-guard.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with no test file edited.
- The Report lists every `finish` call before and after.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/sandbox/tool-worker.ts` (616 → 275 lines) with no behaviour change.

- **`failRun(kind, message)`** added inside `run`, defined right after `let fetchCount = 0`. It calls `finish({ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt })`, so `fetchCount` is still read at call time.
- **New `tool-worker-vm.ts` (150 lines):** `WorkerErrorKind`, `dumpVmError`, `logToParent`, `nextImmediate`, `disposeQuietly`, `interruptedResult`, plus the CPU tracker (`createCpuTracker`) and the VM entry points (`createVmTools` → `pumpJobs`, `evalInVm`, `callInVm`, `track`/`handles`, `settleVm`, `rejectWith`). They take the runtime/context/CPU state as parameters; the bodies are the original code. Call sites in `run` keep the same names.
- **New `tool-worker-fetch.ts` (205 lines):** `WorkerFetchPayload`, `waitForFetchResponse` (moved byte-for-byte) and `createFetchBridge`, the old `fetchEffect`/`fetchImpl` moved verbatim except `fetchCount` now goes through `readFetchCount()`/`addFetch()` callbacks.
- `tool-worker.ts` keeps `WorkerParams`, `finish`, `failRun`, the `run` generator control flow and `disposeVm`. Files: `tool-worker.ts` 275, `tool-worker-fetch.ts` 205, `tool-worker-vm.ts` 150 — all under 400.

### Every `finish` call, before → after

Before (`git show main:…tool-worker.ts`), 16 `finish({…})` calls, all with `durationMs: Date.now() - startedAt` except the first:

| Before | Shape | After |
|---|---|---|
| :136 | `invalid_output`, `'tool source is too large'`, `fetchCount: 0, durationMs: 0` | kept, `tool-worker.ts:48` (different shape) |
| :396 | `{ ...interrupted, fetchCount, durationMs }` | kept, `:127` |
| :400 | `runtime`, `'imports are not allowed'` | `failRun('runtime', 'imports are not allowed')` `:131` |
| :409 | `syntax`, `dumped.message.slice(0, 300)` | `failRun('syntax', …)` `:134` |
| :422 | `invalid_output`, `'tool must default-export a function'` | `failRun('invalid_output', …)` `:141` |
| :436 | `runtime`, `dumped.message.slice(0, 300)` | `failRun('runtime', …)` `:149` |
| :454 | `{ ...interrupted, fetchCount, durationMs }` | kept, `:161` |
| :457 | `runtime`, `${dumped.name}: ${dumped.message}`.slice(0,300)` | `failRun('runtime', …)` `:164` |
| :486 | same runtime message | `failRun('runtime', …)` `:187` |
| :496 | `timeout`, `'tool timed out'` | `failRun('timeout', 'tool timed out')` `:191` |
| :514 | `{ ...interrupted, fetchCount, durationMs }` | kept, `:203` |
| :518 | `fetch_denied`, `dumped.message.slice(0, 300)` | `failRun('fetch_denied', …)` `:207` |
| :527 | same runtime message | `failRun('runtime', …)` `:210` |
| :560 | `invalid_output`, `'tool must return a string or { text, data }'` | `failRun('invalid_output', …)` `:237` |
| :570 | `output_too_large`, `'tool output is too large'` | `failRun('output_too_large', …)` `:241` |
| :579 | `type: 'result'` | kept, `:244` |

After: 5 direct `finish` calls (`:48`, `:127`, `:161`, `:203`, `:244`) + the single literal inside `failRun` (`:64`), and 12 `failRun` call sites (the 11 above plus one extra, below).

**Deviation (one extra site):** the terminal `Effect.catchCause` handler previously did a raw `parentPort?.postMessage({ type: 'error', kind: 'runtime', message: 'tool failed', fetchCount, durationMs: Date.now() - startedAt })` — not a `finish` call, so it was not in the spec's list, but its payload had exactly the deduplicated shape. I replaced it with `failRun('runtime', 'tool failed')` (`:268`), identical behaviour (`finish` also posts to `parentPort`). It is outside the generator's control flow and does not change it.

### Commands and real results

- `pnpm install` — done, no errors (one pre-existing peer-dep warning in `apps/mobile`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts src/sandbox/host-fetch.test.ts src/sandbox/ip-guard.test.ts` — **3 files passed, 108 tests passed**. No test file edited.
- `pnpm gate` — first run `FAIL format` on `tool-worker-fetch.ts`; fixed with `pnpm exec prettier --write` on that one file, then:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (28.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 4 changed files are the three allowed sandbox files plus this task file.

### Notes / open questions

- No behaviour change intended: same limits, error kinds/messages, order of checks, messages to the parent, and CPU accounting (the tracker state moved into `createCpuTracker` unchanged).
- I did not edit the three test files.
- `tool-worker.ts` reached 275 lines, so I did not need to stop at "smallest safe size".

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (a stale line count in the Report).**
- **The split:** `sandbox/tool-worker.ts` goes from 616 to 275 lines. The fetch bridge moves to `tool-worker-fetch.ts` (214), and the VM helpers to `tool-worker-vm.ts` (150).
- **`failRun(kind, message)`** (`tool-worker.ts:63`) posts the same `{ type: 'error', kind, message, fetchCount, durationMs }` and reads `fetchCount` at call time. It replaces 12 identical literals; the `...interrupted`, early-exit and result calls keep their own shape.
- **The lead's string check:** every error kind (`syntax`, `runtime`, `fetch_denied`, `output_too_large`) and every message from main is still present in the new files.
- **Tests:** the lead ran `run-tool`, `host-fetch` and `ip-guard` on the branch: 108 green, with no test edited. The gate passed.
