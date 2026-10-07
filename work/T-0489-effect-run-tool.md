---
id: T-0489
title: "Effect convert: sandbox runTool (worker thread lifetime, kill timer, settle-once) in Effect with a scoped Worker, Promise API unchanged"
status: merged
milestone: M5
branch: task/T-0489-effect-run-tool
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.4 day
---

# T-0489: the sandbox tool runner in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md`. A worker thread with a kill timer and a "settle once" guard is the leaked-resource case Effect targets:
- the Promise API stays the same at the edge;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/sandbox/run-tool.ts` (343 lines). Exports: `RunToolParams` (line 26) and `runTool(params): Promise<RunToolResult>` (line 90).
- **`runTool`:**
  - it creates a `new Worker(bootstrap, …)` with a tsx hook (about lines 148-152);
  - it then returns a `new Promise` (from line 192) with a `settled` flag and `settle(result)`, which clears `killTimer`, terminates the worker and resolves;
  - `killTimer` = `setTimeout(limits.wallMs + 500)` gives `fail('timeout', 'tool timed out', fetchCount)` (lines 205-208);
  - **worker messages:**
    - `log` events are pushed;
    - `fetch` events run `validateFetchRequest` and the host fetch, then post `fetch-result` back;
    - result and failure messages call `settle(...)`;
  - `worker.on('error')` gives `fail('sandbox_failure', 'tool sandbox failed', fetchCount)`, and `worker.on('exit')` is also handled (around lines 332-340).
- **Importers:** `apps/server/src/index.ts`, `apps/server/src/routines/wiring.ts`, `apps/server/src/routines/execute.ts`, `apps/server/src/routines/scheduler.ts` (types). **Tests:** `apps/server/src/sandbox/run-tool.test.ts`, `apps/server/src/sandbox/host-fetch.test.ts`, `apps/server/src/sandbox/ip-guard.test.ts`.
- **The reference:** `apps/server/src/voice-transcription/pipeline.ts` and `docs/EFFECT_GUIDE.md`. The guide notes that `acquireRelease` needs a `Scope`; see `docs/effect-reference/` for `Effect.scoped` and `Effect.callback` / `Effect.async`.

### What to build
1. **The worker as a scoped resource:** `Effect.acquireRelease(create Worker, worker => terminate)` inside `Effect.scoped`. Termination is then guaranteed on every exit path, which replaces `settled` and the manual `terminate` in `settle`.
2. **The run as a callback effect:** turn the message, error and exit listeners into one `Effect.callback`-style effect that resumes once with the `RunToolResult`. Duplicate events after the first are ignored, as today.
3. **The wall-clock limit:** `Effect.timeoutOrElse(Duration.millis(limits.wallMs + 500))`, giving the same `fail('timeout', 'tool timed out', fetchCount)` result.
4. **Fetch handling:** keep the fetch handling per message exactly as today: validate, guard, post back. It may stay an async callback inside the listener.
5. **Exports:** `runTool` keeps its signature, and it **never rejects** where it does not today. Every result string is identical.
6. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/sandbox/run-tool.effect.test.ts`, for example: the worker is terminated after a timeout and after a normal result.
7. **Report:** give the line counts before and after, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` (scoped resources, callback effects, timeouts), `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/sandbox/run-tool.ts`, `apps/server/src/sandbox/run-tool.test.ts`.

### Allowed files
`apps/server/src/sandbox/run-tool.ts`, `apps/server/src/sandbox/run-tool.effect.test.ts`, `work/T-0489-effect-run-tool.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot sandbox
pnpm gate
```

### Acceptance
- `runTool` runs on Effect with a scoped worker that is always terminated.
- The API and results are identical.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the worker lifetime in `runTool` to Effect, with the `Promise` API and every result string unchanged.

- `apps/server/src/sandbox/run-tool.ts`:
  - The worker is now a scoped resource: `Effect.acquireRelease(Effect.try({ try: spawnWorker, catch: () => new SandboxStartFailed() }), worker => Effect.sync(() => void worker.terminate()...))` inside `Effect.scoped`. Termination is guaranteed on the result, the error/exit path and the timeout, and replaces the manual `settled` guard plus the `terminate` in `settle`.
  - The `message` / `error` / `exit` listeners now resume one `Effect.callback<RunToolResult>`; `resume` is once-only, so later events are ignored exactly like the old `settled` flag. The callback's cleanup effect removes the listeners on interruption.
  - The wall-clock limit is `Effect.timeoutOrElse({ duration: Duration.millis(limits.wallMs + 500), orElse: () => Effect.succeed(fail('timeout', 'tool timed out', fetchCount)) })`. `fetchCount` is the same mutable local read at timeout time, so the timeout result is identical.
  - Fetch message handling is byte-for-byte the old code: validate/guard via `validateFetchRequest`, call the host `fetcher`, post `fetch-result` back. It stays an async IIFE inside the listener (not modelled in Effect).
  - Worker-start failure keeps the old try/catch answer via a module-local `Data.TaggedError` (`SandboxStartFailed`) mapped at the boundary with `Effect.catchTag` to the same `sandbox_failure` / "could not start the tool sandbox" / `fetchCount: 0` result.
  - Added `apps/server/src/sandbox/run-tool.effect.test.ts`: spies on `Worker.prototype.terminate` and asserts the worker is terminated after a normal result and after a timeout. Existing tests untouched.

### Line counts
- `apps/server/src/sandbox/run-tool.ts`: 343 before → 379 after (+36; the extra lines are the effect comments, the callback wrapper/cleanup and the scoped program).
- `apps/server/src/sandbox/run-tool.effect.test.ts`: new, 45 lines.

### Commands run (real results)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot sandbox` → `Test Files 4 passed (4)`, `Tests 106 passed (106)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts src/sandbox/run-tool.effect.test.ts` → `Test Files 2 passed (2)`, `Tests 50 passed (50)`.
- `pnpm gate` (repo root, second run after a prettier fix) ended with:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (4.7s)
  PASS  format  (82.7s)
  PASS  lint  (1.8s)
  PASS  typecheck  (52.3s)
  PASS  tests @zilar/server  (32.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The first `pnpm gate` run FAILed `format` on `run-tool.ts`; I formatted that one file with prettier and re-ran, nothing else changed.)

