---
id: T-0100
title: Web: "Always allow in this chat" on approval cards, and a list of always-allowed actions you can revoke
status: todo
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
pnpm --filter @galena/web test
pnpm build
```

### Out of scope
- Mobile UI, a global "all rules" page, rule expiry, editing a rule.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
