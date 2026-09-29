---
id: T-0082
title: Mobile — the approval card decides for real (Approve / Deny call the approvals API and the card shows its state)
status: todo
milestone: M4
branch: task/T-0082-approvals-mobile
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0073, T-0076]
estimate: 0.75 day
---

# T-0082: Approvals on the phone

## Spec (written by Claude, do not edit)

### Goal

The web card already decides for real (T-0076). On mobile the card's two buttons still only `console.log`. Port the behavior: the card loads its state from `GET /api/approvals/:id`, shows Approve / Deny only to someone who may decide and only while the request is pending, sends the decision, and shows the outcome. The `id` in the card payload (`ApprovalRequest.id`) **is** the server's approval id.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0076-approvals-web.md` (spec, report and review) and the finished web card: `apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/lib/api.ts` (`getApproval`, `decideApproval`, the status set) — the behavior to copy
- `apps/server/src/approvals/routes.ts` and `service.ts` (`PublicApproval`; 404 means "you may not decide it or it does not exist"; 409 codes `not_pending` / `expired`) — do not edit the server
- `apps/mobile/src/components/chat/approval-card.tsx` (the card today) and `payload-card.tsx`
- `apps/mobile/src/lib/ais-api.ts` and `ais-api.test.ts` (**the pattern to follow**: no zod on mobile, type guards at the boundary, an error class that keeps the server's `code` and `status`, a factory taking a token/base-URL provider), `components/ais/use-ais-api.ts` (how a screen gets the api instance and the session token) and `chat-api.ts`
- `apps/mobile/src/mock/` (how mock mode fakes APIs, e.g. `mock/ais.ts`), and how the chat screen picks mock vs real

### Allowed files (under `apps/mobile/`)
- `src/lib/approvals-api.ts`, `src/lib/approvals-api.test.ts` (new)
- `src/components/chat/approval-card.tsx` and a new test next to it if the project tests components this way (look at `reaction-chips.test.tsx` and `markdown-text.test.tsx` for the pattern)
- a small hook file such as `src/components/chat/use-approvals-api.ts` (new), modeled on `use-ais-api.ts`
- `src/mock/` (a new `approvals.ts` mock and its test) so mock mode shows a pending card that can be approved
- `work/T-0082-approvals-mobile.md` (path from the repo root)

**Not allowed:** anything else, `packages/**`, `apps/server/**`, `apps/web/**`, new dependencies. Do not touch the simulators DB167CD4 / A3E0C081 or ports 3000 / 8081 / 5173: every check here is a unit test.

### What to build
1. `approvals-api.ts`: `getApproval(id)` and `decideApproval(id, decision, note?)` with type guards for the wire shape (`id, aiId, groupId, action, summary, details, argsHash, worstCase, requestedBy, status, decidedAt, note, expiresAt, createdAt`; statuses `pending | approved_once | approved_always | denied | consumed | expired`), an `ApprovalsApiError` with `status` and `code`, ids through `encodeURIComponent`, network failure mapped to an error with a clear message.
2. `ApprovalCard` loads its state on mount and:
   - **loading:** the request text renders at once (from the payload); the action area shows nothing or a small skeleton, no layout jump;
   - **404:** the muted line "Waiting for a decision", no buttons, no error;
   - **pending:** Approve (sends `approve_once`) and Deny (sends `deny`); both disabled while a request is in flight (no double submit); on success show the outcome; on 409 (`not_pending` / `expired`) reload the state and show it; on other errors one short inline message, buttons stay;
   - **decided / expired / consumed:** no buttons; a status line: "Approved" (also for `approved_always`), "Denied", "Expired", "Already used";
   - **first-load failure (not 404):** the request text plus "Could not load the decision state" and a Retry button;
   - **no "always allow"** anywhere.
3. Buttons keep their current look (`variant="key"` for Approve, outline for Deny) and get accessibility labels naming the action.
4. Mock mode: the mock approval card in the mock chat shows Approve/Deny and can be decided (in memory), answering 409 on a second decision, like the server.

### Tests (Vitest, no network, no device)
- `approvals-api.test.ts`: paths, methods, bodies, guard failures becoming `ApprovalsApiError`, 404/409 mapping, network failure.
- Card tests (or, if components cannot be rendered in this project, test the state logic in a plain hook/reducer that the card uses, and say so in the Report): every state above, no double submit, 409 reload, Retry.
- Mock module test.

### Live check (the lead does it)
Not needed from you; say in the Report that no on-device check was done.

### Acceptance criteria
- [ ] Approve and Deny work against the API; no double submit.
- [ ] Someone who may not decide sees no buttons and no error.
- [ ] No "always allow", no `console.log`.
- [ ] Mock mode shows a working card.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/mobile
pnpm build
```

### Out of scope
- An approvals inbox screen, push notifications, standing rules, the server, web.

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
