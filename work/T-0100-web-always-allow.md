---
id: T-0100
title: Web: "Always allow in this chat" on approval cards, and a list of always-allowed actions you can revoke
status: merged
milestone: M4
branch: task/T-0100-web-always-allow
model: meta/muse-spark-1.3-contributor
depends_on: [T-0099, T-0097]
estimate: 1 day
---

# T-0100: "Always allow" in the web app

## Spec (written by Claude, do not edit)

### Julio's decision (2026-09-29)
"Approve always needs to be associated with the chat, like in personal or in groups, and apply only to that chat." The server side is merged (T-0099). This task adds the web UI: a third choice on the approval card, and a place to see and revoke the standing rules.

### Server contract (merged; do not change)
- The public approval JSON (GET `/api/approvals/:id`, the list, and the decision response) has `alwaysEligible: boolean` and `groupId: string | null` (null = the personal chat between the AI and its owner). `POST /api/approvals/:id/decision` accepts `{ decision: 'approve_always' }`; for an action that is not eligible it answers 400 `always_not_allowed`. Read `apps/server/src/approvals/routes.ts` and `rules.ts`.
- `GET /api/ais/:id/approval-rules` (AI owner only) and `GET /api/groups/:id/approval-rules` (group owner/admin only) return `[{ id, action, scope: 'personal' | 'group', groupId, createdAt, createdBy }]`; anyone else gets 404. `DELETE /api/approval-rules/:id` revokes (204, idempotent; 404 for anyone who may not manage it).

### What to build
1. `lib/api.ts`: add `alwaysEligible` (default `false` when missing, so an older server still parses) to the approval schema; add `listAiApprovalRules(aiId)`, `listGroupApprovalRules(groupId)`, `revokeApprovalRule(id)` with a zod schema for a rule (dates as strings like the other schemas).
2. **Approval card** (`components/ApprovalCard.tsx`): while the request is pending and the viewer can decide, and `approval.alwaysEligible` is true, show a third button **"Always allow here"**. It is a two-step action: the first click swaps the buttons for an inline confirmation line that states the scope in plain words: personal chat → "Always run <action> without asking, in this chat only." Group → "Always run <action> without asking, in this group only." with **Confirm** and **Cancel**. Confirm calls `decideApproval(id, 'approve_always')` and shows the normal decided state (the existing status label for `approved_always` is fine). If the server answers `always_not_allowed`, show "This action can only be approved one time." and remove the third button. Never show the third button when `alwaysEligible` is false, for a non-decider, or after a decision. Keep the existing two buttons and the polling hook from T-0097 working as they are.
3. **Rules list component** (new, e.g. `components/approvals/AlwaysAllowedList.tsx`), used in two places:
   - the **AI panel** (`components/ais/AiPanel.tsx`), owner only, section "Always allowed": lists the AI's rules; each row shows the action name, and where it applies: "Personal chat" or "In a group" (use the group's title when it can be resolved from the chat store or the panel's data, otherwise just "In a group"), and a **Revoke** button.
   - the **group panel** (`components/GroupPanel.tsx`), for owners/admins only (the same `isManager` check as the Activity section): the rules of this group, same rows, same Revoke.
   Behaviour: loads once when the panel opens (loading skeleton or text, then the list; an empty list shows "Nothing is always allowed here."; a failed load shows a short error with Retry, never a blank). Revoke asks for a one-step confirmation ("Stop always allowing <action>?" Revoke / Cancel), disables the button while the request runs, removes the row on success, and shows an inline error on failure without removing it. A 404 on revoke means it is already gone: remove the row quietly.
