---
id: T-0076
title: Web — the approval card decides for real (Approve / Deny call the approvals API, and the card shows its state)
status: merged
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
- `apps/web/src/lib/api.ts`: added `ApprovalStatus` / `ApprovalDecision` types, the `publicApprovalSchema` zod schema (matches the server's `PublicApproval`, with ISO-string dates and `worstCase` nullable), `getApproval(id)` and `decideApproval(id, decision, note?)` functions. Ids go through `encodeURIComponent`. No `any`, no new dependencies.
- `apps/web/src/components/ApprovalCard.tsx`: replaced the dead, disabled buttons with the real flow. On mount, `getApproval(request.id)` runs once with an `active` flag for unmount safety. States: `loading` (skeleton placeholder, no layout jump), `notDecidable` (404 → "Waiting for a decision" muted line, no buttons, no error), `error` (muted "Could not load the decision state" + Retry), and `ready` with a `PublicApproval`. `pending` shows Approve (sends `approve_once`) and Deny (sends `deny`), both with an in-flight label ("Approving…" / "Denying…") and both disabled while a request is in flight so a double click never double-submits. Decisions that hit `not_pending` / `expired` (HTTP 409) trigger a reload; any other error shows an inline `FieldError` and keeps the buttons. Decided / expired requests show a `role="status"` line: "Approved" (for `approved_once` and `approved_always`), "Denied", "Expired", or "Already used" (for `consumed`). No "always allow" button is rendered. The "pending and not expired" check trusts the server's read model: `toPublicApproval` already maps a past-due `pending` row to `expired`, so a `pending` status from the server is by construction not expired.
- `apps/web/src/mock/api.ts`: added `MockApproval` rows to the state, seeded one pending row with `id: 'apr-42'` (matching the `approvalCard()` in `helpers.ts` and the message in the dev-team chat). Added the `approvals` route family to `mockRequest`: `GET /approvals` (only pending & unexpired), `GET /approvals/:id` (404 for unknown ids), and `POST /approvals/:id/decision` which validates the body, returns 409 `not_pending` for any second decision, and 400 `invalid_request` for an unknown decision value. The response shape is built from `approvalCard()` plus the local decision row, so the card payload matches the chat message.
- Tests:
  - `api.test.ts`: 9 new tests for `getApproval`, `decideApproval`, and `publicApprovalSchema` (URL encoding, body shape with and without `note`, 404, 409, wrong-shape → `invalid_response`).
  - `ApprovalCard.test.tsx`: rewrote from the dead-button test to the new flow — loading → buttons, Approve sends `approve_once` and shows "Approved", Deny sends `deny` and shows "Denied", 404 shows no buttons, already-decided shows its status, `consumed` shows "Already used", `expired` shows "Expired", 409 reloads, a network failure shows Retry and Retry works, and the in-flight test verifies both buttons disable and only one POST is sent (no double submit).
  - `mock/api.test.ts`: 5 new tests covering the seeded approval, approve → 409 on second decision, deny (with note), 404 on unknown id, and 400 on an invalid decision body.

### Files changed
- `apps/web/src/components/ApprovalCard.tsx` (rewritten)
- `apps/web/src/components/ApprovalCard.test.tsx` (rewritten)
- `apps/web/src/lib/api.ts` (added approvals section)
- `apps/web/src/lib/api.test.ts` (added approvals tests)
- `apps/web/src/mock/api.ts` (added mock approvals routes and seed row)
- `apps/web/src/mock/api.test.ts` (added mock approvals tests)
- `work/T-0076-approvals-web.md` (this Report)

### Commands run and real results
- `pnpm install`: `Scope: all 11 workspace projects / Lockfile is up to date / Packages: +1010 / Done in 6.4s using pnpm v10.32.1` — exit 0
- `pnpm exec turbo typecheck --force --filter=@galena/web`: `Tasks: 1 successful, 1 total / Time: 3.0s` — exit 0
- `pnpm exec turbo test --force --filter=@galena/web`: `Test Files 51 passed (51) / Tests 483 passed (483) / Tasks: 1 successful, 1 total / Time: 9.0s` — exit 0 (24 tests in `mock/api.test.ts`; 27 in `lib/api.test.ts`; the new `ApprovalCard.test.tsx` has 9 tests.)
- `pnpm format:check`: `All matched files use Prettier code style!` — exit 0
- `pnpm lint`: `oxlint .` — exit 0
- `pnpm exec turbo build --force --filter=@galena/web`: built in 502 ms, no errors — exit 0
- `pnpm exec vite --port 5174 --strictPort` (live check, mock mode via `?mock=1`): `VITE v8.3.1 ready in 163 ms / Local: http://localhost:5174/`; `curl http://localhost:5174/?mock=1` → HTTP 200, served the SPA shell. I don't have a headless browser in this environment, so I couldn't capture a screenshot; I verified the server starts, serves, and the rest of the build pipeline succeeds. The dev-team chat in `apps/web/src/mock/messages.ts` carries the `approvalCard()` (id `apr-42`), which matches the seeded mock approval and therefore renders the live card with Approve / Deny.

### Problems, deviations from the spec, open questions
- "Always allow" handling: the server already accepts `approve_always` and stores it as `approved_always`; the UI does not offer it (spec requirement) but the schema and the mock both accept it on the wire, so a future task can add a third button without further changes here.
- "Expired" without a refetch: I trust the server to map past-due `pending` rows to `expired` in `toPublicApproval`, and the mock does the same. The card therefore never has to compute `Date.now()` during render, which keeps it compatible with the project's strict-purity lint rules.
- `consumed` is only produced by `verifyApproval` on the server, not by `decideApproval`. The mock and the schema both understand it (so the card shows "Already used"), but the mock's decision endpoint never returns it.
- The card text "Pending" appears in `statusLabel` but the spec only lists the four terminal labels; pending is never rendered as a status line because `isPending` shows the buttons instead. The helper covers the case where a future task might want to display "Pending" elsewhere.

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:** approved with a lead cleanup, merged (2026-09-29). Rebased on main; format, lint, typecheck, test (web 483) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand.

**Lead change:** the card had the same load-and-map-errors block twice (mount effect and Retry); it is now one `loadState()` helper.

**Checked:** Approve sends `approve_once`, Deny sends `deny`, both disable while a request is in flight, a 409 reloads the state, a 404 shows "Waiting for a decision" with no buttons and no error, and no "always allow" is offered. The mock serves the seeded `apr-42` request and answers a second decision with 409.

**Visual check (lead, mock mode, own port 5181):** with `?mock=1` in the URL the card in the Dev team chat shows Approve and Deny; clicking Approve turns it into "Approved". Note: after an in-app navigation that drops `?mock=1` (e.g. clicking the chat in the list) the mock API is off and the card falls back to "Waiting for a decision" because there is no server behind the dev port. That is how the gate from T-0069 works, not a card bug, but it means mock mode should be entered with the deep link.

**Open:** real end-to-end (a real approval row, a real card in a room) needs the engine to create approvals and post the card, a later task.
