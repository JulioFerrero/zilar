---
id: T-0787
title: "WU23: ChatBackgroundDialog, ChatActionsMenu, ChatHeader on Effect"
status: merged
milestone: M5
branch: task/T-0787-web-chat-header
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0787: WU23: ChatBackgroundDialog, ChatActionsMenu, ChatHeader on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, W4 try/catch):
  - `apps/web/src/components/ChatBackgroundDialog.tsx` (467, H1 H3 W4), tested in `ChatBackgroundDialog.test.tsx`;
  - `apps/web/src/components/ChatActionsMenu.tsx` (119, H1 W4), no test;
  - `apps/web/src/components/ChatHeader.tsx` (321, H1 H3 W4), tested in `ChatHeader.menu.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` (per-row actions, T-0767), `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery` and typed validation errors, T-0773), and `apps/web/src/routes/StickersPage.tsx` (a page-level dialog with per-row actions, T-0783).
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
- **Keep the rendered structure.** Dialogs (`components/ui/dialog.tsx` is a non-portalled `fixed inset-0` overlay), lists and sections stay where they are in the tree. Moving a dialog into a row can clip it or stack it under other content (the lead's T-0783 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report. **Exception:** a chat-store action that rejects with a plain `Error` carries a user-facing sentence the store wrote, so keep showing its `message`, as GroupPanel does since T-0781. Only non-`Error` causes get the fallback.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the listed files with the pattern. For the listed files without a test, **write the tests first, against the current code, and commit them ("T-0787: tests before")**; then convert, and the same tests must pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatActionsMenu.test.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx` (added in fix round 1), `work/T-0787-web-chat-header.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/ChatBackgroundDialog src/components/ChatActionsMenu src/components/ChatHeader
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Result:** all three files converted, `effect:map` kind `effect` with 0 signals each. Tests were written first for ChatActionsMenu (commit `T-0787: tests before`, 12 tests green on the old code), then the conversion.

**Files**
- `apps/web/src/components/ChatActionsMenu.tsx` (167 lines, kind `effect`): each menu entry is a `PrefMenuItem` with its own `useAction` (the list-row rule); the parent keeps the one error line. A failed save shows "Could not save that change" and calls `onDone(true)`, as before.
- `apps/web/src/components/ChatHeader.tsx` (328 lines, kind `effect`): topic archive is one `useAction`; `archiving` and `actionError` are derived from its state. Navigation after archive runs inside the effect. The `window.setTimeout(…, 0)` that fires the search focus event is now a zero-delay `Effect.sleep(0)` run with `runWeb`, detached so the narrow-screen unmount does not cancel it (fix round 1).
- `apps/web/src/components/ChatBackgroundDialog.tsx` (548 lines, kind `effect`): the image list is a `useQuery` keyed on `open`, with local uploads and deletes as small state. One `useAction` in `replace` mode runs preset, image and dim saves; the dim debounce is an `Effect.sleep(400)` inside that save, and `reset()` replaces `clearDimTimer`. The upload is its own `ignore`-mode action (the old `busy` guard). Each thumbnail is a `BackgroundRow` with its own delete action; a deleted row stays mounted and renders nothing (the BlockedPage model).
- `apps/web/src/components/ChatActionsMenu.test.tsx`: new. 12 tests before the conversion, plus 1 after: "ignores a second click on the same item while its save waits".

**Tests and checks (real results)**
- ChatActionsMenu tests on the old code: 12 passed. After the conversion: 13 passed.
- The three component test files together (ChatActionsMenu, ChatBackgroundDialog, ChatHeader.menu): 38 passed, 3 files (after fix round 1; 37 before, plus the new mid-delete test). No existing test was edited.
- Whole web suite (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`): Test Files 171 passed (171), Tests 1827 passed (1827) after fix round 1. Main had 1813; the difference is the 14 new tests.
- `pnpm gate` (final run): `gate: 4 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- An earlier gate run failed on typecheck (an optional `icon` passed through under `exactOptionalPropertyTypes`). Fixed by spreading the `MenuItem` props. That run also flagged a scratch file I had written in the worktree; it was deleted.
- Checked the four Allowed source files for `async`, `await`, `.then(`, `try {`, `setTimeout`, `setInterval`. Only the Effect `catch:` option of `tryPromise` remains.
- Effect 4.0.2 names checked in `node_modules/effect/dist/Effect.d.ts`: `flatMap`, `tap`, `tapError`, `andThen`, `sync`, `promise`, `tryPromise`, `sleep`, `suspend`, `catchTag`, `void` (exported as `void_`).

**Behaviour differences**
1. ChatActionsMenu: a second click on the same entry while its save waits is ignored (before: the store call ran twice). Different entries still run at the same time (tested).
2. ChatBackgroundDialog: a new save (preset, image or dim) replaces one still waiting or in flight. The store write of the earlier one still lands (its promise is not cancelled), but its failure alert is no longer shown. Before, each save reported its own failure.
3. ChatBackgroundDialog: a second click on one image's Delete while it waits is ignored; different rows delete at once. Before, a second DELETE was sent.
4. ChatBackgroundDialog: a late list response no longer replaces an upload made while the list was loading (before, it overwrote the list).
5. ChatBackgroundDialog: fixed in fix round 1. The delete and its store patch (`deleteImage`) are one `Effect.uninterruptible` unit, so closing the dialog mid-delete unmounts the row but the patch still runs; only the UI updates after unmount are skipped (React ignores them). Covered by the new test "still clears the deleted selection when the dialog closes mid-delete", which fails without the fix.
6. ChatBackgroundDialog: uploads use `Effect.tryPromise` with the raw error, not `fromApi`, because `uploadErrorMessage` needs the raw 409/413 status. `listBackgrounds` and `deleteBackground` use `fromApi`/`tryPromise` with the same fixed sentences as before.
7. ChatHeader: while `refreshGeneralTopic` runs (only when General is not loaded), the Archive item stays "Archiving…" (before, it returned to normal after the patch). The menu is closed then, so this is only visible if it is reopened. A rejected refresh now ends the effect with a defect and no navigation (before: an unhandled rejection and no navigation).
8. ChatHeader: fixed in fix round 1. The focus event again fires after a zero-delay macrotask (`Effect.sleep(0)` through `runWeb`). Not a fiber tied to the component: on a narrow screen `navigate('/')` unmounts the header in the same click (`AppRoutes.tsx` `/c/:chatJid` renders `ChatView` → `ChatHeader`), and an interrupt-on-unmount fiber would be cancelled before the event fires. No test covers the focus event (ChatHeader.menu.test.tsx is not an Allowed file).
9. All user-facing sentences are unchanged. The three files never showed store messages, so none are shown now.

**Open questions**
- Item 8 deviates from the lead's wording: the focus wait is detached (`runWeb`), not "a forked fiber interrupted on unmount", because the narrow-screen navigate unmounts the header before the wait ends. Please confirm this is acceptable.
- Item 8 is unverified in a test: no existing test covers the search focus, and I did not run the narrow-screen flow in a browser.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **Tests first:** 12 ChatActionsMenu tests were committed against the old code.
- **The files:** all three are Effect files.
- **Fix round 1, the delete:** the delete and its store patch are one uninterruptible unit, so closing mid-delete still clears the chat's background. A test failed before the fix and passes after.
- **Fix round 1, the focus:** a detached `Effect.sleep(0)`, matching the old `setTimeout(0)`, which also outlived the unmount on narrow screens.
- **Results:** the whole web suite (1827) passes; the gate passed.
