---
id: T-0184
title: Mobile: approvals page (pending, history, always-allowed rules)
status: planned
milestone: M5
branch: task/T-0184-mobile-approvals-page
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0184: Mobile: approvals page (pending, history, always-allowed rules)

## Spec (written by Claude, do not edit)

### Why
AIs ask for approval before spending money or acting. Mobile only shows the approval card inside a chat; web also has an Approvals page with the pending list, the history and the 'always allowed' rules you can revoke. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/ApprovalsPage.tsx`, `apps/web/src/components/approvals/ApprovalRow.tsx`, `AlwaysAllowedList.tsx`, `formatRelative.ts`, `ApprovalsListSkeleton.tsx`; client functions in `apps/web/src/lib/api.ts`: `listApprovals()` (~1186), `getApproval(id)`, `decideApproval(...)` (~1190), `listAiApprovalRules(aiId)` (~1223), `listGroupApprovalRules(groupId)` (~1227), `revokeApprovalRule(id)` (~1234).
- Server: `apps/server/src/approvals/routes.ts`, `service.ts`.
- Mobile: `apps/mobile/src/lib/approvals-api.ts` has only `getApproval` and `decideApproval`; extend it (and its test) with the list and rules functions. `components/chat/approval-card.tsx` is the in-chat card to reuse for decisions.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes or message text.

### What to build
1. Extend `apps/mobile/src/lib/approvals-api.ts` with `listApprovals`, `listAiApprovalRules`, `listGroupApprovalRules`, `revokeApprovalRule` (+ tests; keep the existing functions and tests unchanged).
2. `apps/mobile/src/app/settings/approvals.tsx`: tabs Pending | History; pending rows show the AI, the summary, the worst-case amount and the expiry, with Approve once / Always / Deny (reuse the card's logic and its 404/409 handling); history rows are read-only with the decision and time (use a mobile `formatRelative`); an 'Always allowed' section per AI with Revoke (confirm first).
3. One row 'Approvals' (lucide `ShieldCheck`) in `apps/mobile/src/lib/settings-items.ts` (create it with just that row if T-0181 has not merged yet; the lead resolves a conflict).
4. Pull to refresh and a refresh when the screen regains focus.
5. Tests (Vitest): the API additions, the screen (pending, history, empty, error, decision race 409, revoke with confirm).

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern: type guards or zod, an error class with `status` and `code`), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/approvals-api.ts` and its test, `apps/mobile/src/app/settings/approvals.tsx`, `apps/mobile/src/components/approvals/**`, `apps/mobile/src/lib/settings-items.ts` (one row), `apps/mobile/src/components/chat/approval-card.tsx` (only to export what you reuse).

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 approvals
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Pending approvals can be decided from the Approvals screen; history shows past decisions.
- Always-allowed rules are listed per AI and can be revoked after a confirm.
- A decided-elsewhere approval (409) refreshes the row instead of failing silently.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Creating rules by hand, push notifications for approvals, the per-topic approval rules.

---

## Report (written by the worker when done)

## Review (written by Claude)
