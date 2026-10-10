---
id: T-1063
title: "Mock H2-1 (mobile): AIs, AI memory, audit and tools run on @zilar/mock-backend through mockFetch"
status: merged
milestone: M5
branch: task/T-1063-mobile-ais-on-mock-backend
model: auto
effort: default
depends_on: [T-1061]
estimate: 0.25 day
---

# T-1063: Mobile AI screens on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §2, slice H2-1. T-1061 did the same for approvals, and added `export const mockToken` to `apps/mobile/src/mock/gate.ts`. The lead read main (2026-10-10).

**Four hooks still pick old mocks:**
- `apps/mobile/src/components/ais/use-ais-api.ts:28-41` (`@/mock/ais`, with named scenarios);
- `use-ai-memory-api.ts:54-63` (`@/mock/ai-memory`);
- `use-audit-api.ts` (`@/mock/audit`);
- `use-tools-api.ts` (`@/mock/tools`).

**The ids disagree.** The old AIs mock lists `ai-dev-1` and `ai-marketing-1`, while the backend has `ai-dev-1`, `ai-qa-1` and `ai-marketing` (`packages/mock-backend/src/domains/ais/seed.ts:19,33,47`). So `GET /ais/ai-marketing-1/approval-rules` answers 404, and Settings › Approvals shows "Could not load the rules." (lead phone smoke, T-1061).

**The factories already take a fetch:** `createAisApi`, `createAiMemoryApi`, `createAuditApi` and `createToolsApi` each take `(getToken, fetchImpl, apiUrl)`:
- `apps/mobile/src/lib/ais-api.ts:114-117`
- `lib/ai-memory-api.ts:38-41`
- `lib/audit-api.ts:36-39`
- `lib/tools-api.ts:158-161`

**The only reader of the scenario:** `apps/mobile/src/components/ais/require-ais-auth.tsx:13-14` reads `useAisApi().scenario` to skip the auth guard in mock mode.

### What to build
0. **Probe first.** Mobile mock mode has no fallback: a request the backend does not answer becomes a 404 (`apps/mobile/src/mock/backend.ts:37`).
   - Before switching a hook, list every method and path its client factory calls, and probe each one with a throwaway script against `createMockBackend({ delayMs: 0 }).http(path, init)`. Do not commit the script.
   - Switch a hook only when every call gets a `Response`. Otherwise leave that hook on its old mock, and list the missing routes in the Report.
1. **The adapters:** in each of the four hooks, the mock branch builds the real factory with `(mockToken, mockFetch, API_URL)`, the way `apps/mobile/src/components/chat/use-approvals-api.ts` does after T-1061:
   - `mockToken` comes from `@/mock/gate`, and `API_URL` from `@/lib/auth`;
   - `mockFetch` is loaded with the guarded `require('@/mock/backend')` inside the build-time condition, so release builds still leave the mock out.
2. **`use-ais-api.ts`:** drop the named scenarios. Julio, 2026-10-10 (mock-plan Q2): the `?mock=` scenarios are rebuilt on the seed, not kept.
   - The handle becomes `{ api, mock: boolean }`, with the same gate rule the other hooks use: on when `?mock=` (where allowed) or `EXPO_PUBLIC_ZILAR_MOCK` is set and not `''`, `'0'` or `'false'`.
   - Update `require-ais-auth.tsx` to read `mock`. Check with grep that nothing else reads `.scenario` from `useAisApi`.
3. **No deletions.** Do not delete `apps/mobile/src/mock/{ais,ai-memory,audit,tools}.ts`; that is a later slice. Say in the Report whether each one is still imported.
4. **No other change.**

