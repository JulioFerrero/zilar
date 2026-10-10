---
id: T-1063
title: "Mock H2-1 (mobile): AIs, AI memory, audit and tools run on @zilar/mock-backend through mockFetch"
status: todo
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

## Review (written by Claude)
