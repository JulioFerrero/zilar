---
id: T-0173
title: Effect 4.0 spike on the voice transcription pipeline, and a guide for workers
status: merged
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
pnpm gate
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

### What I did

Converted the transcript pipeline in `apps/server/src/voice-transcription/`
to Effect 4.0 with identical behaviour:

- New `pipeline.ts`: the fetch/transcribe/store pipeline as Effect code
  (typed `Data.TaggedError`s, `timeoutOrElse` timeouts, single-flight map),
  with `Effect.runPromise` at the edge. Public functions keep `Promise`
  signatures.
- `routes.ts`: Hono handlers, zod validation, drizzle queries unchanged;
  now delegates to `fetchAndTranscribe` / `shareInFlight` /
  `defaultAudioFetcher` / `defaultTranscriber` from `pipeline.ts`.
  `AudioUnavailableError`, `FetchedAudio`, `AudioFetcher`, `Transcriber`,
  `VOICE_FETCH_TIMEOUT_MS`, `VOICE_TRANSCRIPT_MAX_BYTES` are re-exported so
  existing importers keep working. `provider.ts` / `settings.ts` untouched.
- Added `effect@4.0.0` (`^4.0.0`, matching the pinned-`^` style of the other
  deps) to `apps/server` — the only new dependency.
- New `pipeline.test.ts`: 7 added tests (single-flight sharing, failure
  releases the entry, interrupted waiter releases the entry, fetch-rejection
  mapping, per-error HTTP mapping, timeout preemption, TimeoutError
  recognition). Existing `routes.test.ts` / `provider.test.ts` unchanged.
- New `docs/EFFECT_GUIDE.md`: the idioms actually used here, pointing at
  `docs/effect-reference/` for the rest.

### Files changed

- `apps/server/package.json` (+1 dep), `pnpm-lock.yaml`
- `apps/server/src/voice-transcription/pipeline.ts` (new, 311 lines)
- `apps/server/src/voice-transcription/pipeline.test.ts` (new, 160 lines)
- `apps/server/src/voice-transcription/routes.ts` (639 → 486 lines)
- `docs/EFFECT_GUIDE.md` (new), `work/T-0173-effect-spike.md` (this Report)

### Measurements

- Lines: before 870 (`routes.ts` 639 + `provider.ts` 140 + `settings.ts`
  91); after 1028 (`routes.ts` 486 + `pipeline.ts` 311 + `provider.ts` 140
  + `settings.ts` 91). Net +158, all of it the new pipeline module plus
  typed errors; the route file shrank by 153 lines.
- Tests: 30 before (25 routes + 5 provider), 37 after (+7 new pipeline
  tests). All 30 pre-existing tests pass UNCHANGED.
