---
id: T-0760
title: "S7: server small edges A on Effect — voice/engine.ts (child process run as Effect.callback with timeout + kill on interrupt, probe/convert as Effects behind the unchanged VoiceEngine Promise interface), gifs/routes.ts fetchProxiedMedia (https request as Effect.callback, destroy on interrupt), version.ts (Schema decode of package.json); same error classes and messages"
status: todo
milestone: M5
branch: task/T-0760-server-edges-a
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0760 (S7): voice engine, GIF media fetch and version on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S7), accepted by Julio on 2026-10-09. The three files do I/O without Effect, so the 100% rule (§1.4) counts them as needs-effect.

### Verified facts (do not re-derive)
- **`apps/server/src/voice/engine.ts`** (204 lines):
  - `NotAudioError` (line 47) and `FfmpegError` (line 55) are `Error` subclasses;
  - `run(command, args, timeoutMs)` (lines 76-109) wraps `spawn` in `new Promise`, with a `setTimeout` that sends SIGKILL and rejects with `FfmpegError("<cmd> timed out after <ms>ms")`. A spawn error rejects with `FfmpegError("<cmd> could not be started: <message>")`; a close resolves `{ code, stdout, stderr }`;
  - `createFfmpegEngine(paths)` (line 136) returns a `VoiceEngine` whose `probe` (line 139) and `convert` (line 178) are async methods. `probe` uses `JSON.parse` in a try/catch (lines 151-155).
  - **Callers:** `voice/api.ts:30`, `voice/routes.ts:2` (type only), and the tests `voice/engine.test.ts:6`, `voice/integration.test.ts:10` and `voice/routes.test.ts:7`.
- **`apps/server/src/gifs/routes.ts`** (82 lines): `fetchProxiedMedia(url, address, { timeoutMs, maxBytes, port? })` (lines 37-81) wraps `httpsRequest` in `new Promise`. It rejects with the texts `redirect refused`, `response too large` and `fetch timeout`. **Callers:** `gifs/api.ts:53,222` and `gifs/routes.test.ts:336-396`, which assert those failures.
- **`apps/server/src/version.ts`** (15 lines): `JSON.parse(readFileSync(...))` of `../package.json` at module load, a hand-written shape check, and `export const serverVersion: string`. **Callers:** `app.ts:55` and `web-tools/adapters.ts:15`.
- **The rules:** `docs/EFFECT_GUIDE.md`. Lines 12-32 cover a Promise edge over an Effect inside. Line 164: `Effect.async` does not exist in 4.0, so use `Effect.callback`. Lines 165-170 cover `timeoutOrElse`. Check every API in `node_modules/effect/dist/*.d.ts` (Effect 4.0.2).

### What to build
1. **`voice/engine.ts`:**
   - `run` becomes `runCommand(command, args, timeoutMs): Effect.Effect<CommandResult, FfmpegError>`. Build it with `Effect.callback`; its cleanup sends SIGKILL to the child when the fiber is interrupted. Apply the timeout with `Effect.timeoutOrElse`, failing with the same `FfmpegError` text.
   - `probe` and `convert` are written as Effects (`probeEffect` and `convertEffect`, exported for later tasks). The `VoiceEngine` methods stay Promise methods that run them with `Effect.runPromise`, and the errors reach callers as the same `NotAudioError` and `FfmpegError` instances with the same messages. Keep the classes as they are; callers use `instanceof`.
   - Decode the ffprobe JSON with Effect Schema: a `Schema.Struct` with optional fields, through the JSON-string decoder that exists in 4.0.2 (check `Schema.d.ts`). A decode failure gives `NotAudioError('ffprobe did not return JSON')`.
2. **`gifs/routes.ts`:** add `fetchProxiedMediaEffect(...)`, built with `Effect.callback`, that destroys the request on interrupt. The timeout and the size cap behave exactly as today, with the same error texts (wrap them in `Error`, so existing tests that check `.message` pass). `fetchProxiedMedia` stays the same exported Promise function, now `Effect.runPromise(fetchProxiedMediaEffect(...))`.
3. **`version.ts`:** decode `package.json` with a Schema `{ version: Schema.String }`, synchronously at module load (`Schema.decodeUnknownSync`, or the 4.0.2 equivalent). Keep the same thrown message when decoding fails, and keep `serverVersion: string`.
4. **No other file changes.** Every existing test must pass unchanged: `voice/engine.test.ts`, `voice/routes.test.ts`, `gifs/routes.test.ts`, `gifs/gifs.test.ts`, and the app tests that import the version. `voice/integration.test.ts` may need ffmpeg; if it is skipped locally, say so.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, the three files and their tests.

### Allowed files
`apps/server/src/voice/engine.ts`, `apps/server/src/gifs/routes.ts`, `apps/server/src/version.ts`, `work/T-0760-server-edges-a.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice src/gifs
pnpm gate
```

### Acceptance
- The three files import Effect and have no `new Promise`, `setTimeout` or raw `JSON.parse` left.
- The public functions and the error texts are unchanged, and the tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