4. **Mock mode** (`?mock=1`): the seeded pending approval `apr-42` becomes `alwaysEligible: true` with `groupId: null`; the mock decision handler accepts `approve_always` and creates a rule visible in the AI panel's list; the mock `DELETE` removes it. Keep every existing mock behaviour.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0099-approval-rules-always-allow.md` (Review), `T-0097-approval-card-live-refresh.md`
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`, `lib/api.ts` (approvals section), `lib/useApprovalPolling.ts`, `components/ais/AiPanel.tsx`, `AiActivity.tsx` (how a section loads and shows errors), `components/GroupPanel.tsx` (`isManager`), `mock/api.ts`
- `docs/LEAD_PLAYBOOK.md` gotchas on oxlint `react(set-state-in-effect)` / `react-hooks/exhaustive-deps` (use the adjust-state-during-render pattern, never disable a rule) and mock mode (`?mock=1` is dropped by in-app navigation; test with the deep link)

### Allowed files
- `apps/web/src/lib/api.ts`, `api.test.ts`
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`
- `apps/web/src/components/approvals/` (new component and its test)
- `apps/web/src/components/ais/AiPanel.tsx`, `AiPanel.test.tsx`
- `apps/web/src/components/GroupPanel.tsx`, `GroupPanel.test.tsx`
- `apps/web/src/mock/api.ts`
- `work/T-0100-web-always-allow.md`

**Not allowed:** server, mobile, packages, new dependencies, other components.

### Tests (Vitest, no network)
- api client: parses `alwaysEligible` (missing → false) and rules; correct method/URL for the three new calls; a 404 maps to `ApiError` status 404.
- Card: third button only when pending + decidable + eligible; two-step confirm with the right scope wording for personal and group; Confirm sends `approve_always`; Cancel restores the buttons without a request; `always_not_allowed` shows the message and hides the button; not shown after a decision or when not eligible.
- List: loading, empty, error+retry, rows with the right scope text, revoke confirm/cancel/success/failure/404, buttons disabled while pending.
- AI panel shows the section only for the owner; group panel only for managers.

### Live check (the lead does it)
Chrome, `?mock=1` deep link: the card shows the third button, confirm creates a rule, the AI panel lists it, Revoke removes it. Real stack needs `ACTION_DEMO_ENABLED=true` and Julio's OK; steps go in the live-checks doc.

### Acceptance criteria
- [ ] "Always allow here" needs an explicit confirmation that names the scope (this chat / this group only).
- [ ] The rules list is visible only to the AI owner and to group owners/admins, and revoke never leaves a stale row after a failure.
- [ ] Nothing shows an error for a viewer who cannot decide.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test
pnpm build
```

### Out of scope
- Mobile UI, a global "all rules" page, rule expiry, editing a rule.

---

## Report (written by the worker when done)

### What I did
- `lib/api.ts`: added `alwaysEligible` (zod `.default(false)`, so older servers still parse) to `publicApprovalSchema`; added `approvalRuleSchema` plus `listAiApprovalRules`, `listGroupApprovalRules`, `revokeApprovalRule`.
- `ApprovalCard.tsx`: third button "Always allow here" shown only while pending + decidable + `alwaysEligible` (polling `ready` state is the decidable read model, so non-deciders never see it). First click swaps buttons for an inline confirm naming the scope ("…in this chat only." for `groupId: null`, "…in this group only." otherwise) with Confirm/Cancel. Confirm sends `approve_always` (in-flight label "Allowing…") and lands on the normal decided state. `always_not_allowed` shows "This action can only be approved one time." and drops the third button; the one-time buttons stay. Existing Approve/Deny and polling untouched.
- New `components/approvals/AlwaysAllowedList.tsx` (`{ aiId } | { groupId }` scope, same mount-guard + ref + adjust-state-during-render shape as `ActivitySection`): loading text, "Nothing is always allowed here." empty copy, error + Retry (never blank); rows show action + "Personal chat" / "In <title>" (store-resolved) / "In a group"; Revoke is one-step confirm ("Stop always allowing <action>?"), disables buttons while in flight, removes the row on success and quietly on 404, keeps the row with an inline error otherwise. Mounted in `AiPanel` (owner-only by construction: `listAis` only returns the viewer's own AIs, else the missing state) and in `GroupPanel` under the same `isManager` check as Activity.
- `mock/api.ts`: seeded `apr-42` is `alwaysEligible: true`, `groupId: null`; decision handler accepts `approve_always` (→ `approved_always` + creates a personal rule for the Dev AI, resolved from the seeded audit convention), serves both rules lists (group list gated to owner/admin via `mockGroupDetails`, 404 otherwise), and idempotent mock DELETE. All existing mock behaviour kept.
- Tests: api client (missing→false, rule schema, method/URL for the 3 calls, 404→ApiError); card (visibility gating, both scope wordings, Confirm sends `approve_always`, Cancel no-request, `always_not_allowed`, post-decision); list (loading/empty/error+retry, scope text incl. title resolution, revoke confirm/cancel/success/failure/404/disabled-while-pending); AI panel (owner section + fetch, stranger missing state with no request); group panel (manager fetch + heading, member hidden with no request). Also taught the pre-existing panel stubs to serve `[]` for `/approval-rules` so they stay about what they test.

### Files changed
- `apps/web/src/lib/api.ts`, `api.test.ts` (+9 tests)
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx` (+7 tests)
- `apps/web/src/components/approvals/AlwaysAllowedList.tsx` (new), `AlwaysAllowedList.test.tsx` (new, 10 tests)
- `apps/web/src/components/ais/AiPanel.tsx`, `AiPanel.test.tsx` (+2 tests; stubs serve `[]` for rules)
- `apps/web/src/components/GroupPanel.tsx`, `GroupPanel.test.tsx` (+2 tests; `stubAudit` serves `[]` for rules)
- `apps/web/src/mock/api.ts`, `mock/api.test.ts` (+3 tests)
- `work/T-0100-web-always-allow.md` (this Report + status)

