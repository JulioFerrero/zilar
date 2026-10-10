---
id: T-1061
title: "Mock H2-2 (mobile): approvals run on @zilar/mock-backend through mockFetch; one shared mockToken in mock/gate.ts"
status: merged
milestone: M5
branch: task/T-1061-mobile-approvals-on-mock-backend
model: auto
effort: default
depends_on: [T-1059]
estimate: 0.25 day
---

# T-1061: Mobile approvals on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §2, slice H2-2. The lead read main (2026-10-10).

**What is wrong today:**
- In mock mode, `apps/mobile/src/components/chat/use-approvals-api.ts:55-64` uses `createMockApprovals()`, which is the old `apps/mobile/src/mock/approvals.ts`:
  - it has one pending request, `approval-2001` (`:22`);
  - its `listAiApprovalRules`/`listGroupApprovalRules` return `[]` (`:119-124`);
  - its `revokeApprovalRule` throws 404.
- Mobile chats come from the shared backend since T-0949, so the Dev team card is `apr-42`: `packages/mock-backend/src/domains/messages/threads/dev-team.ts:51` with `builders.ts:95-100`. The old mock does not know that id.
- The shared backend has real `approvals` and `approval-rules` domains (`packages/mock-backend/src/domains/approvals/seed.ts:41` `apr-42`, `domains/approval-rules/`).

**What the adapter needs:**
- The real factory takes a fetch: `createApprovalsApi(getToken, fetchImpl, apiUrl)` (`apps/mobile/src/lib/approvals-api.ts:116-120`).
- The mock fetch is `mockFetch` (`apps/mobile/src/mock/backend.ts:37`).
- The mock-mode token is a local `mockToken` in `apps/mobile/src/store/chat-store-provider.tsx:43-46`. The client fails `unauthorized` when the token is `undefined`.

### What to build
1. **One shared token:** move `mockToken` (and its comment) from `chat-store-provider.tsx:43-46` into `apps/mobile/src/mock/gate.ts` as `export const mockToken`. Import it in `chat-store-provider.tsx` from `@/mock/gate`; the provider already imports from it at `:13`. Nothing else changes in the provider.
2. **The adapter:** in `use-approvals-api.ts`, the mock branch builds `createApprovalsApi(mockToken, mockFetch, API_URL)`.
   - `mockFetch` comes from `@/mock/backend`, loaded with the same guarded `require` inside the build-time condition the file uses today (`__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`), so release builds still leave the mock out.
   - Keep `approvalsMockActive`, the `ApprovalsApiHandle` shape and the `mock` flag.
   - Take `API_URL` from the same place `chat-store-provider.tsx` imports it.
3. **Do not delete `apps/mobile/src/mock/approvals.ts`.** Deletion is a later slice. If nothing imports it any more, say so in the Report.
4. **No other change.**

The lead runs a phone smoke in mock mode:
- open Dev team, approve the card;
- in Settings › Approvals, decide with Always;
- check that "Always allowed" lists the rule, and that Revoke removes it.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md` §2, `apps/mobile/src/components/chat/use-approvals-api.ts`, `apps/mobile/src/lib/approvals-api.ts`, `apps/mobile/src/mock/backend.ts`, `apps/mobile/src/mock/gate.ts`, and `apps/mobile/src/store/chat-store-provider.tsx`.

### Allowed files
`apps/mobile/src/components/chat/use-approvals-api.ts`, `apps/mobile/src/mock/gate.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `work/T-1061-mobile-approvals-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -n "mock/approvals" apps/mobile/src/components/chat/use-approvals-api.ts` prints nothing.
- `grep -rn "const mockToken" apps/mobile/src` lists only `mock/gate.ts`.

---

## Report (written by the worker when done)

### What changed

Mock-mode approvals now run through the shared `@zilar/mock-backend`, like the
rest of the mobile mocks.

1. **One shared token.** Moved `mockToken` and its comment out of
   `apps/mobile/src/store/chat-store-provider.tsx` into
   `apps/mobile/src/mock/gate.ts` as `export const mockToken`. The provider now
   imports it from `@/mock/gate` (its existing import line); nothing else in the
   provider changed.