- `effect@4.0.0` on disk (pnpm store): 53M unpacked. Server has no `build`
  script (`pnpm --filter @zilar/server build` answers
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`, same as on main), so there is no
  server build output size to compare; `tsc --noEmit` passes and the module
  is server-only (no web/mobile bundle impact).
- Effect concepts a reader must know to follow `pipeline.ts`: `Effect.gen`
  + `yield*`, `Effect.fnUntraced` + `Effect.fn.Return`, `Data.TaggedError`,
  `Effect.tryPromise`, `Effect.timeoutOrElse` + `Duration`,
  `Effect.catchTags`, `Cause.die` / `Effect.orDie` (defects stay defects),
  `Effect.runPromise` (the Promise boundary). 8 concepts.
- Honest notes: `Effect.catch` (v3 `catchAll`) exists at runtime but is
  exported via `export { catch_ as catch }`, which this repo's
  `moduleResolution: bundler` tsc does not pick up — use `catchTag` /
  `catchTags` instead. `Effect.tryPromise`'s `catch` mapper must return a
  typed error for every input (re-throwing makes the error `Cause<never>`
  and breaks `catchTags` under `exactOptionalPropertyTypes`). There is no
  `timeoutFail` in v4 — `timeoutOrElse` is the typed way. `acquireRelease`
  needs a `Scope`, so the single-flight cleanup stays a plain-Map `.then`
  cleanup (documented in the guide). `Effect.fn.Return` annotations are
  required on every generator or the error channel widens.

### Recommendation: go with changes

The conversion is faithful (30/30 unchanged tests green, sentinel tests
green, 401 sweep green) and the guide records the sharp edges above. For
the series: keep the Promise-boundary + no-layers-for-one-function rules,
and fix the two guide gaps first (the `catch` export quirk, the
tryPromise-mapper-must-not-throw rule). Server-side conversions next; web
and mobile should wait until bundle size is measured (recommended: yes).

### Commands (real results)

- `pnpm install`: done (9.8s earlier session; 0.8s frozen in gate).
- `pnpm prettier --write` on the 3 touched source files: pass.
  `pnpm format:check`: FAILS repo-wide on `CLAUDE.md`, a file outside my
  Allowed files that I did not touch (its worktree text differs from
  `main`, where it passes; the diff is the lead's own table reformat).
- `pnpm lint` (oxlint): pass.
- `pnpm --filter @zilar/server typecheck`: pass (after fixing one
  `Exit.cause` narrowing in the new test).
- `pnpm --filter @zilar/server test --maxWorkers=2 src/voice-transcription
  src/authz-sweep.test.ts`: 4 files, 42 passed (30 pre-existing module
  tests unchanged + 7 new pipeline tests + 5 sweep tests; 139 /api routes
  swept).
- `pnpm --filter @zilar/server build`: no such script (same as main;
  server ships via `tsx`, typechecked not bundled).
- `pnpm gate`: `gate: 7 changed file(s) against main` / `PASS install
  (frozen)` / `FAIL format` (only on the untouched `CLAUDE.md`) /
  `scope: every changed file is inside the Allowed files` / `GATE FAIL`.
  Everything within my Allowed files passes; the single FAIL is the
  pre-existing `CLAUDE.md` formatting drift described above, which I may
  not touch (`AGENTS.md` forbids editing non-task files; formatting it
  would add an out-of-scope change).

### Lead nits round (4 items, one commit each)

- Item 1 (`e70348d9`): guide timeout sentence now states only what the code
  does (interrupted; no finalizers here; `acquireRelease` for future
  pipelines with resources).
- Item 2 (`51115a97`): library-only timeout block replaced with one test
  that calls `fetchAndTranscribe` with a never-resolving fetcher under
  `TestClock` and asserts 502 `audio_unavailable` (~20s wall, virtual time).
  A provider-side twin was probed but dropped: `fetchAndTranscribe` wraps
  both legs in one outer `Effect.promise`, so virtual time cannot reach the
  inner 60s sleep without real waiting — recorded here so nobody retries it
  blindly. Suite now 43 passed (30 pre-existing unchanged + 8 pipeline + 5
  sweep).
- Item 3 (`ea2a511a`): trivial `starts` assertion removed; the test now
  asserts the fresh tap resolves and `size()` returns to 0.
- Item 4 (`27ef466c`): "(finding 4: ...)" removed from the shipped comment.
- `pnpm --filter @zilar/server test --maxWorkers=2 src/voice-transcription
  src/authz-sweep.test.ts`: 4 files, 43 passed.
- `pnpm gate`: `gate: 7 changed file(s)` / PASS install, format, lint,
  typecheck, tests @zilar/server / `scope: every changed file is inside the
  Allowed files` / `GATE PASS`. (One self-inflicted hiccup on the way: a
  probe file from a timed-out shell survived as
  `apps/server/probe-real.tmp.mjs` and failed the gate's format+scope;
  deleted, never staged.)

### Round: pre-review fix (finding 1)

- Fixed must-fix finding 1: the store leg used `tryPromise({ catch:
  Cause.die })` + `orDie`, which double-wraps rejections so `runPromise`
  rejects with an opaque `Cause` instead of the original drizzle error. The
  store leg now lifts drizzle promises with plain `Effect.promise`
  (`awaitDb`); the transcribe leg squashes the cause and re-checks with
  `instanceof` (provider refusal → typed error, anything else dies with the
  original value). Root cause: `tryPromise`'s mapper receives the rejection
  and `Cause.die` wraps the whole `Cause` again — verified with runtime
  probes before fixing.
- Tests added (2): DB drop rejects with the identical error
  (`toBe(dbDown)`); unexpected transcriber throw rejects identical
  (`toBe(kablam)`). Suite now 44 passed (was 42).
- Findings 2–5 are nits in lines I did not otherwise change; per the fix
  instructions I left them untouched, and I record no disagreements (all
  four nits read correctly).
- `docs/EFFECT_GUIDE.md` updated with the no-double-wrap rule (second
  commit); the previously false claim now matches the code.
- Gate: `gate: 8 changed file(s)` / `PASS install (frozen)` / `FAIL
  format` (only the untouched `CLAUDE.md`, pre-existing upstream drift
  confirmed by the pre-reviewer) / `scope: 1 file(s) outside the Allowed
  files: PREREVIEW.md` (the lead's review file at the worktree root, not
  mine — untracked, never staged or committed) / `GATE FAIL`. Everything
  within my Allowed files passes; both FAIL lines reference files I may not
  touch.

### Security checklist

- Sentinel tests pass unchanged: key, URL and transcript text reach no
  logs, audit rows or error bodies (typed errors carry no payload; audit
  carries the URL hash only).
- Deletes/updates still scoped (advisory lock + re-check + insert
  untouched, still inside one transaction, never across the network).
- No new routes (401 sweep: 139 routes, all voice routes 401 without
  session); rate limits and caps unchanged.

## Review (written by Claude)

**Verdict:** Approved after one automatic round and one lead nits round. The voice transcription pipeline (fetch, size check, provider call, store) now runs as Effect 4.0 programs in `pipeline.ts`, with the routes calling them; behaviour is identical (all 30 old module tests pass unchanged) and defects reject with the original error object, proven with `toBe` tests. `docs/EFFECT_GUIDE.md` is the guide future Effect tasks follow; the lead had its timeout paragraph corrected so it states only what the code does. Secrets and audit unchanged (`urlHash` only); the advisory-lock transaction moved verbatim. New dependency `effect@^4.0.0`, approved by Julio (Effect GO, 2026-10-04). Accepted nits: `VOICE_PROVIDER_TIMEOUT_MS` is exported without an outside user; one timeout test costs about 20 s of real time (candidate for a follow-up when the next Effect task touches this file); the first Report sections quote older test counts, the last section has the right ones (43 passed).
