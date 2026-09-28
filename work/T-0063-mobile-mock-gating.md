---
id: T-0063
title: Mobile honors the `?mock=` route param only in dev builds (or with EXPO_PUBLIC_GALENA_MOCK), for the chat store and My AIs
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
