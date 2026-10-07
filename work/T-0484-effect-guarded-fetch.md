---
id: T-0484
title: "Effect convert: web-tools guarded GET (DNS pin, deadline + idle timeout, capped read) in Effect, Promise API unchanged"
status: merged
milestone: M5
branch: task/T-0484-effect-guarded-fetch
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.35 day
---

# T-0484: the guarded fetch in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md`:
- Effect inside, plain `Promise` exports at the edge;
- zod stays;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/web-tools/guarded-fetch.ts` (285 lines).
- **Exports:**
  - `WEB_FETCH_TIMEOUT_MS` (10 s), `WEB_MAX_RESPONSE_BYTES`, `WEB_MAX_DECODE_CHARS`, `WEB_ALLOWED_CONTENT_TYPES`;
  - the types `DnsLookup`, `GuardedGetOptions`, `PinnedFetcher`, `GuardedBody`, `GuardedGetResult`;
  - `guardedGet` (line 72), `decodeCapped` (line 181), `truncateChars` (line 280).
- **`guardedGet`** (lines 72-180) runs these steps in order:
  1. validate the URL (https only, no credentials, no port, host allowlist rules);
  2. DNS resolve and refuse private addresses;
  3. fetch pinned to the address (`options.fetcher ?? fetchPinned`);
  4. refuse redirects, with a `detail` naming the new URL;
  5. check the status and the content type.
  
  It **never throws**: every failure is `{ ok: false, summary }`, and `explainFetchError` (line 157) maps a timeout message.
- **`fetchPinned`** (lines 189-275) is an `https.request` with a hard overall `deadline` `setTimeout` (lines 257-263, `unref`), an idle `req.setTimeout`, and a capped streaming read.
- **Importer:** `apps/server/src/web-tools/adapters.ts`. **Tests:** `apps/server/src/web-tools/guarded-fetch.test.ts`, plus the adapter tests in `apps/server/src/web-tools/adapters.test.ts`.
- **The reference conversion** is `apps/server/src/voice-transcription/pipeline.ts`, plus the guide's notes.

### What to build
1. **Rewrite `guardedGet`'s steps** as an `Effect.gen` pipeline with typed internal errors (bad URL, host not allowed, fetch failed, redirect, status, content type). Each maps at the Promise edge to **exactly** today's `{ ok: false, summary, detail? }` strings.
2. **`fetchPinned`** becomes an `Effect.callback` / `Effect.async`-style wrapper over `https.request` with an interruption finalizer that destroys the request. The overall deadline becomes `Effect.timeoutOrElse`. **Keep the idle timeout and the byte cap** exactly as today.
3. **Exports:** every export keeps its name, type and Promise signature. `decodeCapped` and `truncateChars` stay plain functions.
4. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/web-tools/guarded-fetch.effect.test.ts`, for example: an interrupted call destroys the request.
5. **Report:** give the line counts before and after, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/guarded-fetch.test.ts`.

### Allowed files
`apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/web-tools/guarded-fetch.effect.test.ts`, `work/T-0484-effect-guarded-fetch.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot web-tools
pnpm gate
```

### Acceptance
- The guarded GET runs on Effect inside, with identical exports, results and strings.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted `apps/server/src/web-tools/guarded-fetch.ts` to run on Effect inside, with the same `Promise` exports at the edge.

- `guardedGet` is now `Effect.runPromise(guardedGetEffect(...).pipe(Effect.catchTags({...})))`. The guard steps (URL parse, https/credentials/port checks, host allowlist, DNS resolve, IP classification, redirect/status/content-type checks) run in an `Effect.fnUntraced` generator. The fetch leg is chosen per call: an injected `PinnedFetcher` is lifted with `Effect.tryPromise`, otherwise `fetchPinned`.
- Six `Data.TaggedError` classes model the failure categories (bad URL, host not allowed, fetch failed, redirect, status, content type). `catchTags` at the `Promise` edge maps each to the exact old `{ ok:false, summary, detail? }` objects, so summaries and the redirect `detail` text are unchanged.
- `fetchPinned` is now an `Effect.callback` over `https.request`. It keeps the request's idle timeout (`req.setTimeout` + `req.on('timeout')`), the redirect short-circuit, the 2 MiB streaming byte cap and the SNI/`Host` pinning. The register function returns a cleanup effect that destroys the request, so interruption releases the socket. The hard overall deadline moved out of `fetchPinned` to `Effect.timeoutOrElse` around the fetch step.
- `decodeCapped`, `truncateChars`, the four constants and every exported type keep their names and signatures; `guardedGet` still returns `Promise<GuardedGetResult>`. `guarded-fetch.test.ts` and `adapters.test.ts` are unchanged.

### Files changed
- `apps/server/src/web-tools/guarded-fetch.ts` (line count 285 → 396)
- `apps/server/src/web-tools/guarded-fetch.effect.test.ts` (new, 64 lines)
- `work/T-0484-effect-guarded-fetch.md` (status + this Report)

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/guarded-fetch.test.ts src/web-tools/guarded-fetch.effect.test.ts` → 2 files, **26 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/adapters.test.ts` → 1 file, **20 passed**.
- `pnpm gate` (1st run) → **GATE FAIL**, on `format` only: `apps/server/src/web-tools/guarded-fetch.ts`; fixed with `pnpm exec prettier --write apps/server/src/web-tools/guarded-fetch.ts`.
- `pnpm gate` (final run, repo root, after this Report was written) → exit 0:
  ```
  PASS  install (frozen)  (7.5s)
  PASS  format  (111.2s)
  PASS  lint  (2.4s)
  PASS  typecheck  (1.6s)
  PASS  tests @zilar/server  (12.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### The new Effect test
`guarded-fetch.effect.test.ts` mocks `node:https` so no socket opens; the fake request never responds. First test: `guardedGet(..., { timeoutMs: 20 })` returns `{ ok:false, summary:'fetch timed out' }` and the fake request's `destroy` was called — this proves the `Effect.timeoutOrElse` deadline and the interruption finalizer. Second test: the same deadline applies to an injected hanging fetcher.

### Deviations / notes
- The overall deadline now applies to whichever fetch is used, including an injected fetcher. Production always uses `fetchPinned`, so behaviour there is identical; an injected fetcher that previously hung now times out at `timeoutMs` (tests only inject immediately-resolving/rejecting fetchers). I read "the overall deadline becomes `Effect.timeoutOrElse`" as this pipeline-level combinator.
- The redirect `detail` carries the remote `Location` into a tagged-error field (needed to build the old detail). It is mapped to `detail` at the edge and never enters a summary or a log.

### Effect 4 surprises
- `Effect.callback` is the callback constructor (there is no `Effect.async` in 4.0.0). Its `resume` takes an `Effect` (not a value), and the register function's return value is the interruption finalizer — that is where `req.destroy()` goes.
- `Effect.timeoutOrElse` interrupts the source (running that finalizer) and keeps only our typed error, unlike `Effect.timeout`, which adds `Cause.TimeoutError` to the channel.

## Review (written by Claude)

Approved (lead, 2026-10-07).
- guardedGet is an Effect.gen pipeline with typed internal errors, mapped to byte-identical results.
- fetchPinned is an interruptible effect whose finalizer destroys the request, with the deadline through timeoutOrElse. The idle timeout and the byte cap are unchanged.
- The existing tests are untouched; a new effect test covers interruption.
Nit accepted: the deadline now also covers an injected fetcher (tests only).
