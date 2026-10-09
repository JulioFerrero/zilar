---
id: T-0800
title: "F3 + F4: mobile Effect toolkit — apps/mobile/src/lib/effect/{runtime,errors,api-effect,use-action,use-query}.ts mirroring the web toolkit, FetchHttpClient checked on Hermes via expo export (decision D6), tests for each"
status: todo
milestone: M5
branch: task/T-0800-mobile-effect-toolkit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0800 (F3 + F4): the mobile Effect toolkit

## Spec (written by Claude, do not edit)

### Why
This is Phase 1 of `docs/audit/effect-100-plan.md` (tasks F3 and F4, plan lines 326-327), accepted by Julio on 2026-10-09. Every mobile UI task (MU1 to MU25) and the mobile store (MS1+) build on it. Julio chose one worker per chain, so F3 and F4 are one task.

### Verified facts (do not re-derive)
- **The web toolkit to mirror** is in `apps/web/src/lib/effect/`: `runtime.ts`, `errors.ts`, `api-effect.ts`, `use-action.ts` and `use-query.ts`, each with a test. In detail:
  - `runtime.ts` builds `webLayer = FetchHttpClient.layer` (from `effect/http`), `webRuntime = ManagedRuntime.make(webLayer)`, `runWeb` and `webAtomRuntime = Atom.runtime(webLayer)` (`Atom` from `effect/reactivity`);
  - `errors.ts` has `ApiFailure` (a `Data.TaggedError` with status, code, message and detail), `toApiFailure` and `isApiFailureCode`;
  - `api-effect.ts` has `fromApi(call)`, which is `Effect.tryPromise({ try: call, catch: toApiFailure })`.
- **Mobile already runs `effect/reactivity` on Hermes:** `apps/mobile/src/store/atomStore.ts:1` imports `Atom` and `AtomRegistry`, and the app ships with it. So `Atom` itself is known to work on the device; `FetchHttpClient` is not checked yet.
- **Mobile API errors** are per-module classes with the same shape, `status`, `code` and `message` (for example `ChatApiError`, `apps/mobile/src/lib/chat-api.ts:107-116`; also `AisApiError`, `AuthApiError` and others in `apps/mobile/src/lib/*-api.ts`). `toApiFailure` must read any error with numeric `status` and string `code` and `message` (duck-typed), not one class.
- **The `@/*` alias** maps to `apps/mobile/src/*` (`apps/mobile/tsconfig.json:5-7`).
- **The Hermes check:** `pnpm --filter @zilar/mobile build` runs `expo export --platform ios --platform android --output-dir dist` (`apps/mobile/package.json:13`). A bundle that uses an API Hermes lacks fails there or at start. `pnpm phone:smoke` (root `package.json:30`) is run by the lead on the emulator, not by you.
- **Decision D6** (plan line 503): use `FetchHttpClient` on mobile only if the Hermes check passes. Otherwise mobile keeps `Effect.tryPromise` over `fetch`, and `mobileLayer` is `Layer.empty`.

### What to build
1. **`apps/mobile/src/lib/effect/runtime.ts`:** `mobileLayer = FetchHttpClient.layer`, `mobileRuntime`, `runMobile` and `mobileAtomRuntime`, shaped like the web file.
2. **`errors.ts` and `api-effect.ts`:** the same `ApiFailure`, `toApiFailure` (duck-typed, as above) and `fromApi`.
3. **`use-action.ts` and `use-query.ts`:** copy the web hooks' behaviour and API exactly (modes, `failureOf`, `isWaiting`, `refresh`, interrupt on unmount). Use React Native-safe code only (no DOM).
4. **Tests next to each file** (`*.test.ts` / `*.test.tsx`), modelled on the web tests, run with the mobile vitest config.
5. **The Hermes check:** import the runtime once from app code so it is in the bundle (for example in `apps/mobile/src/app/_layout.tsx`: `void mobileRuntime`, or use it for nothing more than that). Then run `pnpm --filter @zilar/mobile build` and record the bundle size before and after (`du -sh apps/mobile/dist`).
   - If the export fails because of `FetchHttpClient`, switch to `Layer.empty` per D6 and say so in the Report.
   - Delete `apps/mobile/dist` afterwards if it is not ignored (check `git status`).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/web/src/lib/effect/`, `apps/mobile/src/store/atomStore.ts`, `apps/mobile/src/lib/chat-api.ts:100-120`, `apps/mobile/vitest.config.mts`, `apps/mobile/src/app/_layout.tsx`.

### Allowed files
`apps/mobile/src/lib/effect/runtime.ts`, `apps/mobile/src/lib/effect/errors.ts`, `apps/mobile/src/lib/effect/errors.test.ts`, `apps/mobile/src/lib/effect/api-effect.ts`, `apps/mobile/src/lib/effect/api-effect.test.ts`, `apps/mobile/src/lib/effect/use-action.ts`, `apps/mobile/src/lib/effect/use-action.test.tsx`, `apps/mobile/src/lib/effect/use-query.ts`, `apps/mobile/src/lib/effect/use-query.test.tsx`, `apps/mobile/src/app/_layout.tsx`, `work/T-0800-mobile-effect-toolkit.md`.

### Checks (wave mode: your own tests only, see `docs/EFFECT_BRIEF.md`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/effect
pnpm --filter @zilar/mobile exec tsc --noEmit -p .
pnpm --filter @zilar/mobile build
```

### Acceptance
- The five files exist with tests that pass 3 of 3 runs, and the mobile typecheck is clean.
- `expo export` succeeds, and the Report gives the bundle size before and after and the D6 outcome.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
