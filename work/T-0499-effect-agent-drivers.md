---
id: T-0499
title: "Effect P4: packages/agent-drivers on Effect — zod schemas to Effect Schema, the HTTP calls and the poll loop on Effect, AgentDriver Promise API unchanged"
status: merged
milestone: M5
branch: task/T-0499-effect-agent-drivers
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0499: agent-drivers on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §4.3 picks `packages/agent-drivers` as the package pilot (P4): one zod file, and no other package imports it.

### Verified facts (do not re-derive)
- **The package:** `packages/agent-drivers/package.json` depends only on `zod` ^4.6.5, with scripts `typecheck` and `test`. No other `package.json` in the repo depends on `@zilar/agent-drivers`.
- **The files:** `src/index.ts` (3 lines), `src/types.ts` (86), `src/rules.ts` (38) with `src/rules.test.ts`, and `src/opencode-v2.ts` (433) with `src/opencode-v2.test.ts` (481). `src/fake-opencode-server.ts` is the test double.
- **`src/opencode-v2.ts`:**
  - the **zod schemas** are at lines 24-84 (`SessionIdSchema` with a `/^ses/` regex, `CreateSessionResponseSchema`, `PromptResponseSchema`, `InterruptResponseSchema`, `MessageSchema`, `MessagesResponseSchema`, `Text`/`Reasoning`/`ToolContentSchema`, `PermissionRequestSchema`, `PermissionListResponseSchema`, `ErrorBodySchema`) and the types are inferred at lines 86-87;
  - **`readErrorMessage`** (around line 103) caps the message at 500 characters;
  - **`delay(ms, signal)`** (lines 133-150) is an abortable `setTimeout`;
  - **`class OpenCodeV2Driver implements AgentDriver`**: `start`, the polling run, `request(...)`, `describeFailure` and `parseBody(operation, response, schema: z.ZodType<T>)` (lines 412-428). A failure throws `DriverError(operation, message)` with fixed messages ("returned invalid JSON", "returned an unexpected response body");
  - **`createOpenCodeV2Driver(options)`** is at line 431.
- **The rules:** Effect 4 idioms from `docs/EFFECT_GUIDE.md`, including the "Effect 4 facts learned" section (`Effect.callback`, `timeoutOrElse`, `tryPromise` signals, loops with `Schedule`). The Schema mapping is in the plan §2.5.

### What to build
1. **Package:** add `effect` ^4.0.2 to `packages/agent-drivers/package.json`, remove `zod`, and run `pnpm install` to update `pnpm-lock.yaml`.
2. **Schemas:** rewrite them with Effect Schema (`Schema.Struct`, `Schema.Literal`, `optionalKey`, a pattern check for the session id), with types from `typeof X.Type`. `parseBody` takes a `Schema` and decodes with `Schema.decodeUnknown`, giving the same `DriverError` messages.
3. **Internals:**
   - every HTTP call is an `Effect.tryPromise` using the given `fetchImpl` and the signal;
   - `delay` becomes `Effect.sleep`, interruptible when the run's signal aborts;
   - the polling run becomes an Effect loop. **Keep the exact poll interval, the boundary and selection logic (`selectAfter`), the delta emission and the permission handling.**
   - The public `AgentDriver` methods stay Promise or async-iterator based, exactly as `types.ts` declares, running the Effect programs at the edge.
4. **`types.ts` and `rules.ts`:** keep the exported types. Convert only if they hold zod (check).
5. **Tests:** `src/opencode-v2.test.ts` and `src/rules.test.ts` pass **unchanged**. If a test asserts on zod specifics and must change, stop and report BLOCKED with the line. You may add `src/opencode-v2.effect.test.ts`, for example: aborting a run interrupts the poll sleep promptly.
6. **Report:** give the line counts, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, `packages/agent-drivers/src/` (all files).

### Allowed files
`packages/agent-drivers/package.json`, `pnpm-lock.yaml`, `packages/agent-drivers/src/opencode-v2.ts`, `packages/agent-drivers/src/types.ts`, `packages/agent-drivers/src/rules.ts`, `packages/agent-drivers/src/opencode-v2.effect.test.ts`, `work/T-0499-effect-agent-drivers.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/agent-drivers test --reporter=dot
pnpm gate
```

