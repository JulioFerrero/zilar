---
id: T-1190
title: "SG-4 web UI: the group owner gets 'Make owner' on each member row (inline confirm), calling PUT /api/groups/:id/owner; afterwards the old owner sees Leave group like any admin"
status: merged
milestone: M5
branch: task/T-1190-web-owner-transfer
model: auto
effort: default
depends_on: [T-1183, T-1187]
estimate: 0.2 day
---

# T-1190: Hand over a group on web

## Spec (written by Claude, do not edit)

### Why
- **The server side exists:** T-1187 added `PUT /api/groups/:id/owner` (contract `transferOwner` in `packages/api-contract/src/groups.ts`, payload `{ userId }`, returns `GroupDetail`), allowed only for the owner.
- **The members section exists:** T-1183 added `apps/web/src/components/GroupMembersSection.tsx` (249 lines), with Remove, Add members and Leave group. For the owner it shows "Owners can't leave yet."
- **The pattern to copy:** `addGroupMembers` and `removeGroupMember` are wired through `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupSettings.ts` and `groupActions.ts`.

### What to build
1. **`lib/api/groups.ts`:** `transferGroupOwner(groupId, userId)` through `callApi` and the contract's `transferOwner`.
2. **The store action** `transferGroupOwner(chatId, userId)` in `groupSettings.ts` and `groupActions.ts`, following `removeGroupMember`. It refreshes the detail and the chat list.
   - `store.ts` is 396 lines; add the one type line only if it stays at most 400, otherwise put it on the group actions slice.
3. **`GroupMembersSection.tsx`:**
   - for the **owner** only, each other member's row gets a "Make owner" button with an inline confirm: "Make <name> the owner? You become an admin.";
   - replace "Owners can't leave yet." with "To leave, make someone else the owner first.";
   - after a transfer the panel refreshes, and the old owner (now admin) sees Leave group;
   - keep the file at most 400 lines.
4. **No tests** (UI; the server is tested).

### Read first
`AGENTS.md`, `apps/web/src/components/GroupMembersSection.tsx`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupActions.ts`, `packages/api-contract/src/groups.ts` (`transferOwner`) and `apps/server/src/groups/ownership.ts`.

### Allowed files
`apps/web/src/components/GroupMembersSection.tsx`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/store/store.ts`, `work/T-1190-web-owner-transfer.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the live web, with test accounts:** the owner makes a member the owner, then leaves.

---

## Report (written by the worker when done)

### What I did
- **`lib/api/groups.ts`:** added `transferGroupOwner(groupId, userId)` through `callApi` and the contract's `transferOwner` (`client.groups.transferOwner({ params: { id }, payload: { userId } })`), placed next to `removeGroupMember`.
- **`effects/groupSettings.ts`:** added the `transferGroupOwner(ctx, chatId, userId)` effect through `changeGroupCore` with `groupChangeStore` and `refreshList: true`, so the detail repaints from the server's answer (the caller becomes an admin) and the chat list refreshes.
- **`effects/groupActions.ts`:** added `transferGroupOwner` to the `GroupActions` pick and its `rt.runPromise(...)` implementation, next to `removeGroupMember`.
- **`store/store.ts`:** added the one type line `transferGroupOwner: (chatId: string, userId: string) => Promise<void>;` (file went 396 → 397 lines, ≤ 400).
- **`components/GroupMembersSection.tsx`:** for the owner only, every other member's row now has a `Make owner` button; clicking it shows an inline confirm line "Make <name> the owner? You become an admin." with a destructive `Make owner` and `Cancel`. Replaced "Owners can't leave yet." with "To leave, make someone else the owner first." After a transfer the panel repaints; the old owner is now an admin and sees `Leave group` (the `meRole !== 'owner'` branch). File is 306 lines (≤ 400).

### Files changed
- `apps/web/src/components/GroupMembersSection.tsx`
- `apps/web/src/lib/api/groups.ts`
- `apps/web/src/store/effects/groupActions.ts`
- `apps/web/src/store/effects/groupSettings.ts`
- `apps/web/src/store/store.ts`
- `work/T-1190-web-owner-transfer.md`

### Commands and real results
- `pnpm install`: done in 11.7s, 1180 packages (one peer-dependency warning in `apps/mobile`, pre-existing).
- `pnpm gate` (from the repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/web  (5.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file was run: the change is UI plus thin store/api wiring and the task says UI gets no tests. The gate's `tests @zilar/web` step passed on its own.

### Deviations from the spec
- The web store reaches its API through the hand-written `ApiClient` interface in `apps/web/src/store/effects/ports.ts`, which is **not** in my Allowed files. So instead of `api.transferGroupOwner(...)` (the `removeGroupMember` pattern), the effect imports `transferGroupOwner as transferGroupOwnerRequest` directly from `@/lib/api/groups` and calls it, exactly like the existing `addGroupMembers` effect does. No change to `ports.ts` or `lib/api.ts` was needed or made.

### Problems / open questions
- None. The lead's live check (owner makes a member the owner, then leaves) still has to run; I did not run a browser.

### Security check
- No new route, no auth/permission logic and no audit code on the web side: the server (`ownership.ts`, T-1187) enforces owner-only and audits. The client only calls the existing contract endpoint; the store action refuses with the fixed sentence "Could not hand over the group." No secrets reach logs or URLs.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **The web side of the transfer:** `transferGroupOwner` in the API and the store; the detail and the list refresh.
- **The members section:**
  - "Make owner" on each other member's row, for the owner only, with an inline confirm;
  - the owner's hint now reads "To leave, make someone else the owner first."
- **Still to do:** the live check with test accounts.
