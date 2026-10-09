---
id: T-0760
title: "S7: server small edges A on Effect — voice/engine.ts (child process run as Effect.callback with timeout + kill on interrupt, probe/convert as Effects behind the unchanged VoiceEngine Promise interface), gifs/routes.ts fetchProxiedMedia (https request as Effect.callback, destroy on interrupt), version.ts (Schema decode of package.json); same error classes and messages"
status: merged
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

### What changed
- `apps/server/src/voice/engine.ts`: `run` became `runCommand`, built with `Effect.callback`. Its finalizer sends SIGKILL when the fiber is interrupted, and `Effect.timeoutOrElse` fails with the same `FfmpegError("<cmd> timed out after <ms>ms")`. `probeEffect(ffprobe, inputPath)` and `convertEffect(ffmpeg, inputPath, outputPath)` are exported Effects. The ffprobe JSON is decoded with `Schema.fromJsonString(Schema.Struct({...}))` through `Schema.decodeUnknownEffect`; a decode failure gives `NotAudioError('ffprobe did not return JSON')`. `createFfmpegEngine` keeps its Promise methods, which run the Effects with `Effect.runPromise`. `NotAudioError`, `FfmpegError` and their messages are unchanged.
- `apps/server/src/gifs/routes.ts`: new `fetchProxiedMediaEffect` built with `Effect.callback`. The first outcome wins (a `settled` flag), and an interrupt destroys the request. `fetchProxiedMedia` is now `Effect.runPromise(fetchProxiedMediaEffect(...))`. The texts `redirect refused`, `response too large` and `fetch timeout` are unchanged.
- `apps/server/src/version.ts`: `package.json` is decoded with `Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))`. On failure it throws the same `apps/server/package.json must contain a string "version" field`. The `readFileSync` error still propagates as before.
- `work/T-0760-server-edges-a.md`: status and this Report only.

### Deviations and notes
- `gifs/routes.ts` keeps `req.setTimeout(...)`. It is the request's idle socket timeout, not the global `setTimeout`. Moving it to `Effect.timeoutOrElse` would make it an overall deadline, which changes behaviour. So one line still matches a grep for `setTimeout`.
- A malformed `package.json` now throws the fixed version message instead of a `SyntaxError`, which follows the spec's "same thrown message when decoding fails".
- Malformed ffprobe output with a non-string field used to throw a `TypeError`; it now gives `NotAudioError`.
- Interrupt handling: `probeEffect` and `runCommand` use a `settled` flag, so a late `close` or `error` after a kill is ignored.

### Commands and results
- Baseline before edits, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice src/gifs`: Test Files 8 passed | 2 skipped (10); Tests 73 passed | 3 skipped (76).
- After edits, same command: Test Files 8 passed | 2 skipped (10); Tests 73 passed | 3 skipped (76). The same counts before and after.
- Real ffmpeg (ffmpeg is installed at /opt/homebrew/bin): `ZILAR_VOICE_INTEGRATION=1 ... src/voice/engine.test.ts`: Tests 2 passed (2).
- `voice/integration.test.ts`: skipped. It is gated by `ZILAR_VOICE_INTEGRATION=1` and needs the live XMPP admin. I did not run it.
- Gifs real-path check: `gifs/routes.test.ts` (lines 335-401) runs `fetchProxiedMedia` against a local HTTPS server, so the redirect, size-cap and timeout paths ran through the new code and passed.
- Scratch checks, run with tsx from a script in the scratchpad (outside the worktree; no file left in the worktree): a missing binary gives `FfmpegError` "could not be started: spawn ... ENOENT"; non-JSON output gives `NotAudioError` "ffprobe did not return JSON"; exit code 1 gives `NotAudioError` "ffprobe rejected the upload (exit 1)"; a slow binary gives `FfmpegError` "timed out after 10000ms" after 10 s; interrupting the fiber kills the child process (checked by pid). `serverVersion` is "0.1.0" and equals `package.json`. The `instanceof` checks passed through `Effect.runPromise`.
- `pnpm exec prettier --write` on the three files: all unchanged.
- `pnpm gate` (exit 0):
```
PASS  install (frozen)  (1.5s)
PASS  format  (0.6s)
PASS  lint  (0.9s)
PASS  typecheck  (3.5s)
PASS  tests @zilar/server  (21.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **`runCommand`:** an `Effect.callback` whose finalizer sends SIGKILL to the child on timeout or interrupt; `timeoutOrElse` keeps the same `FfmpegError` text.
- **ffprobe output:** decoded with `Schema.fromJsonString` (optional fields, so extra keys are ignored).
- **The GIF fetch:** `req.setTimeout` is kept as the socket idle timeout, which is the right call because an Effect timeout would change it into an overall deadline.
- **`version.ts`:** decoded with Schema.
- **Results:** voice and gifs tests 73 pass, unchanged; the real-ffmpeg engine test passes 2 of 2; the gate passed.
