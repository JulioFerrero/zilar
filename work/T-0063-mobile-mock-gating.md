---
id: T-0063
title: Mobile honors the `?mock=` route param only in dev builds (or with EXPO_PUBLIC_GALENA_MOCK), for the chat store and My AIs
status: review
milestone: M2
branch: task/T-0063-mobile-mock-gating
model: opencode-go/deepseek-v4.1-flash
depends_on: []
estimate: 0.5 day
---

# T-0063: Gate mobile mock mode

## Spec (written by Claude, do not edit)

### Goal

Today any deep link such as `galena://ais?mock=1` or `galena://chat/x?mock=1` switches a **production** build to fake data (found in the T-0037 pre-review, listed on the board under Follow-ups). Fake chats and fake AIs in a real build are confusing and could be used to spoof what the user sees. The `?mock=` param must only be honored when the build is a dev build (`__DEV__`) or when `EXPO_PUBLIC_GALENA_MOCK` is set at bundle time. Everything else uses the real store and the real API.

### Read first
- `AGENTS.md` (mandatory)
- `apps/mobile/src/store/chat-store.ts` (`isMockMode`), `chat-store-provider.tsx`
- `apps/mobile/src/mock/ais.ts` (`aisMockScenario`) and `apps/mobile/src/mock/ais.test.ts`
- `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx`
- Every other place that reads a `mock` route param: `grep -rn "'mock'" apps/mobile/src apps/mobile/app`

### Allowed files (under `apps/mobile/`)
- `src/store/chat-store.ts`, `src/store/chat-store-provider.tsx`, plus their tests
- `src/mock/ais.ts`, `src/mock/ais.test.ts`
- `src/mock/gate.ts` (new), plus `src/mock/gate.test.ts` (new)
- `src/components/ais/use-ais-api.ts`, `src/components/ais/require-ais-auth.tsx`
- `work/T-0063-mobile-mock-gating.md`

**Not allowed:** `apps/web/**`, `apps/server/**`, `packages/**`, `docs/**`, other files. No new dependencies. If another file reads the `mock` param, list it in the Report instead of editing it.

### What to build

1. **One gate (`src/mock/gate.ts`).** A pure function `mockParamAllowed(env: { dev: boolean; envMock: string | undefined }): boolean` that returns true when `dev` is true, or when `envMock` is a non-empty value other than `'0'` and `'false'`. Callers pass `dev: __DEV__` and `envMock: process.env.EXPO_PUBLIC_GALENA_MOCK` (written as a static `process.env.EXPO_PUBLIC_*` expression so Metro inlines it; see the comment in `use-ais-api.ts`). Tests: dev on/off × env unset, `'1'`, `'0'`, `'false'`, `''`.
2. **Chat store.** `isMockMode(params)`: keep the `NODE_ENV === 'test'` and `EXPO_PUBLIC_GALENA_MOCK === '1'` behavior, but read the `?mock=1` param only when the gate allows it. Tests: with the gate closed, `?mock=1` returns false; with it open, true.
3. **My AIs.** `aisMockScenario(env, params)`: ignore `params` when the gate is closed (the env var path stays as is). Give the function what it needs (for example an extra `paramAllowed` argument, or fold the gate into `env`), and keep the existing tests green. Add tests: gate closed + `?mock=default` → `null`; gate open → the scenario.
4. `use-ais-api.ts` and the store provider pass the real `__DEV__` and env values. In a production bundle with neither set, mock code paths must be unreachable from a deep link.

### Acceptance criteria
- [ ] A deep link `?mock=…` does nothing in a build where `__DEV__` is false and `EXPO_PUBLIC_GALENA_MOCK` is unset (proved by unit tests on the gate and both call sites).
- [ ] Dev builds and `EXPO_PUBLIC_GALENA_MOCK=1` behave exactly as before (existing tests pass unchanged, or with the smallest edit the new argument needs).
- [ ] `EXPO_PUBLIC_GALENA_MOCK=false` or `0` never enables mock mode.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Removing mock code from the production bundle (tree-shaking).
- Web mock handling.
- Any screenshots or simulator work; do not touch simulators or Metro on 8081/8082.

