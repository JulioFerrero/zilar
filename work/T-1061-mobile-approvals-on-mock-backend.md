---
id: T-1061
title: "Mock H2-2 (mobile): approvals run on @zilar/mock-backend through mockFetch; one shared mockToken in mock/gate.ts"
status: todo
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

## Review (written by Claude)
