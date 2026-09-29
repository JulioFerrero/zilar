---
id: T-0076
title: Web — the approval card decides for real (Approve / Deny call the approvals API, and the card shows its state)
status: todo
milestone: M4
branch: task/T-0076-approvals-web
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073]
estimate: 1 day
---

# T-0076: Approvals in the web app

## Spec (written by Claude, do not edit)

### Goal

T-0073 added the server side: `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decision`. The chat's `ApprovalCard` still has two dead, disabled buttons. Make it work: the card loads its own state from the server, shows Approve / Deny only to someone who may decide and only while the request is pending, sends the decision, and then shows the outcome.

The `id` in the card payload (`ApprovalRequest.id`) **is** the server's approval id: the engine (a later task) creates the row with `createApproval` and puts that id into the card it posts.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/approvals/routes.ts` and `service.ts` (`PublicApproval` is the wire shape; statuses; which errors are 404 / 409 / 400) — do not edit the server
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`, `MessageBubble.tsx` (how the card is rendered)
- `apps/web/src/lib/api.ts` (`request`, `ApiError`, how the machines and connections calls are written and tested) and `api.test.ts`
- `apps/web/src/mock/api.ts` (`mockRequest`, how routes and state are declared) and `mock/helpers.ts` (`approvalCard()`), `mock/api.test.ts`
- `apps/web/src/components/machines/*` for the style of buttons with a busy state and inline error text

### Allowed files (under `apps/web/`)
- `src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`
- `src/lib/api.ts`, `src/lib/api.test.ts`
- `src/mock/api.ts`, `src/mock/api.test.ts` (serve the three approval routes in mock mode; the mock approval for `approvalCard()` must be pending and decidable so the buttons show)
- `work/T-0076-approvals-web.md` (path from the repo root)

**Not allowed:** anything else, in particular `MessageBubble.tsx` (the card keeps its `request` prop), the store, `apps/server/**`, `packages/**`, mobile. No new dependencies.

### What to build
1. `lib/api.ts`: `getApproval(id)` and `decideApproval(id, decision, note?)` with a zod schema for the wire shape (dates arrive as ISO strings; keep them strings or parse to `Date`, in the style of the machines calls). Ids go through `encodeURIComponent`. Statuses: `pending | approved_once | approved_always | denied | consumed | expired`.
2. `ApprovalCard`: on mount it calls `getApproval(request.id)`.
   - **loading:** the request text renders at once (from the payload); the action area shows a small skeleton or nothing, no layout jump.
   - **404** (you may not decide it, or it does not exist): show the request text and a muted line "Waiting for a decision" with no buttons. Do not show an error.
   - **pending and not expired:** Approve and Deny buttons. Approve sends `approve_once`; Deny sends `deny`. Both disable while a request is in flight. On success show the outcome. On 409 (`not_pending` / `expired`) reload the state and show it. On any other error show one short inline message and keep the buttons.
   - **decided or expired:** no buttons; a status line: "Approved", "Denied", "Expired", or "Already used" (for `consumed`). Show it also for `approved_always` as "Approved".
   - The card must **not** offer "always allow" (standing rules do not exist yet).
   - Network/other errors on the first load: show the request text and a muted "Could not load the decision state" with a Retry button.
3. Mock mode: `mockRequest` serves `GET /approvals/:id` and `POST /approvals/:id/decision` for the mock approval (in-memory, resets with the mock state), enforcing pending-only decisions and answering 404 for unknown ids.
4. Accessibility: the status line has `role="status"`; buttons keep visible labels.

### Tests
- `api.test.ts`: each new function (path, method, body, schema failure becomes `ApiError`).
- `ApprovalCard.test.tsx` (fake the api module or `fetch` the way the machines tests do): loading, pending shows buttons, approve sends `approve_once` and shows "Approved", deny, a 404 shows no buttons, an already-decided request shows its status, a 409 reloads, a failing first load shows Retry and Retry works, buttons are disabled while in flight (no double submit).
- `mock/api.test.ts`: the mock routes, including a second decision answering 409.

### Live check (the lead does it)
If you can, run the web dev server on a **free port other than 3000, 5173 and 8081** in mock mode and screenshot the card in its pending and approved states; say what you did in the Report.

### Acceptance criteria
- [ ] Approve and Deny work against the API and never double-submit.
- [ ] Someone who may not decide sees no buttons and no error.
- [ ] No "always allow" anywhere.
- [ ] Mock mode shows a working card.
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
- The server, the engine creating approvals, the XMPP message that carries the card, standing rules, mobile, a list of pending approvals page.

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
