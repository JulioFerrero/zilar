---
id: T-1435
title: "Web small UX fixes from the findings sweep: handle gate remembers 'Skip' (WUX-17), invite check shows a delayed spinner (WUX-18), a new deploy offers Reload (WUX-44)"
status: merged
milestone: M5
branch: task/T-1435-web-small-ux
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1435: Web small UX fixes

## Spec (written by Claude, do not edit)

### Why
The findings sweep (T-1433, `docs/audit/findings-sweep-client.md` on its branch) confirmed these three are still open on main. Each finding's full text is in `docs/audit/web-ux-audit.md`.

### Facts (the lead read them on main, 2026-10-15)
- **WUX-17:** the handle-gate dismissal is kept in `window.sessionStorage` (`apps/web/src/lib/handleGate.ts:19-23`, `sessionStep`), so the "pick a username" gate asks again in every new browser session.
- **WUX-18:** `apps/web/src/routes/JoinPage.tsx:113-119` (and the second loading state at `:147-153`) renders a bare "Checking your invite link…" with no spinner and no delay. A helper exists at `apps/web/src/lib/useDelayed.ts:10` (`useDelayed(value, delayMs)`).
- **WUX-44:**
  - `apps/web/src/App.tsx:13-20` registers the service worker and ignores what happens next;
  - `apps/web/public/sw.js:55` calls `self.skipWaiting()` on install, so a new worker takes control at once;
  - the open page keeps running the old bundle with no prompt;
  - a reload banner already exists for protocol mismatches: `apps/web/src/components/ClientVersionBanner.tsx:9-25` ("A new version is available." + Reload).

### What to build
1. **WUX-17:** keep the dismissal in `localStorage` with the same key, so Skip is remembered across sessions on this browser. Clear it on sign-out if the gate's other state is cleared there. Keep the `Effect.try` fallback.
2. **WUX-18:** both loading states show the spinner used elsewhere for inline loading (the kit's `StateMessage` loading or the existing spinner), only after 400 ms via `useDelayed`. Before that, show an empty centered area, so a fast check never flashes.
3. **WUX-44:**
   - when the page already had a controller and `navigator.serviceWorker` fires `controllerchange` (a new deploy's worker took over), show the existing banner;
   - give `ClientVersionBanner` an optional `reason` prop, or render the same component, rather than duplicating it;
   - don't show it on the first install (no previous controller);
   - Reload calls `location.reload()`.

### Tests
None (UI).

### Allowed files
- `apps/web/src/lib/handleGate.ts`, `apps/web/src/routes/JoinPage.tsx`
- `apps/web/src/App.tsx`, `apps/web/src/components/ClientVersionBanner.tsx`, `apps/web/src/lib/push.ts`
- `work/T-1435-web-small-ux.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Each change stays within its finding.
- Every file stays at 400 lines or fewer.

---

## Report (written by the worker when done)

**Status: review.** All three findings are implemented; the gate passes.

### What I did

**WUX-17 — Skip is remembered across browser sessions** (`apps/web/src/lib/handleGate.ts`)
- `sessionStep` → `storageStep`: the dismissal now reads and writes `window.localStorage` instead of `sessionStorage`, keeping the same key `zilar:handleGateDismissed:<userId>` and the same `Effect.try` fallback to the in-memory `Set` when storage throws.
- `resetHandleGateDismissal()` with no user id (the sign-out / switch-user path in `store/effects/lifecycle.ts` and `lib/api/sessionGone.ts`) now also removes every persisted key with the `zilar:handleGateDismissed:` prefix, so a sign-out clears the remembered skips rather than leaving them behind. It only touches that prefix, never the whole store. Both callers stay unchanged.

**WUX-18 — no more flashing "Checking your invite link…"** (`apps/web/src/routes/JoinPage.tsx`)
- Added a `JoinChecking` component: a centered, empty container that shows the kit's `StateMessage kind="loading"` (the standard inline spinner) only after 400 ms, via `useDelayed(true, INVITE_CHECKING_DELAY_MS)`. A fast check never paints.
- Both loading branches (the `auth.status === 'loading'` one and the `state === 'checking'` one) now `return <JoinChecking />`.

**WUX-44 — Reload banner on a new deploy** (`apps/web/src/lib/push.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/ClientVersionBanner.tsx`)
- New `useServiceWorkerUpdate()` hook in `push.ts`: returns `true` once `navigator.serviceWorker` fires `controllerchange`, but only when the page already had a controller at mount (`navigator.serviceWorker.controller !== null`). A first install therefore never shows the banner; browsers without service workers stay `false`.
- `ClientVersionBanner` gained an optional `reason?: 'deploy' | undefined` prop. It renders when the server's minimum client protocol is newer than this build (as before) **or** when `reason === 'deploy'` (a new worker took over). Message and Reload button are unchanged; `Reload` still calls `window.location.reload()`.
- `App.tsx` calls the hook once and passes `reason={serviceWorkerUpdated ? 'deploy' : undefined}` to the single existing banner, so the two signals never stack two bars.

### Files changed
- `apps/web/src/lib/handleGate.ts`
- `apps/web/src/routes/JoinPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/ClientVersionBanner.tsx`
- `apps/web/src/lib/push.ts`
- `work/T-1435-web-small-ux.md` (this file)

All within the allowed list. Longest changed file is `push.ts` at 388 lines (limit 400).

### Commands and results
- `pnpm install`: done, 15.8s (peer-dep warning about `@types/react` in `apps/mobile`, pre-existing).
- Single tests: none run — "Tests: None (UI)" in the spec, and the changed files have no nearby test files (the gate agrees: `SKIP tests @zilar/web (no nearby test files)`).
- `pnpm gate` (first run): `GATE FAIL` — `src/App.tsx(31,14): error TS2375` because `exactOptionalPropertyTypes` rejects passing `reason: 'deploy' | undefined` to a `reason?: 'deploy'` prop. Fixed by typing the prop `reason?: 'deploy' | undefined`.
- `pnpm gate` (final):
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.3s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations / notes
- Spec offered "an optional `reason` prop, or render the same component". I used the `reason` prop and render a single banner, so the protocol-outdated and new-deploy cases cannot show two stacked bars.
- `apps/web/src/routes/AppRoutes.tsx:88` still has a comment that says the dismissal "lives in `lib/handleGate` (sessionStorage per user id…)". The behaviour is correct, only the comment is now stale, and `AppRoutes.tsx` is not in the Allowed files, so I left it untouched.
- `ClientVersionBanner`'s `reason` prop only decides visibility; the visible sentence is the same "A new version is available." in both cases, which is accurate for both.

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1, follow-up 1.
- WUX-17: the handle gate's Skip is now in localStorage, per user.
- WUX-18: a delayed spinner on the invite check.
- WUX-44: `controllerchange` after a deploy shows the Reload banner.
- Follow-up (refresh the `AppRoutes.tsx:88-90` comment) goes into the next web batch.
