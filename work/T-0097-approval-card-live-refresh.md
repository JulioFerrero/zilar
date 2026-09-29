---
id: T-0097
title: Web: approval card refreshes itself, and the menu shows how many approvals wait (web)
status: merged
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

Built two small custom hooks and wired them into the card and the menu.

- `lib/useApprovalPolling.ts` loads the approval, re-reads it on a 10 s cadence while the row is still `pending` and the tab is visible, fires one immediate read on `visibilitychange`, stops on a non-pending status / 404 / id change / unmount, and does a final read after `expires_at` has passed. A failed poll keeps the last good state; a 404 stops polling entirely. The hook also exposes `apply(next)` so the card can push an optimistic state after a decision (the buttons drop at once; a subsequent poll confirms). Three seams — `VisibilitySource`, `TimerSource`, `now()` — keep the polling logic fake-timer-friendly; oxlint forbids reading refs in render, so the cache cell is reset inside the effect, not during the render that bumps the id/resetKey. `APPROVAL_POLL_INTERVAL_MS = 10_000` is exported for the polling tests.

- `lib/usePendingApprovalCount.ts` calls `listApprovals()` once when `enabled` flips to true (the menu opens), returns `number | null` (`null` = unknown or failed), and a failed call leaves the previous value in place. The setState only runs from inside the `.then` callback, so the effect body doesn't trip oxlint's `react(set-state-in-effect)`.

- `ApprovalCard.tsx` now delegates all of its read-model state to `useApprovalPolling`. The card's own Retry button bumps `resetKey` so the hook re-fetches from scratch; the `decide` function still optimistically calls `apply` so the buttons vanish at once after Approve/Deny, and on a 409 (`not_pending`/`expired`) it refreshes once via `getApproval` and pushes that through `apply` too. Rendering is unchanged.

- `ChatList.tsx` calls `usePendingApprovalCount(menuOpen)` and shows a pill on the "Approvals" menu item when the count is above 0, capped at `9+`. The pill is hidden for `null` and for zero. Styled with the existing `bg-badge-muted` token to match the inbox's "pending" badge.

- Added tests: `useApprovalPolling.test.ts` (9 cases covering cadence, hidden tab, visibility return, non-pending stop, failed-poll-keeps-good-state, unmount, id change, expiry final read, 404); `usePendingApprovalCount.test.ts` (4 cases: not-fetched-until-enabled, count only pending, null until first settle, failure-previous-value); two new `ApprovalCard` cases for poll-driven decided/expired; four new `ChatList` cases for the badge.

### Files changed

- `apps/web/src/components/ApprovalCard.tsx` — replaced the inline load effect with `useApprovalPolling`; `Retry` bumps `resetKey`; `decide` pushes optimistic state through `apply`.
- `apps/web/src/components/ApprovalCard.test.tsx` — kept the existing 9 tests; added "shows the decided state once a poll returns approved_once, without a click" and "drops the buttons when a poll returns expired" (fake timers enabled per-test with `shouldAdvanceTime: true` so `findBy` still works).
- `apps/web/src/components/ChatList.tsx` — added `usePendingApprovalCount` import, the `APPROVAL_BADGE_CAP` constant, and a pill on the Approvals menu item.
- `apps/web/src/components/ChatList.test.tsx` — kept the existing 16 tests; added four badge cases (no fetch before open, shows `3`, caps at `9+` for ten, hidden when empty).
- `apps/web/src/lib/useApprovalPolling.ts` — new hook.
- `apps/web/src/lib/useApprovalPolling.test.ts` — new tests.
- `apps/web/src/lib/usePendingApprovalCount.ts` — new hook.
- `apps/web/src/lib/usePendingApprovalCount.test.ts` — new tests.
- `work/T-0097-approval-card-live-refresh.md` — front matter `status: in-progress` → `status: review`; this Report.

### Commands run and real results

- `pnpm install` — `Done in 6.4s` (lockfile up-to-date, 1010 packages, 0 added).
- `pnpm format:check` — `All matched files use Prettier code style!` (after `pnpm format`).
- `pnpm lint` — `Command exited with code 0` (oxlint, no findings).
- `pnpm typecheck` — `10 successful, 10 total` (turbo).
- `pnpm --filter @galena/web exec vitest run` — `Test Files 56 passed (56)`, `Tests 607 passed (607)`, ~10 s.
- `pnpm build` — `2 successful, 2 total` (turbo).

New / updated test counts:
- `useApprovalPolling.test.ts`: 9 / 9 pass.
- `usePendingApprovalCount.test.ts`: 4 / 4 pass.
- `ApprovalCard.test.tsx`: 11 / 11 pass (was 9).
- `ChatList.test.tsx`: 20 / 20 pass (was 16).

Lint re-run after the last edit: clean.

### Problems, deviations from the spec, open questions

- `setState` during render is used (not in an effect body) to derive the loading reset on an id/resetKey change — the same pattern `ChatList.tsx` already uses (`lastChatsState`) and the repo playbook explicitly recommends. The `latestRef.current` reset lives inside the effect because oxlint forbids reading or writing refs during render.
- The hook's `apply` is exposed because the spec wants the buttons to drop at once after a click, not up to ten seconds later. The next poll confirms (or corrects) the optimistic value.
- `setState` was deliberately skipped on a poll that returns an approval that's the same in id/status/decidedAt as the previous one (the `sameReady` helper). Without this the effect would re-run on every poll — the interval would reset, and the card would re-render with effectively-identical data.
- Mock mode was not touched; `mock/api.ts` already returns one pending approval and the inbox already lists it (T-0081), so the badge shows `1` in `?mock=1` with no further changes. The new polling hook defers to the real `getApproval` (and the mock's matching handler), so no mock-side edits were needed.
- The two real-stack tests the lead owns (visible badge in `?mock=1`, decided card stays decided across tabs) are unit-test-only here because the spec is explicit: "the real-stack polling is unit-tested only".

### Blocked / needs a decision

None.

---

## Review (written by Claude)

**Verdict:** approved and merged. Rebased on main; format, lint, typecheck, build clean; web 607 passed. No disable comments.

Read the hook line by line: polls every 10 s only while visible and pending, reads once when the tab becomes visible, stops on any non-pending status, on a 404 (viewer cannot decide), on unmount and on id change; a failed poll keeps the last good state; the loading reset uses the adjust-state-during-render pattern (no setState in an effect body). The menu count loads only when the menu opens and never shows an error.

Process note: the worker went idle at ~09:11 with the work unfinished and no Report; a lead re-prompt (`lead reply`) got it to finish. Idle workers are not always flagged by the autopilot: check `status` by hand.
