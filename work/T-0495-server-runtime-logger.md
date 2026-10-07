---
id: T-0495
title: "Effect F1: server ManagedRuntime module and a pino-backed Effect Logger layer that keeps our redaction (not wired into index.ts yet)"
status: todo
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

## Review (written by Claude)