The lead runs a phone smoke in mock mode:
- the AIs tab, and an AI's page (memory, tools, activity);
- Settings › Approvals, where "Always allowed" should load with no error.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md` §2, `apps/mobile/src/components/chat/use-approvals-api.ts` (the pattern), the four hooks, `apps/mobile/src/components/ais/require-ais-auth.tsx`, and `apps/mobile/src/mock/gate.ts`.

### Allowed files
`apps/mobile/src/components/ais/use-ais-api.ts`, `apps/mobile/src/components/ais/use-ai-memory-api.ts`, `apps/mobile/src/components/ais/use-audit-api.ts`, `apps/mobile/src/components/ais/use-tools-api.ts`, `apps/mobile/src/components/ais/require-ais-auth.tsx`, `work/T-1063-mobile-ais-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "@/mock/ais'\|@/mock/ai-memory'\|@/mock/audit'\|@/mock/tools'" apps/mobile/src/components/ais` prints nothing.

---

## Report (written by the worker when done)

### What I did

Moved the four AI-group hooks off their old per-domain mocks and onto the
shared `@zilar/mock-backend` through `mockFetch`, following
`components/chat/use-approvals-api.ts` (T-1061).

- `use-ais-api.ts`: dropped the named scenarios (`AisMockScenario`, `MOCK_ENV`,
  `aisMockScenario`). The handle is now `{ api, mock: boolean }`, gated by the
  same rule as the other hooks (`?mock=` where `mockParamAllowed` opens it, or
  `EXPO_PUBLIC_ZILAR_MOCK`; `''`, `'0'` and `'false'` opt out). The mock branch
  builds `createAisApi(mockToken, mockFetch, API_URL)`.
- `use-ai-memory-api.ts`, `use-audit-api.ts`, `use-tools-api.ts`: same swap in
  their mock branch (`createAiMemoryApi` / `createAuditApi` / `createToolsApi`
  with `(mockToken, mockFetch, API_URL)`). Their `{ api, mock }` handle and gate
  helpers are unchanged.
- `require-ais-auth.tsx` now reads `{ mock }` instead of `{ scenario }`.

`mockFetch` is loaded with the guarded `require('@/mock/backend')` inside the
`if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)` build-time condition, so a
release build still folds it away. `mockToken` comes from `@/mock/gate` and
`API_URL` from `@/lib/auth`.

### Probe (throwaway, not committed)

I created a temporary vitest file in `packages/mock-backend` that called
`createMockBackend({ delayMs: 0 }).http(path, init)` for every method/path the
four factories use (fresh backend per probe), then deleted it before the gate.

Result: all 23 probes returned a `Response` (no route missing). Grouped:

- ais: `GET /api/ais` 200, `POST /api/ais` 201, `PATCH /api/ais/ai-dev-1` 200,
  `DELETE /api/ais/ai-dev-1` 204, `GET /api/connections` 200,
  `POST /api/ais/ai-dev-1/stop` 200, `POST /api/ais/ai-dev-1/resume` 200.
- ai-memory: `GET /api/ai-memory?chat=&ai=` 200,
  `DELETE /api/ai-memory/facts/:id?chat=&ai=` 200,
  `POST /api/ai-memory/clear` 200.
- audit: `GET /api/audit?aiId=&limit=20` 200.
- tools/routines: `GET /api/ais/ai-dev-1/tools` 200,
  `GET /api/ais/ai-dev-1/routines` 200,
  `POST /api/routines/:id/pause` 200, `POST /api/routines/:id/resume` 200,
  `DELETE /api/routines/:id` 204, `GET /api/tools/:id` 200,
  `GET /api/tools/:id/versions` 200, `GET /api/tools/:id/versions/:n` 200,
  `GET /api/tools/:id/runs` 200, `POST /api/tools/:id/revert` 200,
  `POST /api/tools/:id/run` 200, `DELETE /api/tools/:id` 204.

So every hook could move; none was left on its old mock. The tools/routines/
audit seeds are keyed to `ai-dev-1`, so the lead's "an AI's page" smoke should
show data on the Dev-1 AI.

### The four old mock files (still present, no deletions)

`grep -rn "mock/ais|mock/ai-memory|mock/audit|mock/tools" apps/mobile` now finds
only a comment in `components/contacts/contacts-mock.ts` that names
`mock/ais.ts` as a pattern. So:

- `apps/mobile/src/mock/ais.ts` — no longer imported.
- `apps/mobile/src/mock/ai-memory.ts` — no longer imported.
- `apps/mobile/src/mock/audit.ts` — no longer imported.
- `apps/mobile/src/mock/tools.ts` — no longer imported.

They are left in place for the later deletion slice (M2).

### Files changed

- `apps/mobile/src/components/ais/use-ais-api.ts`
- `apps/mobile/src/components/ais/use-ai-memory-api.ts`
- `apps/mobile/src/components/ais/use-audit-api.ts`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `apps/mobile/src/components/ais/require-ais-auth.tsx`
- `work/T-1063-mobile-ais-on-mock-backend.md`

### Commands and results

- `pnpm install` — done, 15 workspace projects, no errors.
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/probe-temp.test.ts`
  — 1 passed (probe; file deleted afterwards). No other single test file exists
  near the change (the ais hooks have no tests; UI code gets no tests).
- `grep -rn "@/mock/ais'\|@/mock/ai-memory'\|@/mock/audit'\|@/mock/tools'" apps/mobile/src/components/ais`
  — no output (exit 1), acceptance met.
- `pnpm gate` — summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

None. I did not touch anything outside the Allowed files. No open questions.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **The change:** `use-ais-api`, `use-ai-memory-api`, `use-audit-api` and `use-tools-api` now build their real factories with `(mockToken, mockFetch, API_URL)` on `@zilar/mock-backend` in mock mode, behind the guarded `require`.
  - The worker's probe of all 23 client calls got a `Response` for every one, so no hook stayed on its old mock.
  - The named AIs scenarios are gone (Julio, mock-plan Q2). The handle is now `{ api, mock }`, and `require-ais-auth.tsx` reads `mock`.
- **The lead's phone smoke** (mock):
  - **the AIs tab** lists the backend's Dev-1, QA-1 and Marketing AI;
  - **Dev-1's page** shows the edit form, Memory, Tools (prices v2, notes v2), Routines (Morning prices active, Standup notes paused) and Activity;
  - **Settings › Approvals** shows the `apr-42` card, and "Always allowed" now loads with no error ("Nothing is always allowed here."). Before this task, the id mismatch made it read "Could not load the rules." (T-1061 smoke).
- **Check:** the gate passed.
