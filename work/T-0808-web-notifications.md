---
id: T-0808
title: "WU9: web NotificationsPage and GroupHandleRoute on Effect (push permission flow, storage and JSON reads, the handle debounce)"
status: merged
milestone: M5
branch: task/T-0808-web-notifications
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0808: WU9: web NotificationsPage and GroupHandleRoute on Effect (push permission flow, storage and JSON reads, the handle debounce)

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row WU9 (line 379); WU3 (the lib ports, T-0794) is merged. The plan flags "Julio: push permission flow": Julio checks it live.

### Verified facts (do not re-derive)
- **`apps/web/src/routes/NotificationsPage.tsx`** (519, H1 H5 W4 W6), tested in `NotificationsPage.test.tsx`. The first try is at line 42. It also reads storage (H5) and calls `JSON.parse` (W6): storage goes through `Effect.try` with `runSync` at a synchronous edge, as `apps/web/src/lib/topicsUi.ts` does (T-0772), and `JSON.parse` becomes a Schema decode (`Schema.UnknownFromJsonString` or the 4.0.2 equivalent; check `Schema.d.ts`).
- **`apps/web/src/routes/GroupHandleRoute.tsx`** (223, H1 H3 W4), tested in `GroupHandleRoute.test.tsx`, with a `setTimeout` at line 50.
- **Push calls go through `apps/web/src/lib/push.ts`,** which keeps its Promise API and now exports `*Effect` versions (T-0794); use those where convenient.
- **The click stays synchronous:** `Notification.requestPermission()` must be called inside the click handler, as `docs/EFFECT_BRIEF.md` says for browser APIs that need the user's click.

### What to build
Convert both files with the web pattern.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/web/src/lib/push.ts`, `apps/web/src/lib/topicsUi.ts`, `apps/web/src/lib/effect/use-action.ts`, `use-query.ts`, the two files and their tests.

### Allowed files
`apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `work/T-0808-web-notifications.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/routes/NotificationsPage src/routes/GroupHandleRoute
pnpm --filter @zilar/web typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- effect:map kind: `apps/web/src/routes/NotificationsPage.tsx` = effect (signal H5 left: `localStorage` inside `Effect.try`, as topicsUi); `apps/web/src/routes/GroupHandleRoute.tsx` = effect (no signals).
- Tests before: 17 passed (2 files). After: 17 passed (2 files), run 3 times, all green.
- Typecheck: `pnpm --filter @zilar/web typecheck` exit 0.
- Fix round 1: a changed handle keeps the last settled view (React state, set during render with its lookup) while its lookup is checking, so no Add contact flash; Retry clears it first and shows the dialog again, as before. New test in `GroupHandleRoute.test.tsx`. Tests now 18 passed, run 3 times; typecheck exit 0.
- Prettier: run on both files.
- Not run: whole suite, `pnpm gate` (wave mode).

Behaviour differences:
- Enable on this device: `Notification.requestPermission()` is now called synchronously in the click handler (per the spec), before `getPushConfig()`. Before, it fired after the config fetch. If the config fetch fails, the browser prompt has already been shown. The subscribe step awaits the same answer (a wrapped `PushBrowser` in the page file; `lib/push.ts` untouched).
- Page actions (enable, disable, remove, previews, test, join) run as `Effect.runFork` pipelines, not `useAction`: a navigation away does not cancel an in-flight subscribe, register, rollback or join-then-navigate. Same as the old async handlers.
- Page load: `useQuery` on mount, setters inside the Effect. Leaving the page mid-load now interrupts it (before: result ignored), so the stale-handle cleanup write may be skipped. Harmless, reconciled on the next load.
- Unsupported browsers: status is derived as `unsupported` at once (before: one frame of "Loading" first).
- Stored handle: decoded with a Schema Struct (extra JSON fields are dropped). Only id and node are used, so no visible change.
- `friendlyError` accepts `ApiFailure` as well as `ApiError`. Non-ApiError throws from api.ts would show "Something went wrong" (no trailing "Try again."); api.ts push calls only throw ApiError, so none expected.
- GroupHandleRoute: the lookup uses `useQuery` with `Effect.sleep(0)` as the debounce. When the handle changes, the page shows the Add contact dialog while re-checking (before: the previous card stayed until the new lookup landed). Retry is `refresh()`.
- Sync-edge `Effect.runSync` for storage reads and writes, as topicsUi does.

Unsure:
- Whether the lead wants the page actions on `useAction` instead of `runFork`. I chose `runFork` because `useAction` cancels on unmount, which would drop a rollback or the post-join navigation.
- The permission-prompt move (the spec's "click stays synchronous") is a visible ordering change; Julio should check the live flow.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **The routes:** both are Effect files. The push permission prompt is requested inside the click (Julio checks it live). `runFork` for the page actions keeps the old no-cancel behaviour.
- **Fix round 1:** GroupHandleRoute keeps the previous card while a changed handle is re-checked, with a test.
- **Results:** 18 tests pass 3 of 3 runs; the wave 1 combined check passed for web (1916).
