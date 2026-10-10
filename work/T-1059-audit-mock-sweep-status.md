---
id: T-1059
title: "Audit: what still uses the old mock code (web mock/api.ts fallback, mobile use-*-api mock switches, mobile mock store), with H2 and sweep slices"
status: todo
milestone: M5
branch: task/T-1059-audit-mock-sweep-status
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.25 day
---

# T-1059: Mock sweep status audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-plan.md` §4 splits the mock rebuild into building the shared backend (A to F2), the cutovers (G web, H mobile) and a deletion sweep (I to R2). Done so far: A, B, C1 (T-1044), D, E, F1 (T-1046), F2, G (T-0946), H1 (T-0949, the mobile store) and O (T-0947). C2 (T-1045) is in review.

What the lead read on main (2026-10-10):
- **web:** `apps/web/src/mock/backend.ts:17-23` `dispatch` tries `backend.http` and falls back to `mockRequest` in `apps/web/src/mock/api.ts` (4,297 lines) for anything the shared backend does not answer.
- **mobile:** several screens still pick an old per-domain mock through their `use-*-api.ts` switch. For example, `apps/mobile/src/components/chat/use-approvals-api.ts:55-64` uses `createMockApprovals()` from `apps/mobile/src/mock/approvals.ts`, whose `listAiApprovalRules` returns `[]` (`:119-121`), even though `packages/mock-backend/src/domains/approval-rules/` exists. That is plan task H's second half (each `use-*-api.ts` gets `backend.http` as its `fetchImpl`).
- `apps/mobile/src/store/chat-store.ts` (1,595 lines) still has `isMockMode` at `:1583`. Plan task Q deletes it once nothing reaches it.

The lead needs measured facts before speccing H2 and the sweep.

### What to build
Write `docs/audit/mock-sweep-status.md`. **Change no code.** Throwaway scripts are fine; do not commit them.

1. **Web fallback coverage.** List every path family `mockRequest` handles (`apps/web/src/mock/api.ts`, its route switch from `:2179`). For each one, say whether `createMockBackend().http` answers the same method and path today, and measure it with a throwaway script that calls both.
   - Mark three groups: "backend covers it, so the old route is dead"; "backend lacks it, so it still falls back"; "only T-1045 covers it".
   - Give the `api.ts` line ranges of the dead routes.
2. **Mobile mock switches.** For every `apps/mobile/src/**/use-*-api.ts`, and every other place that picks a mock with `ENV_MOCK`/`mockParamAllowed`/`isMockMode`, name the old mock it uses (file:line) and whether a shared backend domain exists for it.
   - Note behaviour gaps between the two (for example, approval rules).
   - Say what an adapter onto `backend.http` needs: the client factory and its `fetchImpl` parameter, file:line.
3. **The mobile mock store.** Is `isMockMode`, or the mock branch of `createChatStore` in `apps/mobile/src/store/chat-store.ts`, still reachable from any non-test code? `grep` every importer.
4. **The old mock files.** For each file in `apps/web/src/mock/`, `apps/mobile/src/mock/` and `apps/mobile/src/components/*/*-mock.ts`, list its importers today, and say whether it would be dead after the H2 adapters.
5. **Proposed slices,** each at most about 800 changed lines (deletions count), with exact files and line ranges, and an order:
   - first the H2 adapters (one small task per domain group);
   - then the deletions that become safe.

   Mark the slices that touch auth, keys or permissions code outside the mocks.

Keep `docs/audit/mock-sweep-status.md` under 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` (all of §4 and §5), `apps/web/src/mock/backend.ts`, `apps/mobile/src/mock/backend.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, and `packages/mock-backend/src/domains/index.ts`.

### Allowed files
`docs/audit/mock-sweep-status.md`, `work/T-1059-audit-mock-sweep-status.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/mock-sweep-status.md` exists. Each claim has file:line or script-output evidence, and every slice names exact files.
- No code changed.

---

## Report (written by the worker when done)

## Review (written by Claude)
