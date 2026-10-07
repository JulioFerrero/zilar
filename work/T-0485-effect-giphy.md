---
id: T-0485
title: "Effect convert: Giphy provider (DNS pin, pinned https GET with timeout and cap, address fallback) in Effect, Promise API unchanged"
status: merged
milestone: M5
branch: task/T-0485-effect-giphy
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.3 day
---

# T-0485: the Giphy provider in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md`:
- Effect inside, plain `Promise` exports at the edge;
- zod stays;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/gifs/giphy.ts` (368 lines).
- **Exports:**
  - `GIPHY_MEDIA_HOSTS`, `GIPHY_API_HOST`, `GiphyRating`;
  - `parseGiphyResponse` (line 169), `GiphyProviderOptions` (line 189), `class GiphyError` (line 201), `GiphyFetcher` (line 208);
  - `createGiphyProvider(options): GifProvider` (line 262), `createFakeGifProvider` (line 326).
- **The async logic:**
  - `defaultResolver` (line 210);
  - `fetchGiphyApi` (from line 218): an `https.request` pinned to an address, with `req.setTimeout(timeoutMs)` and a 1 MiB cap. A redirect resolves with an empty body;
  - `createGiphyProvider.call` (from line 265): resolve the addresses (a resolver failure counts as none, which throws `GiphyError`), skip non-IP or blocked addresses, try the fetcher, parse.
  
  The routes turn `GiphyError` into a retryable 502 (comment near line 199).
- **Importer:** `apps/server/src/gifs/routes.ts`. **Tests:** `apps/server/src/gifs/gifs.test.ts` and `apps/server/src/gifs/routes.test.ts`.
- **The reference conversion** is `apps/server/src/voice-transcription/pipeline.ts`, plus the guide's notes.

### What to build
1. **Rewrite `call` and `fetchGiphyApi`** in Effect:
   - an `Effect.gen` for resolve → filter → fetch → parse;
   - the https request as an interruptible effect whose finalizer destroys the request;
   - the timeout through `Effect.timeoutOrElse`.
   
   **Keep the exact address-order behaviour** and every failure ending in `GiphyError` at the Promise edge.
2. **Exports:** every export keeps its name, type and Promise signature. `GiphyError` stays an `Error` class. `parseGiphyResponse` and `createFakeGifProvider` stay plain.
3. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/gifs/giphy.effect.test.ts`, for example: a resolver failure gives `GiphyError`, and the timeout gives `GiphyError`.
4. **Report:** give the line counts before and after, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/gifs/giphy.ts`, `apps/server/src/gifs/gifs.test.ts`.

### Allowed files
`apps/server/src/gifs/giphy.ts`, `apps/server/src/gifs/giphy.effect.test.ts`, `work/T-0485-effect-giphy.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs
pnpm gate
```

### Acceptance
- The Giphy provider runs on Effect inside, with identical exports and behaviour.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted the Giphy provider to run on Effect inside, with the same exports and Promise API:

- `apps/server/src/gifs/giphy.ts`: rewrote the async core.
  - `call` is now an `Effect.fnUntraced` generator: resolve → filter addresses →
    fetch → status check → JSON parse → `gifPageSchema.parse(parseGiphyResponse(...))`.
  - `fetchGiphyApi` became `giphyRequestEffect`, the pinned https GET as an
    interruptible `Effect.callback`. The registration function returns a cleanup
    effect (`req.destroy()`), which is the finalizer that runs when
    `Effect.timeoutOrElse` interrupts the request; a custom injected `fetcher` is
    lifted with `Effect.tryPromise`.
  - Every failure funnels into a private `GiphyRequestFailed` (`Data.TaggedError`)
    and is mapped at the Promise edge with `Effect.catchTags` to the unchanged
    `GiphyError` (still an `Error` subclass, same neutral message).
  - Exports are unchanged: `GIPHY_MEDIA_HOSTS`, `GIPHY_API_HOST`, `GiphyRating`,
    `parseGiphyResponse`, `GiphyProviderOptions`, `GiphyError`, `GiphyFetcher`,
    `createGiphyProvider`, `createFakeGifProvider`. `parseGiphyResponse` and
    `createFakeGifProvider` stay plain.
- Added `apps/server/src/gifs/giphy.effect.test.ts` (new file): a resolver failure
  and a hung fetch (timeout) both settle as `GiphyError`. No network; fake timers
  drive the 10 s timeout.
- Existing tests (`gifs.test.ts`, `routes.test.ts`) are untouched.

Line counts: `giphy.ts` 368 → 407 lines; new `giphy.effect.test.ts` 34 lines.

### Files changed

- `apps/server/src/gifs/giphy.ts` (Allowed)
- `apps/server/src/gifs/giphy.effect.test.ts` (Allowed, new)
- `work/T-0485-effect-giphy.md` (Allowed)

### Commands run (real results)

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/gifs/giphy.effect.test.ts`
  → 1 file passed, 2 tests passed (779ms).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/gifs/gifs.test.ts src/gifs/routes.test.ts`
  → 2 files passed, 25 tests passed (21.02s).
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (50.5s)
  PASS  lint  (1.9s)
  PASS  typecheck  (1.4s)
  PASS  tests @zilar/server  (1253.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  `--changed main` transitively selects almost the whole server suite (giphy is
  imported through the app graph), and the shared machine was under load average
  ~28–49 from parallel workers, so the test step took ~21 min. The gate passed.

### Effect 4 notes / surprises

- `Effect.callback`'s registration returns a cleanup effect that runs on
  interruption; that is the "finalizer destroys the request" the spec asked for,
  so no `Scope`/`acquireRelease` was needed.
- The default clock uses the ambient global `setTimeout`, so `vi.useFakeTimers()`
  fast-forwards `Effect.timeoutOrElse` directly. (The existing pipeline test uses
  `TestClock.adjust` but its inner `Effect.runPromise` still waits out the real
  20 s; the fake-timer route keeps this new test at <1 s.)
- The `Effect.fnUntraced` generator needs its `Effect.fn.Return<...>` annotation,
  otherwise the error channel widens and `catchTags` stops typechecking.

### Deviations from the spec / behaviour notes

- Timeout scope: the old `req.setTimeout(10_000)` was a socket-inactivity timeout
  that applied only to the built-in fetcher. The new `Effect.timeoutOrElse` is a
  single total-duration timeout that wraps whichever `fetchApi` returns. In
  production no `fetcher` is injected (`routes.ts` builds the provider from config
  only), so the real adapter keeps its 10 s budget; only injected fakes now also
  get a hard 10 s cap, which is what makes the timeout test possible. This is the
  only intentional behaviour nuance.
- JSON/`gifPageSchema.parse` failures: a schema throw inside the generator becomes
  a defect and rejects with the original error, exactly as the old `await` did
  (`parseGiphyResponse` already returns schema-valid pages, so this never fires in
  practice).

### Open questions

None.

## Review (written by Claude)

Approved (lead, 2026-10-07). The Giphy provider runs on Effect: resolve, filter, pinned https fetch (interruptible, finalizer destroys the request, timeoutOrElse), then parse. The address order is kept, and every failure is GiphyError at the edge. The existing gifs tests are untouched. Pre-review clean (verified on head 2951206).