---

## Report (written by the worker when done)

### What I did
- Added one pure gate, `mockParamAllowed({ dev, envMock })` in `src/mock/gate.ts`, that is true in a dev build or when `EXPO_PUBLIC_GALENA_MOCK` is a non-empty value other than `'0'`/`'false'`.
- `isMockMode` (chat store) now keeps the `NODE_ENV === 'test'` and `EXPO_PUBLIC_GALENA_MOCK === '1'` short-circuits, but only reads the `?mock=1` param when the gate is open. The build values are injected through a new optional `MockEnv` argument (`{ dev, envMock, nodeEnv }`), defaulting to the real `__DEV__` / `process.env` values. `__DEV__` is read as `typeof __DEV__ !== 'undefined' && __DEV__` so Vitest (which has no React Native global) does not throw.
- `ChatStoreProvider` passes the real `__DEV__` and env values to `isMockMode`.
- `aisMockScenario(env, params, paramAllowed = false)` ignores the route param when the gate is closed; the `EXPO_PUBLIC_GALENA_MOCK` path is unchanged. `useAisApi` computes `mockParamAllowed({ dev: __DEV__, envMock: process.env.EXPO_PUBLIC_GALENA_MOCK })` and passes it.

### Files changed
- `apps/mobile/src/mock/gate.ts` (new): the gate.
- `apps/mobile/src/mock/gate.test.ts` (new): dev on/off × env unset, `'1'`, `'default'`, `'0'`, `'false'`, `''`.
- `apps/mobile/src/store/chat-store.ts`: `isMockMode(params, env)` gated, plus `MockEnv`/`currentMockEnv`.
- `apps/mobile/src/store/chat-store.test.ts`: `isMockMode` tests (gate closed → false; dev / env default → true; `'false'`/`'0'` → false; test & `=1` modes stay on).
- `apps/mobile/src/store/chat-store-provider.tsx`: passes real `dev`/`envMock`/`nodeEnv`.
- `apps/mobile/src/mock/ais.ts`: new `paramAllowed` argument.
- `apps/mobile/src/mock/ais.test.ts`: existing param cases pass `true` (smallest edit the new argument needs); added gate-closed → `null`, gate-open → scenario, and env-path-stays tests.
- `apps/mobile/src/components/ais/use-ais-api.ts`: passes the gate result.
- `work/T-0063-mobile-mock-gating.md`: status + this report.

### Commands run and real results
- `pnpm install`: `Done`, 1010 packages, no changes to `pnpm-lock.yaml`.
- `pnpm format:check`: **PASS** — "All matched files use Prettier code style!".
- `pnpm lint`: **PASS** — oxlint, no output, exit 0.
- `pnpm typecheck`: **PASS** — 9/9 turbo tasks successful.
- `pnpm test`: **PASS** — 9/9 turbo tasks successful; `@galena/mobile`: 24 files passed, 2 skipped; 217 tests passed, 2 skipped. New: `gate.test.ts` 1, `chat-store.test.ts` 14 (incl. 4 `isMockMode`), `ais.test.ts` 15 (incl. 3 gating).
- `pnpm build`: **PASS** — expo export produced iOS (7.5 MB) and Android (7.8 MB) Hermes bundles.

### Problems, deviations from the spec, open questions
- Spec wrote `isMockMode(params)`; I added an optional second `env` argument so the store provider can pass the real build values (step 4) and so the gate is unit-testable without stubbing globals or mutating `process.env`. The default reproduces the real values, so behavior is unchanged for callers that omit it.
- `aisMockScenario`'s new `paramAllowed` defaults to `false` (fail-closed); the existing tests were updated to pass `true`, which is the "smallest edit the new argument needs" the spec allows.
- No other file under `apps/mobile` reads a `mock` route param (verified by grep on `apps/mobile/src` and the `src/app` router dir), so nothing extra to list.

### Blocked / needs a decision
- None.


---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
