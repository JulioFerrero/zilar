---
id: T-0101
title: Only a group owner/admin can create a group "always allow" rule
status: merged
milestone: M4
branch: task/T-0101-group-always-admin-only
model: meta/muse-spark-1.3-contributor
depends_on: [T-0099, T-0100]
estimate: 0.5 day
---

# T-0101: Group "always allow" needs a group admin

## Spec (written by Claude, do not edit)

### Julio's decision (2026-09-29)
"Should creating a group 'always' rule require being a group admin? Yes." Today the AI's owner can decide a group approval and, with `approve_always`, create a standing rule for the whole group even when they are only a plain member of it. A standing rule changes what the AI may do for everyone in the room, so it needs an admin. Approving **once** stays as it is (AI owner, or group owner/admin). Personal-chat rules are unchanged (AI owner only, as before).

### Server contract to implement
1. **Decision** (`POST /api/approvals/:id/decision`, `approvals/service.ts` `decideApproval`): for `approve_always` on an approval whose `groupId` is not null, the caller must be that group's owner or admin (reuse `isGroupAdmin` from `approvals/rules.ts`). If they are not, refuse **before any state changes** with a new `ApprovalServiceError` code `always_requires_admin`, mapped by the route to **403** with that code. Order of checks stays: not allowed to decide at all → 404 (unchanged, no leak); expired / not_pending → 409; then `always_not_allowed` (action not eligible) → 400; then `always_requires_admin` → 403. The request is **not** consumed by the refusal: the same person can still approve once afterwards.
2. **Read model** (`GET /api/approvals`, `GET /api/approvals/:id`, and the decision response): `alwaysEligible` becomes per viewer: `true` only if the action is eligible **and** (the approval is a personal-chat approval **or** the viewer is a manager of its group). Compute it once per response in `routes.ts` (`decoratePublic` gets the viewer's manager status; for the list, look up the viewer's managed group ids once, not one query per row). The web card already hides the third button when `alwaysEligible` is false, so nothing else is needed for the normal case.
3. **Web** (`ApprovalCard.tsx`): handle a `403 always_requires_admin` on Confirm (a role can change between polls): show "Only a group admin can always allow an action here." and drop the third button, same pattern as `always_not_allowed`. No other web change.
4. Rule creation, revocation, listing and the gateway's rule lookup are **unchanged** (revoke: the AI owner or any group admin, as today).

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0099-approval-rules-always-allow.md` (spec + Review) and `T-0100-web-always-allow.md`
- `apps/server/src/approvals/service.ts` (`decideApproval`, `canDecide`, `decidableGroupIdsForUser`), `routes.ts` (`decoratePublic`, the decision handler), `rules.ts` (`isGroupAdmin`)
- `apps/web/src/components/ApprovalCard.tsx` (the `always_not_allowed` branch)
- `apps/server/src/actions/flow.e2e.test.ts` (HTTP-level scenarios; add one)

### Allowed files
- `apps/server/src/approvals/service.ts`, `service.test.ts`, `routes.ts`, `routes.test.ts`, `rules.routes.test.ts`
- `apps/server/src/actions/flow.e2e.test.ts`
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`
- `work/T-0101-group-always-admin-only.md`

**Not allowed:** schema/migrations, mobile, other server modules, new dependencies, `docs/`.

### Tests (Vitest, PGlite; no network)
- Service/route: in a group approval, (a) the AI owner who is a plain member gets 403 `always_requires_admin` on `approve_always`, the row is still `pending`, no rule exists, no audit entry `approval_rule.created`; then `approve_once` by the same person works. (b) A group admin who is not the AI owner: can decide once **and** `approve_always` (rule created with `groupId` set). (c) The AI owner who is also a group admin: `approve_always` works. (d) Personal-chat approval: the AI owner's `approve_always` still works. (e) A stranger still gets 404 for both decisions. (f) Ordering: a non-eligible action still answers 400 `always_not_allowed`, an expired request 409, before the admin check.
- Read model: for the same group approval, `alwaysEligible` is `false` for the plain-member AI owner and `true` for an admin (single `GET` and the list, including a list mixing personal and group rows).
- One e2e scenario in `flow.e2e.test.ts`: member-owner sees no third option (`alwaysEligible: false`), gets 403 when forcing it, approves once and the action runs; an admin's `approve_always` creates the rule and the next request in that group auto-executes.
- Web card: `403 always_requires_admin` shows the message and hides the third button; the one-time buttons stay.

