---
id: T-1056
title: "Mobile approvals: list AIs through useAisApi, so 'Always allowed' keeps its rules in mock mode when nothing is pending"
status: merged
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

### What I did
- `apps/mobile/src/components/approvals/use-approvals.ts`:
  - Added `const { api: aisApi } = useAisApi();` next to `useApprovalsApi()` (line 40).
  - The one AI-list fetch (`aiList`) now calls `aisApi.listAis()` instead of
    `createAisApi(getSessionToken).listAis()`. The `Effect.tryPromise` /
    catch-to-`[]` shape is unchanged, so a failing list still leaves the names
    empty and only the pending AI ids get their rules loaded.
  - Dropped the now-unused `createAisApi` and `getSessionToken` imports
    (`grep` confirmed they were used only in `aiList`).
- Mock mode now reads the mock AIs: `useAisApi()` picks the mock and the mock
  lists `ai-dev-1`, the same id the approvals mock uses, so once every pending
  request is decided the rules fan-out still knows `ai-dev-1` and "Always
  allowed" keeps its rules instead of showing "Nothing is always allowed here".
- Real builds are unchanged in effect: `useAisApi()` returns
  `createAisApi(getSessionToken)` there, exactly what the code called before.

Stability (spec point 2): `aiList` stays where it was, at render scope, and is
read only inside the `runRules` action. `runRules` and `runLoad` are `run`
callbacks from `useAction`, whose identity is stable (`useCallback` over stable
deps in `packages/client-core/src/use-action.ts:98`), and `useAction` runs the
latest `fn` (`latest.current`), so the current `aisApi` is always used. The
triggers are unchanged (`runLoad` effect depends on `[runLoad]`; the rules
effect on `[pendingAiKey, status]`), so neither runs on every render.

### Files changed
- `apps/mobile/src/components/approvals/use-approvals.ts`
- `work/T-1056-mobile-approvals-ai-list-mock.md` (status + this Report)

### Commands and real results
- `grep -n "createAisApi" apps/mobile/src/components/approvals/use-approvals.ts`
  → no output, exit 1 (Acceptance met).
- `pnpm gate` (from repo root) → ended in `GATE PASS`:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No focused tests were run: `apps/mobile` has no test near this hook, and
  AGENTS.md says UI/hook code gets no tests. The lead's phone smoke in mock mode
  covers the behaviour.

### Problems
- None.

### Deviations from the spec
- None.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-10: approved, with a correction to the lead's own diagnosis. The pre-review is clean, with no nits.**
- **The change:** `use-approvals.ts` reads the AI list through `useAisApi()`, so mock mode lists the mock AIs instead of a real fetch that fails silently. Real builds still use `createAisApi(getSessionToken)` inside `useAisApi`. It is a one-line swap plus the hook.
- **The lead's phone smoke** (mock, `/settings/approvals`): the pending card "Rotate the staging API token" shows, with Approve once, Always and Deny. "Always allowed" still reads "Nothing is always allowed here.", even with a request pending.
- **The correction:** the spec's premise, from the lead's T-1004 review, was wrong. The list is empty because the mobile approvals mock returns no rules at all (`apps/mobile/src/mock/approvals.ts:119-121`, `listAiApprovalRules` → `[]`), and its "Always" decision records none. The AI list was not the cause. This change is still correct, but it changes nothing visible. The board follow-up is rewritten.
- **Check:** the gate passed.
