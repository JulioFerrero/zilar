---
id: T-0783
title: "WU10: StickersPage on Effect"
status: merged
milestone: M5
branch: task/T-0783-web-stickers-page
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0783: WU10: StickersPage on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/routes/StickersPage.tsx` (671, H1 W4), tested in `StickersPage.test.tsx`.
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
`apps/web/src/routes/StickersPage.tsx`, `work/T-0783-web-stickers-page.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/routes/StickersPage
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Result:** `apps/web/src/routes/StickersPage.tsx` is converted; `pnpm gate` ends with GATE PASS. The file no longer contains `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval`; it imports Effect (`effect`, `effect/reactivity`) and the T-0762 hooks.

**Files changed:** `apps/web/src/routes/StickersPage.tsx`, `work/T-0783-web-stickers-page.md` (this Report and `status: review`). No test was edited.

**Pattern used**
- Loads: `useQuery(() => loadPanel(...), [])` for the panel and favorites (`Effect.all`, unbounded, into the same page state), its refresh is the retry button; `useQuery` for the Discover list on mount. Status is derived from the AsyncResult (`loading`, `ready`, `error`).
- Search: page-level `useAction` (`ignore`). Busy state = `isWaiting` of the mount query or the search.
- Refresh after the editor, the import dialog and the create flow: `useAction(..., { mode: 'replace' })`.
- Each row is its own component with its own `useAction` per button: `MyPackRow` (visibility, remove from panel, delete with its own confirm dialog), `AddedPackRow`, `DiscoverPackRow` (add or remove), `FavoriteRow` (unfavorite).
- Reorder: a page-level `useAction`. The Up/Down buttons are disabled while it waits (`moving`), as before (`movingPackId` is gone), so no click is dropped.
- Calls go through `fromApi` and are typed as `ApiFailure`. The server's sentence is shown when the server answered; a call that got no answer (`status 0`) shows the component's fixed sentence.
- The page's `actionError` line is still written from the Effects with `Effect.sync`, so one alert line behaves as before.

**effect:map** (`pnpm effect:map`, then `dist/effect-map/data.json`)
- `apps/web/src/routes/StickersPage.tsx`: before `needs-effect` (signals H1, W4); after `effect`, no signals.
- Reference models: `BlockedPage.tsx`, `NewGroupDialog.tsx`, `AiPanel.tsx` are all `effect`.
- Total before (first run, before my edit): 842 files, coverage 55.3%, effect 244, needs-effect 192. Total after: 842 files, coverage 55.8%, effect 245, needs-effect 191.

**Commands and real results**
- `pnpm install`: done (frozen lockfile ok).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/StickersPage`: 1 file, 12 passed (12). The test file has 12 `it(` cases before and after; it is unchanged.
- `pnpm exec prettier --write apps/web/src/routes/StickersPage.tsx`: formatted.
- `pnpm --filter @zilar/web typecheck` (tsc for both tsconfigs): no errors.
- `pnpm exec oxlint apps/web/src/routes/StickersPage.tsx`: no findings.
- Whole web suite, `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: Test Files 170 passed (170), Tests 1813 passed (1813). The spec gives 1813 for main; I did not re-run the suite on the untouched file, so "before" is the spec's number.
- `pnpm gate`: GATE PASS. Summary lines:
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/web  (2.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Behaviour differences** (all other text and behaviour is the same; the string literals of the old file all appear in the new one)
1. A call that got no answer from the server (network error, `status 0`) shows the component's fixed sentence instead of the raw error text. This covers load ("Could not load stickers"), search, add, remove, delete, visibility, reorder, unfavorite and refresh. Server answers still show the server's sentence, as before.
2. A second click on the same row button while its action waits is ignored (`ignore` mode, as in BlockedRow). Before, it sent a second request. Different buttons and different rows still run at the same time.
3. Delete: the confirmation is one page-level `ConfirmDialog` again, at its old place (`deletingPack` state, as before). Each row keeps its own delete action and registers its run function in a page ref map (`registerDelete`); the dialog's confirm calls the map entry for that pack, so two packs can be deleted at once and a double click is ignored. (Fix round 1: the dialog had been moved into the row.)
4. The first load starts when the page renders (through the atom), not in a `useEffect` after the first paint. The two loads still run in parallel. As before, a failure of one does not abort the other request, because `fromApi` ignores the abort signal.
5. The Telegram import and the editor/create flows call the refresh through the page's `replace`-mode action. The refresh still runs to the end in its own action.

**Checks I did not run:** I did not open the page in a browser or on the emulator; the checks above are the unit tests, the typecheck, lint and the gate.

**Open questions**
- Is it acceptable that a double click on the same button is ignored (difference 2)? It follows the T-0767 pattern, but the spec does not say. The lead accepted it in fix round 1.
- Is the `status === 0` check the right "no answer" test for the fixed fallback? It is the same test AiPanel uses (`describeFailure`).

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report and the diff.
- **The page** is an Effect file.
- **Fix round 1:** the delete ConfirmDialog is back at page level, where it was, because the dialog is not portalled. Per-row delete actions are registered in a ref map, so two packs can be deleted at once and a double click on one is ignored.
- **Behaviour changes accepted:** fixed fallbacks, the first load on render, a replace-mode refresh.
- **Results:** 12 tests and the whole web suite (1813) pass; the gate passed.