2. **The adapter.** In `apps/mobile/src/components/chat/use-approvals-api.ts` the
   mock branch now builds `createApprovalsApi(mockToken, mockFetch, API_URL)`.
   `mockFetch` is loaded from `@/mock/backend` with the same guarded `require`
   inside the existing `__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK` condition,
   so a release build still leaves the mock out. `API_URL` comes from
   `@/lib/auth`, the same module the provider imports it from. `approvalsMockActive`,
   the `ApprovalsApiHandle` shape and the `mock` flag are unchanged. I also
   refreshed the now-stale comments that named the old mock (`mock/messages.ts`)
   to describe the shared backend.
3. `apps/mobile/src/mock/approvals.ts` is **not** deleted (later slice).
4. No other change.

### Files changed

- `apps/mobile/src/components/chat/use-approvals-api.ts`
- `apps/mobile/src/mock/gate.ts`
- `apps/mobile/src/store/chat-store-provider.tsx`
- `work/T-1061-mobile-approvals-on-mock-backend.md`

### Is `mock/approvals.ts` still imported?

No. After this change nothing in `apps/mobile/src` imports `@/mock/approvals`;
its `createMockApprovalsApi` and `resetApprovalsMock` exports are now
unreferenced in code (only audit/task docs mention them). There is no
`mock/approvals.test.ts` in the tree. So the file is dead code awaiting the
later deletion slice — left in place per the spec.

### Commands and results

- `pnpm install`: exit 0 (`Done in 11.6s using pnpm v10.32.1`); the only warning
  is the pre-existing `@types/react` peer-dependency notice in `apps/mobile`.
- Acceptance checks:
  - `grep -n "mock/approvals" apps/mobile/src/components/chat/use-approvals-api.ts`: no output (exit 1).
  - `grep -rn "const mockToken" apps/mobile/src`: only `apps/mobile/src/mock/gate.ts:48`.
- Single tests: none. No test file in the tree references the three touched
  files (`gate.ts`, `chat-store-provider.tsx`, `use-approvals-api.ts`), so there
  was no near test to run.
- `pnpm gate` (repo root): exit 0.
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.5s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (3.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations / open questions

- None. The `git status` set is exactly the Allowed files, and the gate's scope
  check agrees.
- The mock-backed smoke (Dev team card, Settings › Approvals with Always and
  Revoke) is the lead's phone smoke; I did not run it. The shared backend's
  routes match the contract the adapter calls: `GET/POST /approvals*`
  (`packages/mock-backend/src/domains/approvals/routes.ts`) and
  `GET /ais/:id/approval-rules`, `GET /groups/:id/approval-rules`,
  `DELETE /approval-rules/:id` (`.../approval-rules/routes.ts`), and the seed
  provides `apr-42` (`.../approvals/seed.ts:41`) — the Dev team card's id.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:**
  - **the adapter:** mobile approvals in mock mode now run `createApprovalsApi(mockToken, mockFetch, API_URL)` on `@zilar/mock-backend`, behind the same build-time `require`. Before, it used the old `mock/approvals.ts`;
  - **the token:** `mockToken` moved from `chat-store-provider.tsx` to `mock/gate.ts`, and the provider imports it from there.
- **The lead's phone smoke** (mock, `/settings/approvals`):
  - the pending card is now the backend's `apr-42` (`merge_pull_request`, "Merge PR #42…", worst case EUR 0.40);
  - **Always** clears it, and "Always allowed" then lists Dev-1 › merge_pull_request › Personal chat;
  - **Revoke** asks "Stop always allowing merge_pull_request?", and confirming removes the rule.
- **Seen before the decision:** "Always allowed" read "Could not load the rules."
  - The AI list still comes from the old mobile AIs mock (`ai-dev-1`, `ai-marketing-1`). The backend answers 200 `[]` for `ai-dev-1` and 404 for `ai-marketing-1` (it calls that AI `ai-marketing`).
  - `mergeRulesFanOut` (`components/approvals/rows.ts:86`) returns the error state when no rule came back and any AI failed.
  - H2-1, the AIs onto the backend, removes the id mismatch. The fan-out rule itself goes on the board as a follow-up.
- **Check:** the gate passed.
