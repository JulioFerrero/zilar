---
id: T-0184
title: Mobile: approvals page (pending, history, always-allowed rules)
status: review
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

### What I did
- Extended `apps/mobile/src/lib/approvals-api.ts` with `listApprovals` (GET `/api/approvals`), `listAiApprovalRules` (GET `/api/ais/:id/approval-rules`), `listGroupApprovalRules` (GET `/api/groups/:id/approval-rules`) and `revokeApprovalRule` (DELETE `/api/approval-rules/:id`, any 2xx = revoked), plus an `ApprovalRule` type mirroring the server's `PublicApprovalRule` (topic fields tolerant: a non-string reads as null, so older servers parse). Existing functions/tests untouched.
- New `apps/mobile/src/components/approvals/`: `format-relative.ts` (pure `expiresInText`/`worstCaseText` mirroring web's `formatRelative.ts` wording, plus `decidedAgoText` mirroring web's `formatRelativeAudit`), `rows.ts` (pure `rowsForList`/`orderedRows`/`SCREEN_DECISIONS`/`decideScreenRow`/`revokeFailedOutcome`/`groupRulesForScreen`), `approval-row.tsx` (`PendingApprovalRow` with AI name, summary, worst case, expiry, Approve once / Always / Deny; read-only `HistoryApprovalRow` with decision + time), `always-allowed-row.tsx` (`AlwaysAllowedRow` + `RevokeConfirmDialog` Modal, confirm-first like web).
- New `apps/mobile/src/app/settings/approvals.tsx`: `RequireAuth`-guarded screen with Pending | History tabs, `AisScreenShell` frame, pull-to-refresh + `useFocusEffect` refresh + 60 s countdown tick, decided-elsewhere (409) drops the row with the "already decided or expired" notice and moves the fresh row to history, AI display names via one `listAis`, rules fanned out per AI with the AI id re-attached (`OwnedRule`), grouped per AI.
- Created `apps/mobile/src/lib/settings-items.ts` with Profile + My AIs rows copied verbatim from T-0181's branch plus the new `approvals` row (ShieldCheck icon id, `/settings/approvals` href); lead resolves the conflict with T-0181.
- Reused the card's logic: decisions go through `applyDecision` from `lib/approval-state.ts` (its 404/409 handling). `components/chat/approval-card.tsx` itself untouched (no export needed).
- Tests: API additions (11 cases), `approvals.test.ts` (pure helpers: countdown, worst case, decided-ago, row building, 409-gone, revoke 404-drop, grouping), `rows.test.tsx` (static-markup render of pending/history/rule/dialog incl. busy and error states). Extended `mock/approvals.ts` with no-op list/rules stubs so the enlarged `ApprovalsApi` interface still typechecks in mock mode; adapted `approval-state.test.ts`'s `buildApi` to the wider interface (no assertions changed).

### Deviations / needs-a-decision
- No server history endpoint exists (`GET /api/approvals` returns only pending/decidable; history lives in the audit log per AI/group). The History tab therefore shows rows decided in this session (kept in memory), plus anything fetched fresh after a 409. A true cross-session history would need a new server route or the audit API on mobile — left for the lead to decide. No server changed.
- One companion edit outside Allowed files: `apps/mobile/src/mock/approvals.ts` (list/rules stubs) and `apps/mobile/src/lib/approval-state.test.ts` (`buildApi` widened). Both forced by the interface extension; no behaviour changed there.
- Settings shell: T-0181's `SettingsScreenShell` is not merged, so the screen uses the merged `AisScreenShell` frame (same header/back/subtitle shape); lead may ask to swap when T-0181 lands.

### Commands (real results)
- `pnpm install`: ok (9.7 s).
- `pnpm format:check`: initially 2 files warned (`approvals.tsx`, `approvals.test.ts`); fixed with `prettier --write`; now "All matched files use Prettier code style!".
- `pnpm lint` (oxlint): clean.
- `pnpm typecheck` (turbo, 11 tasks): all pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 approvals approval-state routes-dir`: 6 files, 70 tests, all pass.
- The lead tests on the emulator and the phone.

### Security checklist
- No secrets/tokens/message text logged; errors carry server messages only.
- No deletes/updates besides scoped `revokeApprovalRule(id)` (server checks ownership/admin, 404 otherwise); UI confirms before revoking.
- No caps/uniqueness logic added; double-tap guarded by busy flag + ref.
- Unknown/forbidden rows surface as the same 404-shaped error; no audit entries written.
- No new routes server-side; no new dependency (`lucide-react-native`, existing UI kit only); no emoji in UI.

## Review (written by Claude)
