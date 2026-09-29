---
id: T-0097
title: Web: approval card refreshes itself, and the menu shows how many approvals wait (web)
status: todo
milestone: M4
branch: task/T-0097-approval-card-live-refresh
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0075, T-0081]
estimate: 0.5 day
---

# T-0097: Approval cards stay fresh; the menu shows a count

## Spec (written by Claude, do not edit)

### Goal

Now that AIs post real approval cards (T-0092/T-0093), two gaps show up in the web app:
1. The card loads its state **once**. If the request is decided elsewhere (the phone, another tab, an admin), or it expires while the chat is open, the card keeps showing "Approve / Deny" until a reload. It must refresh itself.
2. The main menu's **Approvals** entry gives no hint that something is waiting. It should show a small count of pending requests.

### Design (decided; follow it)

**Card refresh** (`components/ApprovalCard.tsx`):
- While the card's state is `ready` with status `pending`, re-read the approval every **10 seconds**, only while the page is visible (`document.visibilityState === 'visible'`), and also once right away when the tab becomes visible again (`visibilitychange`). Stop polling as soon as the status is anything other than `pending` (`approved_once`, `approved_always`, `denied`, `consumed`, `expired`), and on unmount or when `request.id` changes.
- A failed poll must **not** replace a good state with the error state: keep showing the last good state and try again on the next tick.
- While the card is in the `notDecidable` state (the viewer may not decide, the server answers 404), do **not** poll (nothing to learn).
- Also stop polling once `expires_at` from the request has passed and the last read said `pending`: do one final read, then show whatever the server says.
- Use the existing `getApproval` from `lib/api.ts`. No new dependencies. Poll interval and the visibility check must be testable with fake timers; keep the polling logic in a small custom hook in its own file (e.g. `lib/useApprovalPolling.ts`) with its own tests, and keep the component's rendering as it is.
- Lint pitfalls: no `setState` synchronously inside an effect body (the repo's lint forbids it); set state only in async callbacks/timers. Never disable a lint rule.

**Menu count** (`components/ChatList.tsx` main menu, plus a tiny hook):
- A hook `usePendingApprovalCount()` (own file under `lib/`) calls `listApprovals()` once when the menu opens (not on every render) and reports `number | null` (`null` = unknown or failed → show no badge, never an error). Count = entries with status `pending`. A rejected call leaves the previous value.
- The "Approvals" menu item shows a small pill with the count when it is above 0 (cap the display at `9+`). Style with existing tokens (see how other pills/badges are styled in the app).
- No polling for the menu; the count refreshes each time the menu opens.

**Mock mode:** `?mock=1` keeps working (`mock/api.ts` already seeds a pending approval `apr-42`; the count there is therefore 1).

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`, `lib/api.ts` (`getApproval`, `listApprovals`, `PublicApproval`), `routes/ApprovalsPage.tsx` (how the inbox loads), `components/ChatList.tsx`, `ChatList.test.tsx`, `mock/api.ts`
- `docs/LEAD_PLAYBOOK.md` gotchas about oxlint `react(set-state-in-effect)` and `react-hooks/exhaustive-deps`, and mock mode (`?mock=1` is dropped by in-app navigation; use the deep link)

### Allowed files
- `apps/web/src/components/ApprovalCard.tsx`, `ApprovalCard.test.tsx`
- `apps/web/src/components/ChatList.tsx`, `ChatList.test.tsx`
- `apps/web/src/lib/useApprovalPolling.ts` (+ test), `apps/web/src/lib/usePendingApprovalCount.ts` (+ test)
- `apps/web/src/mock/api.ts` only if needed
- `work/T-0097-approval-card-live-refresh.md`

**Not allowed:** server, mobile, packages, new dependencies, other components.

### Tests (Vitest, fake timers, no network)
- Polling hook: polls every 10 s while pending and visible; does not poll while hidden; refreshes once when visibility returns; stops after a non-pending status; a failed poll keeps the last good state; stops on unmount and on id change; one final read after `expires_at`; no polling for `notDecidable`.
- Card: shows Approve/Deny while pending, and after a poll returns `approved_once` shows the decided state without a click; a poll that returns `expired` removes the buttons.
- Menu count: hidden for 0 and for `null`; shows `3`; `9+` for ten or more; the call is made when the menu opens, not before.

### Live check (the lead does it)
Chrome, `?mock=1` deep link: the menu badge shows 1; open the card's chat and decide from the Approvals page in another tab (mock state is per tab, so only verify the badge and that a decided card stays decided); the real-stack polling is unit-tested only. Say so in the Report.

### Acceptance criteria
- [ ] The card never polls when hidden, when not pending, or when the viewer cannot decide.
- [ ] A failed refresh never flips a good card into an error.
- [ ] The badge never shows an error and never blocks the menu.
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
- Server push (SSE) for approvals, mobile, an unread-style badge on the chat list, notification sounds.

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
