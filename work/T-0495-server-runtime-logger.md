---
id: T-0495
title: "Effect F1: server ManagedRuntime module and a pino-backed Effect Logger layer that keeps our redaction (not wired into index.ts yet)"
status: merged
milestone: M5
branch: task/T-0495-server-runtime-logger
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.4 day
---

# T-0495: server runtime and logger bridge

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. Plan `docs/audit/effect-everywhere-plan.md`:
- §4.2 F1: the runtime and layer conventions;
- §2.4: services and layers;
- §2.8: a pino-backed Effect `Logger` that **keeps our redaction**.

This builds the shared pieces that the Config, Database and HTTP foundations plug into. **It does not change `index.ts` yet**; the HTTP edge task wires it.

### Verified facts (do not re-derive)
- **`apps/server/src/logger.ts` (43 lines):**
  - `redactPaths` (lines 13-26) covers the sensitive keys, their `*.key` forms, `req.headers.authorization`, `req.headers.cookie`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ZILAR_KEY_ENCRYPTION_KEY`, `GIF_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SMTP_PASSWORD` and `SMTP_USER`;
  - `createLogger(config, destination?)` builds pino with `redact: { paths: redactPaths, censor: '[redacted]' }`.
- **`apps/server/src/index.ts`** builds everything at the top level: config at line 57, logger at 58, db at 71, `serve` at 397, the loops from 441. It is not touched here.
- **Effect:**
  - `effect` is ^4.0.0 in `apps/server/package.json`. A parallel task (T-0494) bumps it to ^4.0.2, so **do not edit `package.json`** here.
  - The reference examples are `docs/effect-reference/examples/10_managed-runtime.ts.txt` (`ManagedRuntime.make`, `memoMap`, dispose) and `20_layer-tests.ts.txt` (providing test layers);
  - `docs/effect-reference/LLMS.md` covers services (`Context.Service`) and `Layer`.
- **Existing Effect modules** to stay compatible with: `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/web-tools/guarded-fetch.ts` and `apps/server/src/sandbox/run-tool.ts` (they run with `Effect.runPromise` at their edges). Several loops now use `Effect.runFork`.

### What to build
1. **`apps/server/src/effect/logger.ts`:**
   - `makePinoLoggerLayer(pinoLogger)`: an Effect `Logger` layer that forwards every Effect log call to the given pino instance, at the matching level. Annotations and spans become structured fields; the message stays the message.
   - Redaction is **pino's own** (the instance already has `redactPaths`). Add a test proving that an annotation named `token` or `DATABASE_URL` comes out `[redacted]`.
   - **No log line may contain a value the pino instance would have redacted.**
2. **`apps/server/src/effect/runtime.ts`:**
   - `makeServerRuntime(layer)`: wraps `ManagedRuntime.make` with one shared `memoMap`, and returns `{ runtime, runPromise, runFork, dispose }`.
   - A `ServerLayer` type alias.
   - A short header comment on the conventions:
     - one runtime per process, made at the edge;
     - modules export Effects, or Promise functions built through the runtime;
     - tests build their own runtime from test layers.
3. **`apps/server/src/effect/runtime.test.ts` and `apps/server/src/effect/logger.test.ts`:**
   - the runtime runs an effect that uses a test service;
   - dispose runs the layer finalizers (prove it with an `acquireRelease` in a test layer);
   - the logger forwards `Effect.log`, `logWarning` and `logError` with fields to a pino instance writing to a memory stream, with redaction.
4. **`docs/EFFECT_GUIDE.md` is not edited;** the lead updates it. Put the conventions you chose in the Report.

### Read first
`AGENTS.md`, `docs/audit/effect-everywhere-plan.md` §2.4, §2.8 and §4.2, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/examples/10_managed-runtime.ts.txt`, `docs/effect-reference/examples/20_layer-tests.ts.txt`, `apps/server/src/logger.ts`.

### Allowed files
`apps/server/src/effect/runtime.ts`, `apps/server/src/effect/runtime.test.ts`, `apps/server/src/effect/logger.ts`, `apps/server/src/effect/logger.test.ts`, `work/T-0495-server-runtime-logger.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect
pnpm gate
```

### Acceptance
- A server runtime helper and a pino-backed Effect Logger layer exist, with tests that prove finalizers and redaction.
- Nothing else changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Built the F1 runtime and the pino-backed Effect `Logger` bridge. `index.ts` is
untouched, as the spec requires.

- `apps/server/src/effect/runtime.ts` — `ServerLayer<R, ER>` (`Layer.Layer<R, ER, never>`) and
  `makeServerRuntime(layer)` returning `{ runtime, runPromise, runFork, dispose }`. It calls
  `ManagedRuntime.make(layer, { memoMap })` with one module-level `serverMemoMap`
  (`Layer.makeMemoMapUnsafe()`), following `docs/effect-reference/examples/10_managed-runtime.ts.txt:60-69`.
  Header comment states the conventions below.
- `apps/server/src/effect/logger.ts` — `makePinoLoggerLayer(pinoLogger)`: maps
  `Logger.formatStructured` and writes each entry through the matching pino level
  (Trace/Debug/Info/Warn/Error/Fatal → `trace`/`debug`/`info`/`warn`/`error`/`fatal`). Annotations and
  spans are spread onto the **top level** of the pino object, so the pino instance's own
  `redactPaths` (`logger.ts:14-26`) apply unchanged; the formatted message is the pino `msg`.
  A `PinoSink = Pick<PinoLogger, level>` type accepts any pino instance regardless of its
  custom-level generics.
