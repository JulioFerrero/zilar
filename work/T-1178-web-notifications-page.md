---
id: T-1178
title: "WUX-5: web Notifications page — 'only while open' is information, not a red error shown twice; 'Blocked by the browser' hides Enable and says how to unblock; errors show inside the device card next to the button; no 'Open Zilar' text while in Zilar"
status: merged
milestone: M5
branch: task/T-1178-web-notifications-page
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1178: A clear Notifications page

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-5 (P1, confirmed).
- **"Only while open" shows twice:** on a browser without a push service, `usePushEnable` sets `onlyWhileOpen` **and** `setErrorMessage(PUSH_SERVICE_UNAVAILABLE)` (`apps/web/src/lib/push/usePushEnable.ts:166-174`). The page then shows the "Only while open" card (`apps/web/src/routes/NotificationsPage.tsx:110-127`) and the same sentence again, in red, at the bottom (`:162-166`).
- **A useless Enable button:** with permission `denied`, the card reads "Blocked by the browser" but still shows Enable (`NotificationsPage.tsx:39-44`, `apps/web/src/components/push/ThisDeviceCard.tsx:30-34`), and the click fails (`apps/web/src/lib/push/pageActions.ts:66`).
- **Errors far from their button:** all errors render after the Test section.
- **Wrong text:** `pageActions.ts:69` says "Open Zilar, wait for it to connect" while the user is in Zilar.

### What to build
1. **`usePushEnable.ts:166-174`:** don't set `errorMessage` for the only-while-open case.
2. **`ThisDeviceCard.tsx`:**
   - hide Enable when the state is blocked, and show one muted line instead: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.";
   - take an optional `errorMessage` prop and render it inside the card, under the buttons.
3. **`NotificationsPage.tsx`:** pass `errorMessage` to the card, and remove the bottom paragraph (`:162-166`). Errors from the Test section stay next to Test, if it has its own button; otherwise they go in the card.
4. **`pageActions.ts:69`:** reword to "Not connected yet. Wait a moment and try again."
5. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-5), `apps/web/src/lib/push/usePushEnable.ts:140-200`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/components/push/ThisDeviceCard.tsx` and `apps/web/src/lib/push/pageActions.ts`.

### Allowed files
`apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/components/push/ThisDeviceCard.tsx`, `apps/web/src/lib/push/pageActions.ts`, `work/T-1178-web-notifications-page.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the live web:** the Notifications page shows each message once, inside the card.

---

## Report (written by the worker when done)

### What I did

- **`usePushEnable.ts`** — on the "only while open" path (a browser without a push service) it now only sets `permission` and `onlyWhileOpen`; it no longer sets `errorMessage`, so the info appears once, in the card. Removed the now-unused `PUSH_SERVICE_UNAVAILABLE` constant. Added an `errorScope: 'card' | 'test'` field to the returned state so the page can place the single shared message in the right spot.
- **`ThisDeviceCard.tsx`** — hides the Enable button when `state === 'Blocked by the browser'` and shows one muted line in its place: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload." It now takes an optional `errorMessage` prop and renders it under the buttons, inside the card.
- **`NotificationsPage.tsx`** — passes the card message to `ThisDeviceCard`, shows a test failure next to the Test button, removed the bottom error paragraph (`:162-166`), and no longer computes the stale "come back and enable" detail for the blocked state. The "Only while open" card also renders the card message: it is shown instead of `ThisDeviceCard` and has its own Enable button, so without this its errors would disappear once the bottom paragraph is gone.
- **`pageActions.ts`** — reworded the offline text to "Not connected yet. Wait a moment and try again."

### Files changed

All inside the Allowed files: `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/components/push/ThisDeviceCard.tsx`, `apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/lib/push/pageActions.ts`, `work/T-1178-web-notifications-page.md`.

### Commands and results

- `pnpm install` — Done in 21.3s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/push` — 2 test files passed, 6 tests passed.
- `pnpm gate` — ended with `GATE PASS`. Summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.5s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/web  (6.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Tests

None written: UI-only change, per spec item 5. The existing `src/lib/push` tests still pass.

### Deviations from the spec / decisions

- Spec item 3 says errors from the Test section stay next to Test. The hook exposes one shared message, so I added `errorScope` to route `sendTest` next to Test and every other action into the device card. Item 1 of the spec does not mention this field.
- For the blocked state the muted line replaces the card's detail line (one line, no button) instead of sitting next to the old "come back and enable" text, so the message appears once as the acceptance asks. I removed the now-unreachable `permission === 'denied'` branch of `cardDetail` in `NotificationsPage` for the same reason.
- Rendered the card message in the "Only while open" card as well (see above).

### Acceptance

- The gate passes (result above).
- The lead's live web check (each message once, inside the card) was not run by me — it needs a real browser and permission states.

### Security checklist

Not applicable: no auth, keys, data writes, routes, or audit entries are touched.

### Open questions

None blocking. One judgement call is noted above: the blocked sentence lives in `ThisDeviceCard`, so `detail` is ignored for that state.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **"Only while open"** sets no error any more.
- **`ThisDeviceCard`:** Blocked hides Enable and shows how to unblock, and errors render inside the card.
- **Test errors** show next to Test (`errorScope`), and the bottom paragraph is gone.
- **The offline text** now reads "Not connected yet. Wait a moment and try again."
- **Still to do:** the live check on web.
