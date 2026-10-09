---
id: T-0784
title: "WU19: GifPanel and StickerPanel on Effect"
status: merged
milestone: M5
branch: task/T-0784-web-gif-sticker-panels
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0784: WU19: GifPanel and StickerPanel on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/components/GifPanel.tsx` (354, H1 H3 W4), tested in `GifPanel.test.tsx`; the timer is a search debounce (keep the delay);
  - `apps/web/src/components/StickerPanel.tsx` (578, H1 H5 W4), tested in `StickerPanel.test.tsx`. H5 is storage (recent stickers?): use `Effect.try` with `runSync` at a synchronous edge, as `apps/web/src/lib/topicsUi.ts` does since T-0772.
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` (per-row actions, T-0767), `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery` and typed validation errors, T-0773), and `apps/web/src/components/ais/AiPanel.tsx` (a large panel, T-0778).
- **The full web suite passes on main** (1813 tests). Your change must keep it green, including other components' tests that render your files. Run the whole web suite once before you finish (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`).

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **Keep the concurrency per item.** When a list has a button on each row, each row gets its own `useAction` (a small row component), so different rows can run at the same time while a double click on one row is still ignored. One `useAction` for the whole page would drop a second row's click (the lead's T-0767 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the listed files with the pattern.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/GifPanel.tsx`, `apps/web/src/components/StickerPanel.tsx`, `work/T-0784-web-gif-sticker-panels.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/GifPanel src/components/StickerPanel
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status: review.** Both files now import Effect and have no `async`, `await`, `.then(`, `.catch(`, `try`/`catch`, timers or raw `localStorage` calls of their own (the storage reads are `Effect.try` at a sync edge, as `topicsUi.ts` does).

### Files changed
- `apps/web/src/components/GifPanel.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `work/T-0784-web-gif-sticker-panels.md` (this Report and the status)

No test file was edited.

### Design
- **GifPanel:** a `useQuery` debounce (300 ms) sets the shown search; the first page is a `useQuery` keyed on that search; further pages are a `useAction` whose results are appended in state and cancelled (`controls.reset()`) when a new search starts. Retry reloads the first page. The probe is now `probeGifsAvailabilityEffect()`; `probeGifsAvailability()` stays a Promise through `Effect.runPromise` (the existing tests use it). `GifCell`'s `video.play().catch` became `Effect.runFork(Effect.tryPromise(...).pipe(Effect.ignore))`.
- **StickerPanel:** the probe, the packs list, discover and favorites are `useQuery` hooks that write into the existing state through `Effect.tap` (the same pattern as `AiPanel.tsx`), so the optimistic favorite updates keep working on the same state. Recents read and the storage read in `pick` use `Effect.try` with `Effect.runSync`. The favorite star is a `FavoriteStar` component with its own `useAction` (one per tile), and only the star button is lifted; the panel's `role="dialog"` div and the tree stay where they were. This follows the lead's note on dialogs.

### Commands and results
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/GifPanel src/components/StickerPanel`: before the change 34 passed (2 files); after the change 34 passed, unchanged test files.
- `pnpm effect:map`: `GifPanel.tsx` kind `effect` (no signals); `StickerPanel.tsx` kind `effect` (signal H5 left: the `localStorage` name inside the `Effect.try` helpers, as in `topicsUi.ts`). The total went from 244 to 246 effect files.
- Whole web suite `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: `Test Files 170 passed (170)`, `Tests 1813 passed (1813)`. The 1813 baseline comes from the spec; I did not run a full-suite baseline myself before the change.
- `pnpm gate` from the worktree root: `install (frozen) PASS`, `format PASS`, `lint PASS`, `typecheck PASS`, `effect PASS`, `tests @zilar/web PASS (37.9s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Behaviour differences
1. **Stale debounce waits.** Each keystroke starts a 300 ms wait, and a wait that is no longer the latest keystroke does nothing (a `latestTyped` ref). Without this the debounce test saw three searches. My debug logs showed the superseded waits were not interrupted in the test, and I did not find out why. In a real browser the atom removal should cancel them, but I have not checked that in a browser.
2. Typing back to the text already shown no longer reloads the same query (the old code reloaded it after the debounce).
3. The next page uses the shown search. The old code used the typed text, which only differs inside the 300 ms window.
4. A second click on the same favorite star while its request waits is dropped. The old code sent a second request. Different stars still run at once.
5. The favorite request is `Effect.uninterruptible`: a tile that leaves the list (unfavorite on the Favorites tab) still finishes its request and rolls back on failure.
6. Failure texts are unchanged. A non-API failure shows the same fixed sentence as before (`Could not load GIFs. Try again.` / `Could not save the favorite. Try again.`).
7. The sticker list, discover and favorites run the same state updates in the same order as before.
8. The GIF debounce runs once at mount as a no-op (it sets the same empty search), so nothing is visible.
9. Exports: `GifPanel.tsx` adds `probeGifsAvailabilityEffect`; all old exports are kept.

### Open questions
- Is the `latestTyped` guard acceptable, or should someone check cancellation in a real browser first?
- The H5 signal stays in `StickerPanel.tsx` (storage at a sync edge, as in `topicsUi.ts`); say if the kind must have no signals at all.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **The panels:** both are Effect files. The StickerPanel storage access sits in `Effect.try` helpers (H5 stays as a name only).
- **The `latestTyped` guard** on the debounce is accepted as a second safety (replace-mode interrupt plus the guard).
- **Behaviour changes accepted:** the next GIF page uses the shown search; a double click on the same favourite star is dropped; the favourite request runs uninterruptible so a rollback still happens.
- **Results:** 34 tests and the whole web suite (1813) pass; the gate passed.
- **Follow-up for the hooks:** check why a stale `Effect.sleep` in replace mode was not interrupted under fake timers in this test.