### Acceptance
- `@zilar/agent-drivers` has no zod and runs on Effect inside, with the same public API and behaviour.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted `packages/agent-drivers` to Effect 4. `zod` is gone from the package; the
schemas use Effect Schema, the HTTP calls and the poll loop use Effect, and the public
`AgentDriver` API (Promise / async-iterator) is unchanged.

- **`package.json`**: removed `zod ^4.6.5`, added `effect ^4.0.2`; `pnpm install`
  updated `pnpm-lock.yaml` (`effect@4.0.2` present).
- **Schemas** (`opencode-v2.ts`): all twelve zod schemas rewritten with
  `Schema.Struct`, `Schema.Literal`, `Schema.Unknown`, `Schema.Array`,
  `Schema.optionalKey`, `Schema.Boolean`/`Number`/`String`; the session id is
  `Schema.String.check(Schema.isPattern(/^ses/))`. Types still come from
  `typeof X.Type`. `parseBody` decodes with `Schema.decodeUnknownResult`, keeping the
  same two `DriverError` messages ("returned invalid JSON", "returned an unexpected
  response body"). `readErrorMessage` uses the same Schema decode and keeps the 500-char cap.
- **HTTP**: every call is `Effect.tryPromise` around `fetchImpl`, and the thunk's
  `AbortSignal` is passed to `fetch` (so `events()`'s signal can cancel an in-flight
  request). `describeFailure` is a non-throwing `Effect.promise`; the `DriverError`
  mapping (status + fixed message) is unchanged.
- **Poll loop**: now an `Effect.gen` loop. The exact poll interval
  (`Effect.sleep(pollIntervalMs)`), `selectAfter` boundary/fallback, delta emission
  (`textLengths`/`toolCalls`/`toolResults`) and permission dedup are preserved. The loop
  offers events to an unbounded `Queue` and ends with `RUN_END`; `Effect.runFork(loop,
  { signal })` starts it and the run's `AbortSignal` interrupts the sleep (and the
  fetch). `run()` drains the queue so `events()` stays an async iterator.
- **`types.ts` / `rules.ts`**: hold no zod; left untouched, all exports kept.

### Files changed

- `packages/agent-drivers/package.json` (zod out, effect in)
- `pnpm-lock.yaml` (lockfile update)
- `packages/agent-drivers/src/opencode-v2.ts` (433 → 509 lines)
- `packages/agent-drivers/src/opencode-v2.effect.test.ts` (new, 50 lines)
- `work/T-0499-effect-agent-drivers.md` (this report + status)

`types.ts` (86 lines) and `rules.ts` (38 lines) are unchanged. No existing test was modified.

### Commands and real results

- `pnpm install`: done, `effect@4.0.2` added, exit 0.
- `pnpm --filter @zilar/agent-drivers test --maxWorkers=2 --reporter=dot src/opencode-v2.test.ts src/opencode-v2.effect.test.ts src/rules.test.ts`:
  **3 test files passed, 20 tests passed** (19 existing + 1 new). The existing
  `opencode-v2.test.ts` and `rules.test.ts` pass unchanged.