### Files changed
- `apps/server/src/sandbox/run-tool.ts` (allowed)
- `apps/server/src/sandbox/run-tool.effect.test.ts` (allowed)
- `work/T-0489-effect-run-tool.md` (allowed)

### Effect 4 surprises / notes
- `Effect.callback` resumes at most once by itself, which is exactly the old `settled` semantics; I did not need a separate flag.
- `Effect.timeoutOrElse`'s `orElse` is a `LazyArg` evaluated after interrupting the source, so reading the `fetchCount` local there reproduces the old `setTimeout` callback value.
- Interruption runs the register function's returned cleanup effect (listener removal) before the scope finalizer terminates the worker; on normal completion the cleanup does not run, which is harmless because resume is once-only.
- `Effect.acquireRelease` puts `Scope` in the requirements, so the program is wrapped in `Effect.scoped`; the spawn failure is a typed `Data.TaggedError` caught with `Effect.catchTag`.
- The wall timer is now Effect's clock rather than `setTimeout(...).unref()`. No test depends on the timer keeping/unkeeping the process alive; all existing tests pass unchanged.

### Deviations
- None from the spec. The only addition is the optional `run-tool.effect.test.ts` the spec allowed.

## Review (written by Claude)

Approved (lead, 2026-10-07).
- runTool runs in Effect.scoped with the Worker as an acquireRelease resource, so it is terminated on every exit.
- The listeners are one callback effect that resumes once; the wall clock goes through timeoutOrElse with the same timeout result.
- Fetch handling is unchanged, and the existing tests are untouched.
Pre-review clean.