### Commands run and real results
- `pnpm install`: ok (7.8s).
- `pnpm format:check`: initially 4 files unformatted (mine); after `prettier --write`: "All matched files use Prettier code style!".
- `pnpm lint` (oxlint): 1 error mid-way (`react(set-state-in-effect)` in the new list) — fixed with the adjust-state-during-render pattern; final run clean.
- `pnpm typecheck`: 10 tasks successful.
- `pnpm --filter @zilar/web test`: 57 files, 639 tests, all passed (includes 31 new tests).
- `pnpm build`: 2 tasks successful (`@zilar/web` built in 757ms).
- Full `pnpm test` (all workspaces) was not run; only `@zilar/web` tests per the task's Checks.

### Problems, deviations from the spec, open questions
- Mock `aiId` resolution: the seeded card's `ai` is a JID with no matching mock AI row, so the mock read model resolves `apr-42` to the first mock AI (`ai-mock-dev`) — consistent with the already-seeded audit entries that treat `apr-42` as the Dev AI's approval. This is what makes the created rule visible in the AI panel's list. Mock-only, no wire change.
- The AI panel's "owner only" gating is inherent (`listAis` is owner-scoped server-side; strangers get the missing state and no rules request fires) — covered by a test rather than an extra client check, mirroring how Activity is mounted.
- Two mid-task test failures were mine and are fixed: `groups` mock route keyed on the wrong path segment, and `new Response(body, {status: 204})` throwing in my test helper.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** approved and merged. Rebased on main; format, lint, typecheck, build clean; web 639 passed. No disable comments.

Read the card and the list component: the third button shows only while pending, decidable and `alwaysEligible`; it is a two-step confirm that names the scope (this chat / this group only); `always_not_allowed` shows the plain message and drops the button; the polling hook from T-0097 is untouched. The list loads once, has loading/empty/error+retry, revokes with a one-step confirm, keeps the row on failure and drops it quietly on 404; state resets use the adjust-state-during-render pattern.

Mock mode note (worker): the seeded card's `ai` resolves to the first mock AI so the created rule shows in the AI panel; mock-only. Not checked on the real stack (needs `ACTION_DEMO_ENABLED=true` and Julio's OK): steps are in the live-checks doc.
