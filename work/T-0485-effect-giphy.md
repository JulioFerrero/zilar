---
id: T-0485
title: "Effect convert: Giphy provider (DNS pin, pinned https GET with timeout and cap, address fallback) in Effect, Promise API unchanged"
status: todo
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

## Review (written by Claude)
