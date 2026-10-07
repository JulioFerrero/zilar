---
id: T-0484
title: "Effect convert: web-tools guarded GET (DNS pin, deadline + idle timeout, capped read) in Effect, Promise API unchanged"
status: todo
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

## Review (written by Claude)
