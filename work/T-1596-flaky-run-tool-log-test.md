---
id: T-1596
title: "Flaky sandbox test: 'truncates 100 KB of console.log output' fails ~1 in 20 CI runs with result.ok false (run-tool.test.ts:254); find why the run fails under load and fix the cause, not the test"
status: merged
milestone: M5
branch: task/T-1596-flaky-run-tool-log-test
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1596: Fix the flaky sandbox log-truncation test

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/sandbox/run-tool.test.ts` › "runTool limits" › "truncates 100 KB of console.log output" fails on main's CI now and then, always at `run-tool.test.ts:254:23` (`expect(result.ok).toBe(true)`, "expected false to be true"). So the sandbox run itself fails, not the truncation check.
- **The runs seen:**
  - 38789634445 (`38c7c5695`, T-1595, which only changed a workflow file);
  - 38754273319 (`6c9c77a70`, T-1572);
  - 38734680918 (`49918a5f1`, T-1541).
- **How often:** 3 of the last ~60 CI runs, in shard `server 1/3`.
- The sandbox runs AI-written tools, so a run that fails under load is a real bug, not only a test problem.

### Facts (the lead read them on 2026-10-15, main `38c7c5695`)
- **The test** (`run-tool.test.ts:243-257`): 2000 `console.log` lines of ~60 bytes each, `limits: { cpuMs: 20000, wallMs: 20000 }`, `timeout: 30000`. It expects `ok` (`:254`), logs ≤ 4 KiB + 64 (`:255`), and logs ending in `…` (`:256`).
- **`apps/server/src/sandbox/tool-worker-vm.ts:38`** posts **one `postMessage({ type: 'log', text })` per console line.**
- **`apps/server/src/sandbox/run-tool.ts`:**
  - `:151-156`: the worker's `resourceLimits` (`maxOldGenerationSizeMb` from `memoryBytes`, `stackSizeMb: 8`);
  - `:176-187`: `pushLog` caps the logs at `limits.maxLogBytes`;
  - `:349-351`: `onError` gives `sandbox_failure` "tool sandbox failed";
  - `:352-356`: `onExit` gives `runtime` or `sandbox_failure` "tool sandbox stopped";
  - `:366-370`: the wall timeout is `wallMs + 500`, giving `timeout`;
  - in tests, the worker is started through the `tsx/cjs` hook (`:166-173`).
- **`apps/server/src/sandbox/limits.ts`:** `DEFAULT_LIMITS.memoryBytes` 32 MiB, `maxLogBytes` 4 KiB.
- **The test's failure message hides `result.error`,** so the failing kind is unknown today.
- **`run-tool.ts` is 393 lines;** the limit is 400.

### Steps
1. **Make the failure readable:**
   - at `:254`, assert `expect(result).toMatchObject({ ok: true })`, so a failure prints `error.kind` and `error.message`;
   - do the same for any other `expect(result.ok).toBe(true)` in this file.
2. **Reproduce:**
   - run the one test many times under load (for example 50 runs in a shell loop, or with vitest's `repeats` option in a local scratch copy you don't commit), while other CPU load runs (another `vitest` run or `yes > /dev/null` on a few cores);
   - **record the failing `error.kind` and how often it fails.**
3. **Fix the cause in the sandbox code,** not by loosening the test's expectations. Keep the security limits (`DEFAULT_LIMITS`, `HARD_MAX_LIMITS`) unchanged. Likely places, to check first, not to assume:
   - the worker's memory limit being hit while 2000 log messages queue;
   - the worker being started through `tsx` in tests;
   - a race between `exit` and the last `message`.
   - **One idea for the first:** stop posting log lines from the worker once the cap is reached (the worker knows `maxLogBytes`), sending only a "truncated" flag. **Only if your measurements show that's the cause.**
4. **Keep `run-tool.ts` at 400 lines or fewer.** If the fix needs room, move a helper into a new file in `apps/server/src/sandbox/`.

### Tests
The existing `run-tool.test.ts` only. Add at most one test, and only if the fix adds a new path (e.g. the worker-side log cap).

### Allowed files
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/sandbox/tool-worker.ts`
- `apps/server/src/sandbox/tool-worker-vm.ts`
- `apps/server/src/sandbox/run-tool.test.ts`
- `apps/server/src/sandbox/run-tool-logs.ts` (new, only if needed)
- `work/T-1596-flaky-run-tool-log-test.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/sandbox/run-tool.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the failing `error.kind` you reproduced, with how often it failed before the fix;
  - the cause, with `file:line`;
  - the fix;
  - the same loop under load after the fix: 50 of 50 green.
- `DEFAULT_LIMITS` and `HARD_MAX_LIMITS` are unchanged.

---

## Report (written by the worker when done)

### What I did

**1. Made the failure readable (`run-tool.test.ts`).** Every `expect(<x>.ok).toBe(true)` (20 sites) now goes through a small helper `expectOk` that asserts `toMatchObject` with the spec's `{ ok: true }`, and folds `error: undefined` into the expected object when the run failed.

> **Deviation from the spec, deliberate:** the spec's `expect(result).toMatchObject({ ok: true })` does **not** print `error.kind`/`error.message` in vitest 5.0.2 — vitest prints only the keys it diffed, so a real failure shows `expected { ok: false, error: { …(2) }, …(3) } to match object { ok: true }` with the nested `error` hidden. I verified this with a forced failure under both the default and `dot` reporters. Adding `error: undefined` to the expected object makes the diff expand the received error (verified: it printed `"kind": "sandbox_failure", "message": "tool sandbox failed"`). The helper keeps the spec's assertion shape at every call site. If you prefer the literal inline form, say so and I'll revert.

**2. Reproduced the failure kind.** I could not reproduce the natural CI flake locally: under load I ran the truncation test 150× at `-P 12`, 50× at `-P 4`, 48× at `-P 16`, and the whole `run-tool.test.ts` file 12× at `-P 6` — **0 failures** (macOS, this machine). So I reproduced the *mechanism* instead, by forcing the worker heap cap in `run-tool.ts` to 24 MiB: the test failed at `run-tool.test.ts:254` with

```
T1596ERR {"kind":"sandbox_failure","message":"tool sandbox failed"}
```

**3. Found the cause by measuring the worker heap** (temporary `process.memoryUsage()` prints in `tool-worker.ts`, reverted). With the old 48 MiB cap:

- after tsx + QuickJS load, **before the tool runs**: `heapUsed` **43 MiB**;
- during the 2000 `console.log` lines: `heapUsed` 44–46 MiB, `heapTotal` 48–50 MiB;
- at the end: `heapUsed` 44 MiB.

So the renderer/harness alone sits ~3–5 MiB under the V8 limit, and V8's GC lag under load pushes it over. The 2000 log lines add about **1 MiB** — they are *not* the cause, so I did **not** implement the worker-side log cap the spec suggested.

**4. Fixed the cause in the sandbox code (`run-tool.ts`).** The worker's `resourceLimits.maxOldGenerationSizeMb` is a V8 heap ceiling for the *harness* (Effect, the QuickJS emscripten glue, and the tsx loader in tests); it never bounds the tool's own memory, which lives in the wasm heap and is capped separately by `runtime.setMemoryLimit(limits.memoryBytes)`. The old `memoryBytes + 16 MiB` headroom was too small for a ~45 MiB harness. I added a documented `WORKER_HEAP_HEADROOM_BYTES = 96 MiB` and the cap is now `ceil((memoryBytes + 96 MiB) / 1 MiB)` (128 MiB at the defaults). Measured at the new cap: end-of-run `heapUsed` 51–52 MiB, `heapTotal` ~109 MiB — ~76 MiB of slack. This is a ceiling, not a reservation, so ordinary runs are unaffected. I dropped the old `Math.max(32, …)` floor, which is now dead (the cap can never fall below 97 MiB).

`DEFAULT_LIMITS` and `HARD_MAX_LIMITS` in `limits.ts` are **unchanged**, and nothing here weakens the tool's own memory cap.

### Files changed

- `apps/server/src/sandbox/run-tool.ts` — worker heap headroom (398 lines, under the 400 limit).
- `apps/server/src/sandbox/run-tool.test.ts` — `expectOk` helper + 20 call sites.
- `work/T-1596-flaky-run-tool-log-test.md` — this report.
- `apps/server/src/sandbox/tool-worker.ts` — instrumentation added and reverted; `git diff` shows no change.

### Checks run

- `pnpm install` — Done in 11.5s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts` — **1 file passed, 48 tests passed (26.29s)**.
- Under load, **after the fix**: 50 runs at `-P 8` → **PASS 50, FLAKE 0** (acceptance's 50 of 50).
- `pnpm gate` (from the repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (26.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **The failing `error.kind`:** `sandbox_failure` (`"tool sandbox failed"`), i.e. the worker was aborted by V8 and the parent's `onError` handler fired (`run-tool.ts:349-351`). I confirmed this kind by forcing the cap; I could **not** catch the natural flake locally, so I am reporting the mechanism, not a lucky reproduction. Frequency before the fix on this machine: 0 of ~260 loaded runs; CI reports ~3 of 60.
- **Cause, with `file:line`:** `apps/server/src/sandbox/run-tool.ts` version before this change, lines 151-156 — `maxOldGenerationSizeMb: Math.max(32, ceil((memoryBytes + 16 MiB)/1 MiB))` = 48 MiB, while the harness alone uses ~45 MiB (measured). The abort surfaces as `sandbox_failure` via `run-tool.ts:352-356`/`349-351`.
- **Why T-1487 did not fix it:** that task widened `wallMs`/`cpuMs`, but the failure is not the wall or CPU clock — it is the V8 heap ceiling, so widening the time budgets could not help.
- **Production may share the bug:** the bundled worker (`tool-worker.mjs`) still loads the Effect runtime and the QuickJS glue, so its harness heap is likely in the same range; the larger headroom helps it too.
- **Not implemented:** the spec's worker-side log cap. Measurements show the log queue adds ~1 MiB, so it is not the cause.
- **Security:** `DEFAULT_LIMITS`/`HARD_MAX_LIMITS` are untouched; the tool's memory is still bounded by `runtime.setMemoryLimit(limits.memoryBytes)` inside the worker. Raising the V8 ceiling only gives the trusted harness and the log queue more room before V8 aborts.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The cause is measured:** the worker's V8 old-generation ceiling was 48 MiB with the default limits, while the harness alone (Effect, the QuickJS glue, the tsx loader in tests) sits at about 43–45 MiB. Under CI load, GC lag tipped it over and the parent saw `sandbox_failure`.
- **The fix** is one constant: `WORKER_HEAP_HEADROOM_BYTES` = 96 MiB, so the default ceiling is 128 MiB. `run-tool.ts` is 398 lines.
- **The tool's own memory stays capped** inside QuickJS (`tool-worker.ts:70`, `runtime.setMemoryLimit(limits.memoryBytes)`). `DEFAULT_LIMITS` and `HARD_MAX_LIMITS` are unchanged.
- **Accepted deviation:** an `expectOk` helper instead of a bare `toMatchObject`, because vitest 5 did not print `error.kind` otherwise. Failures now name the error.
- **Evidence:** 50 of 50 green under load after the fix; the gate passed.
- **For later:** each concurrent tool run may now use up to 128 MiB of harness heap. That's fine while tools are off by default; watch it once routines run at scale on the VPS.

