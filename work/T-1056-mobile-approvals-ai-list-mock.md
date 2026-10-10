---
id: T-1056
title: "Mobile approvals: list AIs through useAisApi, so 'Always allowed' keeps its rules in mock mode when nothing is pending"
status: todo
milestone: M5
branch: task/T-1056-mobile-approvals-ai-list-mock
model: auto
effort: default
depends_on: [T-1004]
estimate: 0.1 day
---

# T-1056: Approvals AI list through `useAisApi`

## Spec (written by Claude, do not edit)

### Why
The board follow-up from the T-1004 smoke says "Always allowed" shows "Nothing is always allowed here" once the last pending request is decided. The lead read the code (main, 2026-10-10):
- **The rules load is not the problem.** It already fetches rules for every AI the person owns plus the pending ones (`apps/mobile/src/components/approvals/use-approvals.ts:117-160`).
- **The AI list is.** `aiList` (`use-approvals.ts:109-115`) always calls `createAisApi(getSessionToken).listAis()` and ignores the screen's mock switch. The approvals API itself goes through `useApprovalsApi()` (`:40`). In mock mode the real fetch fails, `aiList` swallows the error and returns `[]`, and so only the AIs of pending rows get their rules loaded.
- **The mock-aware AIs API exists:** `useAisApi()` (`apps/mobile/src/components/ais/use-ais-api.ts`) picks `createMockAisApi(scenario)` or `createAisApi(getSessionToken)`, and the mock lists `ai-dev-1`, the same id the approvals mock uses (`apps/mobile/src/mock/approvals.ts:48`).

### What to build
1. **The swap:** in `use-approvals.ts`, get `const { api: aisApi } = useAisApi();` next to `useApprovalsApi()`, and make `aiList` call `aisApi.listAis()` instead of `createAisApi(getSessionToken).listAis()`.
   - Keep the same `Effect.tryPromise` / catch-to-`[]` shape.
   - Drop the `createAisApi` and `getSessionToken` imports if nothing else uses them (`grep` first).
2. **Stability:** `aisApi` comes from `useMemo`, so it is stable. Make sure `runRules` and `runLoad` do not start running on every render because of it. If `aiList` must move inside the action to read `aisApi`, do that.
3. **No other behaviour change.** Real builds still call the real AIs API with the session token, through `useAisApi`.

The lead runs a phone smoke in mock mode: open Settings › Approvals, approve every pending request, and check that "Always allowed" still lists the rules.

### Read first
`AGENTS.md`, `apps/mobile/src/components/approvals/use-approvals.ts`, `apps/mobile/src/components/ais/use-ais-api.ts`, and `apps/mobile/src/components/chat/use-approvals-api.ts`.

### Allowed files
`apps/mobile/src/components/approvals/use-approvals.ts`, `work/T-1056-mobile-approvals-ai-list-mock.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -n "createAisApi" apps/mobile/src/components/approvals/use-approvals.ts` prints nothing.

---

## Report (written by the worker when done)

## Review (written by Claude)
