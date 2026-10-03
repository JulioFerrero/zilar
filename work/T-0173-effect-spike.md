---
id: T-0173
title: Effect 4.0 spike on the voice transcription pipeline, and a guide for workers
status: planned
milestone: M5
branch: task/T-0173-effect-spike
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0170]
estimate: 1 day
---

# T-0173: Effect 4.0 spike on the voice transcription pipeline

## Spec (written by Claude, do not edit)

### Why
Julio wants to try moving the project to Effect (https://effect.website, version 4.0), alternating new features written in Effect with conversions of old code (see `docs/ROADMAP_EFFECT.md`). Before committing to the series we run one contained spike and judge it on facts.

### What to build
1. Add the `effect` dependency (the only new dependency; version 4.x, pinned like our other deps) to `apps/server`.
2. Convert ONE module with identical behaviour: the transcript pipeline in `apps/server/src/voice-transcription/` (fetch the audio with a timeout and size cap, call the provider with a timeout, single-flight per URL hash, cache re-check and insert, the fixed error mapping). Use Effect for the pipeline logic (typed errors, timeouts, interruption, the in-flight map); keep the Hono route handlers, drizzle queries and zod validation as they are. The module's public functions keep their current signatures and return `Promise`s (`Effect.runPromise` at the edge), so callers and the existing tests do not change.
3. The existing tests for the module must pass UNCHANGED. If one cannot, stop and explain in the Report instead of editing it. You may ADD tests for what Effect makes easy (for example an interrupted request releases the in-flight entry).
4. Write `docs/EFFECT_GUIDE.md` for future workers, short and concrete, pointing at `docs/effect-reference/` instead of repeating it, with the idioms you actually used here: when to use `Effect.gen` versus pipes, typed error classes (`Data.TaggedError`) and how they map to our fixed HTTP errors, timeouts and interruption, services and layers only where needed (do not invent layers for a single function), how to test (run effects in Vitest with fakes), what NOT to do (no `any`, no untyped catch-all, never leak secrets in error messages), and the Promise boundary rule.
5. Measurements in the Report: lines before and after, test count before and after, server build output size, number of Effect concepts a reader must know to follow the module, and honest notes on what was awkward.

### Read first
`AGENTS.md`, `docs/ROADMAP_EFFECT.md`, `docs/effect-reference/README.md` and everything it points to (`LLMS.md` and the examples; they are Effect 4 and win over what you remember of v3), `apps/server/src/voice-transcription/` (routes, provider, tests), https://effect.website.

### Allowed files
`apps/server/src/voice-transcription/**`, `apps/server/package.json`, `pnpm-lock.yaml`, `docs/EFFECT_GUIDE.md`, `work/T-0173-effect-spike.md`. Nothing else. (`docs/effect-reference/**` is read-only for you.)

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/voice-transcription src/authz-sweep.test.ts
pnpm --filter @zilar/server build
```

### Acceptance
- Every pre-existing test of the module passes unchanged; behaviour and HTTP answers are identical.
- No secret, URL or provider text reaches logs, audit or errors (the existing sentinel tests still pass).
- `docs/EFFECT_GUIDE.md` exists and matches the code.
- The Report carries the measurements and a plain recommendation: go, go with changes, or stop.

### Out of scope
Any other module, web or mobile code, replacing zod, Effect Schema, Effect's HTTP or platform packages.

---

## Report (written by the worker when done)

## Review (written by Claude)
