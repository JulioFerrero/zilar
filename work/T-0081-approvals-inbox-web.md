---
id: T-0081
title: Web — an Approvals inbox (Settings → Approvals) listing every pending request you may decide, with Approve / Deny
status: todo
milestone: M4
branch: task/T-0081-approvals-inbox-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073, T-0076]
estimate: 0.75 day
---

# T-0081: Approvals inbox

## Spec (written by Claude, do not edit)

### Goal

Approval cards live in the chat where the AI asked. When there are several rooms and several AIs, the owner needs one place that shows **everything waiting for them**. The server already has `GET /api/approvals` (pending, unexpired, decidable by the caller, newest first, max 100) and `POST /api/approvals/:id/decision` (T-0073), and the web has `getApproval` / `decideApproval` (T-0076). This task adds the page: **Settings → Approvals**.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/routes/MachinesPage.tsx` (the closest model: shell, loading skeleton, error state with retry, per-row busy and inline errors) and `AiPageShell` (`AiPageShell`, `Button`, `FieldError`)
- `apps/web/src/components/ApprovalCard.tsx` (the wording, statuses and 404/409 handling that the card already has) and `lib/api.ts` (`PublicApproval`, `publicApprovalSchema`, `decideApproval`)
- `apps/web/src/components/ChatList.tsx` (the settings menu), `routes/AppRoutes.tsx` (how `/settings/machines` is registered and guarded)
- `apps/web/src/mock/api.ts` (the seeded pending approval and the list route) and `mock/api.test.ts`
- `apps/server/src/approvals/routes.ts` (the wire shape; do not edit)

### Allowed files (under `apps/web/`)
- `src/routes/ApprovalsPage.tsx`, `src/routes/ApprovalsPage.test.tsx` (new)
- `src/components/approvals/` (new folder for small row components and tests, if you split the page)
- `src/routes/AppRoutes.tsx` (the route), `src/components/ChatList.tsx` (one menu item) and their tests if they exist
- `src/lib/api.ts`, `src/lib/api.test.ts` (`listApprovals`)
- `src/mock/api.ts`, `src/mock/api.test.ts` only if the mock list route needs to change
- `work/T-0081-approvals-inbox-web.md` (path from the repo root)

**Not allowed:** anything else, in particular `ApprovalCard.tsx` (it keeps working as it is), the store, `apps/server/**`, `packages/**`, mobile. No new dependencies.

### What to build
1. `lib/api.ts`: `listApprovals(): Promise<PublicApproval[]>` (zod array of the existing schema).
2. **Page** at `/settings/approvals`, same look and structure as the Machines page: a back arrow to the chat list, the title "Approvals", a short helper line ("Requests from your AIs that are waiting for you."), then:
   - **loading:** a skeleton (a couple of rows), no layout jump;
   - **empty:** "Nothing is waiting for you." with a muted icon;
   - **error:** a message and a Retry button;
   - **list:** one row per request, newest first: the action name, the summary, details if present (muted), "Worst case: €x" when set, the time it was requested and how long it has left ("expires in 12 min", from `expiresAt`; compute the relative text in a helper that takes `now` as a parameter so it is testable and pure during render), and **Approve** and **Deny** buttons. Approve sends `approve_once`; Deny sends `deny`. **No "always allow".**
   - after a successful decision the row shows the outcome briefly ("Approved" / "Denied") and disappears from the list on the next refresh; a 409 (`not_pending` / `expired`) removes the row and shows a one-line notice at the top ("That request was already decided or expired."); other errors show inline on the row and keep its buttons. Buttons disable while a request is in flight (no double submit).
   - the list refreshes when the page regains focus and every 30 s while it is open (clear the timer on unmount), and there is a manual refresh button.
3. **Navigation:** an "Approvals" item in the settings menu of `ChatList` (next to Machines), routed to the page; the route is guarded like the other settings pages.
4. Mock mode shows the seeded pending approval; approving it removes it from the list.

### Tests (Vitest + Testing Library, fake the api module or `fetch` like the machines tests)
- `api.test.ts`: `listApprovals` path, schema failure becomes `ApiError`.
- Page: loading, empty, error + retry, list rendering with the relative expiry text, approve and deny call `decideApproval` with the right decision and update the row, 409 removes the row and shows the notice, other error stays inline, no double submit, the 30 s refresh with fake timers and cleanup on unmount, the menu item navigates.

### Live check (the lead does it)
If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode (enter it with a deep link that has `?mock=1`, the query is dropped on in-app navigation) and screenshot the page in its list and empty states; say what you did in the Report.

### Acceptance criteria
- [ ] The page lists pending requests and decides them for real, without double submits.
- [ ] Nothing offers "always allow".
- [ ] Loading, empty and error states exist and look like the Machines page.
- [ ] Timers are cleaned up; no state updates after unmount.
- [ ] No `any`, no `@ts-ignore`, no new dependencies, no `console.log`.

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
- A history of decided requests, filters, push notifications, mobile, standing rules, the server.

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
