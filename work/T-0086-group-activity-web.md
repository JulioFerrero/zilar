---
id: T-0086
title: Web — an Activity section in the group panel for group owners and admins (the audit entries of the room)
status: todo
milestone: M4
branch: task/T-0086-group-activity-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0084]
estimate: 0.5 day
---

# T-0086: Group activity in the web panel

## Spec (written by Claude, do not edit)

### Goal

T-0084 added an Activity section to the AI panel (`AiActivity`), fed by `GET /api/audit?aiId=…`. The same endpoint answers `?groupId=…` for the group's **owner and admins** (anyone else gets an empty page, indistinguishable from an unknown group). Show it in the **group panel** for owners and admins: the approvals decided in that room and whatever the audit log gains later.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/components/ais/AiActivity.tsx` and `AiActivity.test.tsx` (the component to generalise), `AiPanel.tsx` (how it is mounted) and `work/T-0084-ai-activity-web.md` (spec, report, review)
- `apps/web/src/components/GroupPanel.tsx` and `GroupPanel.test.tsx` (`isManager`, sections, how tests fake the api), `apps/web/src/lib/api.ts` (`listAudit`, `PublicAuditEntry`) and its tests
- `apps/web/src/mock/api.ts` (the mock `/audit` route)
- `apps/server/src/audit/routes.ts` and `service.ts` (the wire contract; do not edit)

### Allowed files (under `apps/web/`)
- `src/components/ais/AiActivity.tsx` and `AiActivity.test.tsx` (generalise: see below), `src/components/GroupPanel.tsx`, `GroupPanel.test.tsx`
- `src/lib/api.ts`, `src/lib/api.test.ts` (`listAudit` accepts `{ groupId }` as an alternative to `{ aiId }`)
- `src/mock/api.ts`, `src/mock/api.test.ts` (serve `?groupId=` in mock mode with a couple of entries)
- `work/T-0086-group-activity-web.md` (path from the repo root)

**Not allowed:** anything else, `apps/server/**`, `packages/**`, mobile. No new dependencies.

### What to build
1. `listAudit` takes `{ aiId } | { groupId }` (exactly one; a type that makes both or neither a compile error), plus `limit` and `before`.
2. Generalise `AiActivity` into a component that takes a `scope` (`{ aiId }` or `{ groupId }`), keeping the current behavior, tests and the `AiActivity` export working for the AI panel (a thin wrapper is fine). Keep `describeAuditEntry` as it is; for entries in a group the words stay the same ("A request was approved"). Nothing but `detail.decision` may reach the DOM, as before.
3. In `GroupPanel`, when `isManager` (owner or admin) show an "Activity" section at the bottom with the group scope. Plain members do not see it and no request is made for them. A failure of the section never breaks the panel.
4. Mock mode returns a few entries for the mock groups.

### Tests
- `listAudit` with `groupId` (path and query), the type constraint is compile-time only (say so).
- The generalised component still passes every existing `AiActivity` test; add cases for the group scope.
- `GroupPanel`: a manager sees the section and one request is made; a member does not and no request is made; a failing section leaves the panel intact.

### Live check (the lead does it)
If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode (deep link with `?mock=1`) and screenshot the group panel, but **do not commit screenshots**; say what you did in the Report.

### Acceptance criteria
- [ ] Owners and admins see the room's activity; members see nothing and cause no request.
- [ ] The AI panel's Activity keeps working unchanged.
- [ ] Nothing from `detail` other than the decision reaches the DOM.
- [ ] No `any`, no `@ts-ignore`, no new dependencies, no `console.log`, no screenshots in the commit; lint passes (re-run it after your last edit).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Filters, export, retention, the server, mobile.

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