### Acceptance criteria
- [ ] A non-admin can never create a group rule, even by calling the API directly; the refusal changes no state.
- [ ] `alwaysEligible` is per viewer and computed without one query per row.
- [ ] Approve-once and personal-chat rules behave exactly as before.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test
pnpm --filter @galena/web test
pnpm build
```

### Out of scope
- Who may revoke, rule expiry, audit changes, mobile UI, a "requested by" field.

---

## Report (written by the worker when done)

### What I did
- Decision gate (`apps/server/src/approvals/service.ts` `decideApproval`): for `approve_always` on a group approval (`groupId` not null), the caller must be a group owner/admin via `isGroupAdmin` from `approvals/rules.ts`. Refusal is a new `ApprovalServiceError` code `always_requires_admin`, thrown after the existing checks (canDecide → 404, expired/not_pending → 409, `always_not_allowed` → 400) and before any state change, so the row stays `pending` and the same person can still `approve_once` afterwards. Personal-chat approvals skip the group check.
- Read model (`apps/server/src/approvals/routes.ts`): `decoratePublic` now takes the viewer's manager status and `alwaysEligible` is `true` only when the action is eligible AND (personal chat OR viewer is a group owner/admin). The list computes the viewer's managed group ids once via `managedGroupIdsForUser` (single query, `Set` lookup per row); single GET and the decision response do one `isGroupAdmin` check. Route maps `always_requires_admin` to 403 with that code.
- Web (`apps/web/src/components/ApprovalCard.tsx`): a `403 always_requires_admin` on Confirm shows "Only a group admin can always allow an action here." and drops the third button, same pattern as `always_not_allowed`; one-time buttons stay. Rule creation/revocation/listing and the gateway lookup are unchanged.

### Files changed
- `apps/server/src/approvals/service.ts` (admin check + new error code), `routes.ts` (per-viewer `alwaysEligible`, 403 mapping, `managedGroupIdsForUser`)
- `apps/web/src/components/ApprovalCard.tsx` (403 branch)
- Tests: `apps/server/src/approvals/service.test.ts` (+6: member-owner refused with no state change then approves once; non-owner admin decides once + always; owner-admin always works; personal unchanged; stranger 404 both; ordering 400/409-before-403), `rules.routes.test.ts` (+5 incl. per-viewer single/list incl. mixed personal+group rows), `apps/server/src/actions/flow.e2e.test.ts` (+1: member-owner sees `alwaysEligible: false`, forced 403, approve-once runs, admin always creates rule, next request auto-executes), `apps/web/src/components/ApprovalCard.test.tsx` (+1: 403 message + hides third button)
- `work/T-0101-group-always-admin-only.md` (this Report + status)

### Commands run and real results
- `pnpm install`: ok (7.7s).
- `pnpm format:check`: initially 4 files unformatted (mine); after `prettier --write`: "All matched files use Prettier code style!".
- `pnpm lint` (oxlint, re-run after last edit): clean.
- `pnpm typecheck`: 10 tasks successful (fixed one missing `approvals` import in `rules.routes.test.ts` mid-way).
- Targeted `pnpm exec vitest run src/actions/flow.e2e.test.ts src/approvals/service.test.ts src/approvals/rules.routes.test.ts` (in `apps/server`): 3 files, 77 tests, all passed.
- Full `pnpm --filter @galena/server test`: 57 files passed, 5 skipped; 909 tests passed, 7 skipped, 0 failed (ran twice; the package arg filter is swallowed by the test script so the whole suite ran — pre-existing arg plumbing, not my change).
- `pnpm --filter @galena/web test`: 57 files, 640 tests, all passed (includes 1 new test).
- `pnpm build`: 2 tasks successful.

### Problems, deviations from the spec, open questions
- None. Ordering verified by test: non-eligible action → 400 `always_not_allowed` and expired row → 409 even when the caller also lacks admin rights; the admin check runs last of the refusal checks, before the transaction.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** approved and merged. Full server suite and web suite green in the worker's run; format, lint, typecheck, build clean; no disable comments.

### Findings
- `decideApproval`: the admin check runs after canDecide (404), expiry/not_pending (409) and `always_not_allowed` (400), and before the transaction, so a refusal changes no state and the same person can still approve once. Personal-chat approvals skip it. Matches the spec's ordering, and a test proves it.
- `alwaysEligible` is per viewer in the single GET, the list (one query for the viewer's managed groups, set lookup per row) and the decision response.
- The card handles `403 always_requires_admin` like `always_not_allowed`: message, third button dropped, one-time buttons stay.
- Rule creation, revocation, listing and the gateway lookup are untouched. The e2e scenario proves member-owner: no third option, forced 403, approve once runs; admin: always creates the rule and the next request auto-executes.

### Follow-ups
- None.