- `pnpm --filter @zilar/agent-drivers typecheck`: clean (this caught three type errors I then fixed).
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (49.4s)
  PASS  lint  (2.1s)
  PASS  typecheck  (4.9s)
  PASS  tests @zilar/agent-drivers  (2.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Effect 4 surprises

- `Schema.Schema<T>` (a "schema that decodes to `T`") has `DecodingServices = unknown`,
  so it does **not** satisfy `decodeUnknownResult`'s `ConstraintDecoder<unknown>`
  constraint (which defaults the services to `never`). The helper needed
  `S extends Schema.ConstraintDecoder<unknown>` returning `S["Type"]`, not a bare
  `Schema.Schema<T>`.
- `Schema.Array` decodes to `ReadonlyArray` and `Schema.Struct` fields are `readonly`,
  so internal signatures take readonly arrays and the `permission_request` event copies
  `resources` (`[...request.resources]`) into the mutable `string[]` the public
  `AgentEvent` declares.
- `Effect.either` does not exist in 4.0.2; `Effect.result` + `Result.isFailure` is the
  way to turn the typed `DriverError` into the in-loop `{ type: 'error' }` event.
- Bridging a loop to an async iterator: `Effect.runFork(effect, { signal })` with
  `Effect.ensuring(Queue.offer(queue, RUN_END))` works well — the `signal` interrupts
  the fiber (and the `Effect.sleep`), and the finalizer unblocks the consumer. It also
  avoids `Effect.runPromise` rejecting on a normal abort.
- Added note: this pins `effect ^4.0.2` in this package only, so the repo now has two
  Effect copies (apps/server is `^4.0.0` → 4.0.0). I followed the task's explicit
  version; only this package's manifest is in Allowed files.

### Blocked / needs a decision

None.

### Round 2 (fix round, fresh session)

**Findings fixed**
- Finding 1 (should-fix) — abandoned `events()` iterator leaked a forever-polling fiber.
  `run()` forked `runEffect` and dropped the handle, so when a consumer broke out of the
  `for await` (which calls the iterator's `return()`) without aborting the signal, the
  fiber kept polling forever. Fixed in `packages/agent-drivers/src/opencode-v2.ts`:
  `run()` now keeps the fiber handle from `Effect.runFork` and wraps the drain loop in
  `try/finally`, calling `await Effect.runPromise(Fiber.interrupt(fiber))` in the
  `finally`. Added `Fiber` to the `effect` import. `runEffect` itself is unchanged, so
  the live-poll behaviour for normal/aborted runs is the same.

**Tests added**
- `packages/agent-drivers/src/opencode-v2.effect.test.ts`: new test
  `interrupts the poll fiber when the consumer abandons the iterator`. It takes the first
  event via an explicit `[Symbol.asyncIterator]()`, calls `iterator.return()` **without
  aborting the signal**, then waits several short poll intervals and asserts the fake
  server received no further `/message` (or any) requests. Verified it fails on the old
  code (`expected 6 to be 1`) and passes with the fix — so it genuinely covers the leak.

**Disagreements**: none.

**Commands and real results (this round)**
- `pnpm --filter @zilar/agent-drivers test --maxWorkers=2 --reporter=dot src/opencode-v2.test.ts src/opencode-v2.effect.test.ts src/rules.test.ts`:
  **3 test files passed, 21 tests passed** (20 previous + 1 new).
- `pnpm gate`: 
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.4s)
  PASS  format  (34.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.3s)
  PASS  tests @zilar/agent-drivers  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Round 3 (fix round, fresh session)

**Item 1 — defects must reach the consumer (fixed)**
- `packages/agent-drivers/src/opencode-v2.ts`: `runEffect` now ends with
  `Effect.catchDefect((error) => Queue.offer(queue, { kind: 'defect', error }))` before the
  `Effect.ensuring(Queue.offer(queue, RUN_END))`. `RunItem` gained a
  `{ kind: 'defect'; error: unknown }` variant, and `run()` throws `item.error` when it
  dequeues one, so a non-`DriverError` throw now rejects the async iterator with the
  original value instead of ending it as a clean `RUN_END`. Interruption (abort via the
  signal) is not a defect, so it still ends cleanly through `RUN_END`, exactly as before.
- Commit: `de413d2e T-0499: defects in the poll loop reject the iterator`.
- Test: `packages/agent-drivers/src/opencode-v2.effect.test.ts` — new test
  `rejects the iterator with the original error when the poll loop hits a defect`. It
  drives the driver with a `fetchImpl` fake server whose response throws a known `boom`
  when read, and asserts `iterator.next()` rejects with `toBe(boom)`. Verified it fails on
  the pre-fix code (the iterator ended cleanly instead of rejecting) and passes with the
  fix.

**Item 2 — one Effect version (no change needed after the correction)**
- The correction says T-0496 moves `apps/server` to `effect: ^4.0.2`, so agent-drivers
  should also be `^4.0.2`. This branch **already** pins `"effect": "^4.0.2"` (from the
  original conversion), and `apps/server` after T-0496 is the same range. I temporarily
  set it to `^4.0.0`, then reverted it to `^4.0.2` and ran `pnpm install`; `pnpm-lock.yaml`
  resolved agent-drivers to `effect@4.0.2` and the working tree ended clean against HEAD,
  so there is nothing to commit for this item. The lead handles the lockfile at merge.

**Disagreements / deviations**
- Item 1's suggested test was "a fake server whose message payload makes the event
  mapping throw", asserting the rejection `toBe` the same error object. That is not
  achievable through the event-mapping path: `messageEvents` only reads payload values
  through `Schema.decodeUnknownOption`, and Effect's `asOption`/`asResult` adapters
  rethrow a **new** generic `Error("Option adapter can only return none for schema
  issues", { cause })` (verified) — the original thrown value is only in `.cause`, so
  identity is lost. To still exercise the defect path with a `toBe` assertion, the test
  injects the identity-preserving defect from the fake server's response object
  (`response.ok` accessor) instead. The production fix itself is generic and catches any
  defect from anywhere in `runEffect`, including `messageEvents`.

**Commands and real results (this round)**
- `pnpm --filter @zilar/agent-drivers test --maxWorkers=2 --reporter=dot src/opencode-v2.test.ts src/opencode-v2.effect.test.ts src/rules.test.ts`:
  **3 test files passed, 22 tests passed** (21 previous + 1 new).
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (21.9s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.9s)
  PASS  tests @zilar/agent-drivers  (1.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Round 4 (fix round, fresh session)

**Finding 1 (should-fix) — pending `next()` + abandoned `return()` hangs**
- **Fixed.** `packages/agent-drivers/src/opencode-v2.ts`: replaced the `run` async
  generator with a hand-written `AsyncIterableIterator`. With an async generator, an
  abandoned `return()` is queued behind an in-flight `next()`; the in-flight `next()` was
  suspended at `await Queue.take(queue)`, and on a quiet server (no event, no idle, no
  error) that take never settles, so `return()` hung and the `finally` (fiber interrupt)
  never ran — the caller hung and the fiber leaked. The new iterator's `return()` (and the
  `RUN_END`/defect paths in `next()`) call a `stop()` that interrupts the forked fiber
  directly; the fiber's `Effect.ensuring(Queue.offer(queue, RUN_END))` then unblocks any
  pending `Queue.take`, so a pending `next()` also settles with `{ done: true }`. A `stopped`
  flag plus awaiting the shared `start()` promise prevents a `return()` that races fiber
  creation from leaving a fiber behind. `runEffect` and all live-poll behaviour are
  unchanged.
- **Note on the suggested fix:** the finding suggested racing the take against the run
  signal. That cannot cover the exact scenario described ("without aborting the signal"):
  when the signal never aborts, adding it to the take changes nothing. Controlling
  `return()` directly is what removes the generator's request queue, which is the real
  cause of the hang.
- Commit: `T-0499: fix finding 1 - settle return() with a pending next()`.

**Tests added**
- `packages/agent-drivers/src/opencode-v2.effect.test.ts`: new test
  `settles return() while a next() is pending and the signal is not aborted`. The fake
  server returns empty messages every poll, so the pending take has nothing to settle it;
  the test calls `iterator.next()` (not awaited), then `iterator.return()` without aborting
  the signal, asserts `return()` resolves `{ done: true }`, that the pending `next()`
  resolves the same, and that the fake server receives no further polls after the return.
  Verified it fails on the pre-fix code (vitest timeout at 5s, 1 failed / 3 passed) and
  passes with the fix (4 passed). Run against HEAD's `opencode-v2.ts` by temporarily
  checking it out and restoring the fix afterwards.

**Nits not touched:** finding 2 (`isRunDefect` parameter type) and finding 3
(`Effect.sleep(pollIntervalMs)` unit) are in lines this round does not change, so they are
left as-is per the fix-round rules.

**Disagreements**: none.

**Commands and real results (this round)**
- `pnpm --filter @zilar/agent-drivers test --maxWorkers=2 --reporter=dot src/opencode-v2.effect.test.ts`:
  **1 file passed, 4 tests passed**.
- `pnpm --filter @zilar/agent-drivers test --maxWorkers=2 --reporter=dot src/opencode-v2.test.ts src/opencode-v2.effect.test.ts src/rules.test.ts`:
  **3 test files passed, 23 tests passed** (22 previous + 1 new).
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (14.7s)
  PASS  lint  (0.5s)
  PASS  typecheck  (3.5s)
  PASS  tests @zilar/agent-drivers  (2.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

Approved (lead, 2026-10-07). agent-drivers has no zod. The OpenCode driver decodes with Effect Schema and polls in a fiber feeding a queue, keeping the poll interval, selectAfter, deltas and permissions. Two auto rounds: an abandoned iterator interrupts the poll fiber, and return() settles a pending next(). Lead round: a defect in the poll loop now rejects the iterator with the original error, and effect is ^4.0.2, as the server is after T-0496. The existing tests are untouched.