- `apps/server/src/effect/runtime.test.ts` — 2 tests: a test `Context.Service` runs through the
  runtime; `dispose()` runs a layer finalizer (`Effect.acquireRelease`) exactly once.
- `apps/server/src/effect/logger.test.ts` — 3 tests using a pino instance over an in-memory
  `write` sink with `redactPaths`: `Effect.log` + annotation arrives at `msg`/level 30/field;
  `logWarning` and `logError` arrive at levels 40 and 50; annotations named `token` and
  `DATABASE_URL` come out `[redacted]` and their raw values appear nowhere.

Conventions chosen (for `docs/EFFECT_GUIDE.md`, lead edits):

- One runtime per process, created at the edge from `ServerLayer`; disposed on shutdown.
- `ServerLayer<R>` is a fully-provided layer (`R` = services it produces, environment `never`).
- Modules export Effects, or Promise functions built through a runtime; `runPromise`/`runFork`
  stay at the edge.
- Tests build their own runtime from test layers and dispose it.

### Files changed

- `apps/server/src/effect/runtime.ts` (new)
- `apps/server/src/effect/runtime.test.ts` (new)
- `apps/server/src/effect/logger.ts` (new)
- `apps/server/src/effect/logger.test.ts` (new)
- `work/T-0495-server-runtime-logger.md` (status + this report)

`git status` shows only those; gate reports `scope: every changed file is inside the Allowed files`.

### Commands and real results

- `pnpm install` — Done, 1170 packages, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect` —
  `Test Files 2 passed (2)`, `Tests 5 passed (5)`.
- `pnpm gate` — final run:
  - `PASS  install (frozen)  (3.7s)`
  - `PASS  format  (79.5s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (53.0s)`
  - `PASS  tests @zilar/server  (7.8s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Two earlier gate runs failed on pino's custom-level generics in `logger.test.ts` (TS2379/TS2375);
fixed by the `PinoSink` structural type and by typing the test logger as `PinoLogger`.

### Problems / deviations

- None from the spec. No other test broke, so nothing is BLOCKED.
- `package.json` was not touched (Effect stays `^4.0.0` locally; T-0494 owns the bump).

### Open questions

- The plan §2.4 shows a single memoMap shared by "the app"; I used one module-level memoMap shared
  by every runtime built through `makeServerRuntime`, matching the reference example. If the lead
  wants each runtime isolated (fresh memoMap per call), that is a one-line change.

### Round: PREREVIEW fixes (2026-10-07)

Four findings from `PREREVIEW.md`, all fixed inside the Allowed files. This round
replaced the first `Logger.formatStructured` bridge (described above) with
`Logger.make` + `References`, because the raw message and `Cause` are needed to
redact object parts and to build `err`.

1. **Object messages become redactable fields** (`logger.ts`). The bridge now reads the raw
   message parts. Object parts, `References.CurrentLogAnnotations` and
   `References.CurrentLogSpans` are merged at the top level of the pino object, so the
   instance's own `redactPaths` censor them; only string parts (and stringified primitives)
   become `msg` (empty when there are none). `cause` is passed as an `err` field built from the
   error's name and message, not one pre-rendered string. Tests: `Effect.log({ password:
   'hunter2' })` → `password: "[redacted]"` and no `hunter2`; `Effect.log('saved', { token:
   'abc' })` → `msg: "saved"` with token redacted; a `Cause` renders as `err: { name, message }`.
   Commit `28248b45`.
2. **Safe stringify** (`logger.ts` `safeStringify`). Every remaining `JSON.stringify` of a
   message part is wrapped in try/catch falling back to `String(value)`, so BigInt or circular
   values cannot turn a log call into a defect. Tests: a `10n` BigInt → `msg: "big 10"`, and a
   circular object does not defect. Commit `bcc09ee4`.
3. **Exhaustive level table** (`logger.ts`). `PINO_LEVELS` is now `Record<LogLevel.LogLevel,
   PinoLevel>` (all eight levels) and the `?? "info"` fallback is gone, so a missing level
   fails typecheck. Test pins Trace/Debug/Info/Warn/Error/Fatal to pino levels
   10/20/30/40/50/60. Commit `e86085cd`.
4. **Error message parts become `err` fields** (`logger.ts`). An `Error` message part is now
   written to `fields.err` as `{ name, message }` (first Error wins); the stack and arbitrary
   enumerable props are never copied. Tests: `Effect.logError("save failed", new TypeError("bad
   input"))` → `msg: "save failed"`, `err: { name: "TypeError", message: "bad input" }`;
   `Effect.log(new Error("x"))` → non-empty `err`. Commit `18297cb4`.

Commands:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect` after the last
  commit → `Test Files 2 passed (2)`, `Tests 13 passed (13)`.
- `pnpm gate` → `PASS install (frozen) (6.8s)`, `PASS format (72.7s)`, `PASS lint (1.3s)`,
  `PASS typecheck (21.2s)`, `PASS tests @zilar/server (5.5s)`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.

No other files changed; `PREREVIEW.md` was read but never staged or edited. `status: review`.

## Review (written by Claude)

Approved (lead, 2026-10-07).
- **effect/runtime.ts:** makeServerRuntime, a ManagedRuntime with a shared memoMap that returns runPromise, runFork and dispose; finalizers are tested.
- **effect/logger.ts:** a pino-backed Effect Logger layer. Object message parts and the cause become structured fields, so pino redaction applies (password and token tested). Error parts become err {name, message}. Stringify is safe, and the level map is exhaustive.
Three lead fix rounds were made for redaction safety. This is the logger foundation for every Effect log line.
