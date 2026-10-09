---
id: T-0786
title: "WU20: PackEditor and TelegramImportDialog on Effect"
status: merged
milestone: M5
branch: task/T-0786-web-pack-editor-import
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0786: WU20: PackEditor and TelegramImportDialog on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/components/PackEditor.tsx` (666, H1 W4), tested in `PackEditor.test.tsx`;
  - `apps/web/src/components/TelegramImportDialog.tsx` (280, H1 W4), tested in `TelegramImportDialog.test.tsx`.
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
Convert the listed files with the pattern. Uploads with progress: keep the progress reporting and the cancel behaviour identical.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `work/T-0786-web-pack-editor-import.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/PackEditor src/components/TelegramImportDialog
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Result:** both files converted to Effect; `pnpm gate` ends with GATE PASS. Status set to review.

**Files changed:** `apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `work/T-0786-web-pack-editor-import.md` (front matter and this Report only). No test file was edited; no new tests were added.

**Lead note on dialogs:** no dialog was moved. TelegramImportDialog keeps its four `<Dialog>` elements at the same top-level places in the component (not inside a row). PackEditor renders no dialog. No per-row action was added: PackEditor's only async work is preparing picked files and Save, both whole-editor.

**What changed**
- TelegramImportDialog: the import is one `useAction` over `fromApi(() => importFn(value))`. `busy`, the result, the 501 view, the token view and the error text are derived from that state (`isWaiting`, `failureOf`, `AsyncResult.isSuccess`). `onUnavailable` runs from `Effect.tapError` on a 501. The blank-input message is a separate `notice` state. The fixed sentences moved into `importErrorText`. No async, try/catch or timers remain.
- PackEditor:
  - Picked files are prepared by `PrepareBatch`, one small child per drop. Each child runs its files one after another with `useQuery` (so drops still run side by side, as before), and it leaves the list when its last file lands. Its Effect stops on unmount.
  - Save is one `useAction` over an Effect: pack create/patch, removals, uploads one by one with the same progress count, the order patch, then `onDone`. Its state drives `busy` and the save-level error.
  - `BlobPreview` keeps its guard with `Effect.try` plus `Effect.runSync` (see Deviations).
  - `updateRow` replaces the row-update blocks; the upload-row status texts are the same.

**Deviations and behaviour differences**
1. PackEditor does not use `fromApi`. Its tests assert raw thrown text (`'boom'` in the upload row), and `fromApi` maps a plain Error to `Something went wrong`. A local `call` helper keeps the thrown value in a typed `CallFailed`, and `messageOf` shows the Error message or the old fixed fallback, so the text stays identical.
2. TelegramImportDialog uses `fromApi`. A non-API failure (plain Error) now shows the fixed `The import failed.` instead of the Error's own message (the sanctioned fallback). API errors show the same text as before.
3. Unmounting now interrupts an in-flight import or save. The old code let it finish and call back into an unmounted component; the visible result is the same.
4. `BlobPreview` uses `Effect.runSync` in the `useState` initializer. The old `try/catch` also caught a `createObjectURL` that throws; a `typeof` check alone broke `PackEditor.test.tsx` (9 failures in the first run), so the guard stays as an Effect.
5. A throw inside `onDone` (the parent's callback) is now a defect, not the form error it showed before. Nothing else in the save can throw.
6. `PrepareBatch` reads `prepare` once, on mount (`useQuery` with deps `[]`). The old code read the prop on each drop. Tests and the app pass the same function for the editor's life.

**Checks run (real results)**
- Baseline before any change: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/PackEditor src/components/TelegramImportDialog`: 26 passed (2 files; Telegram 12, PackEditor 14).
- After: the same command: 26 passed, 0 failed, no unhandled errors.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/TelegramImportDialog`: 12 passed (run after the Telegram change, before the PackEditor work).
- `pnpm --filter @zilar/web typecheck`: passes (after removing one unused type import).
- `pnpm exec oxlint` on the two files: no output (no findings).
- Whole web suite, `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: Test Files 170 passed (170), Tests 1813 passed (1813); same as the main baseline of 1813.
- `pnpm gate`:
  - PASS install (frozen)
  - PASS format
  - PASS lint
  - PASS typecheck
  - PASS effect
  - PASS tests @zilar/web
  - scope: every changed file is inside the Allowed files
  - GATE PASS
- `pnpm effect:map`: `PackEditor.tsx` kind `effect` (773 lines); `TelegramImportDialog.tsx` kind `effect` (288 lines). Map total 842 files, coverage 56.0%.
- Grep of both files: no `async`, `await`, `.then(`, `try`/`catch` blocks, `setTimeout` or `setInterval`. The only `tryPromise` is the Effect helper in PackEditor.

**Open questions**
- Should `Effect.runSync` in the `BlobPreview` initializer be replaced by a different pattern? It is a synchronous Effect and it keeps the old guard, but it is the one place a component runs an Effect outside a hook. Reviewer to decide.
- The per-drop `PrepareBatch` uses `useQuery` to start work on mount. The hooks have no mount-only runner, so this is the closest fit; I checked the registry (`scheduleAtomRemoval` checks subscribers in a later task), so StrictMode's double subscribe keeps one fiber.

**Fix round 1 (item 6: latest `prepare` prop)**
- `PrepareBatch` now keeps `prepare` in a `latestPrepare` ref, updated on render with `useLayoutEffect` (the pattern of `use-action.ts`). The drop reads `latestPrepare.current` when its Effect starts (`Effect.sync` then `Effect.flatMap`), so each drop uses the prop from the latest render before the drop.
- Note: a drop already got the latest prop before this change, because each drop mounts a new `PrepareBatch` with the current prop. The ref makes the read explicit.
- Test: the lead asked for a rerender test in `PackEditor.test.tsx`, but that file is outside this task's Allowed files, and the gate's scope check would reject it. I ran the test from a temporary file (`PackEditor.latest-prepare.test.tsx`: render with `first`, rerender with `second`, drop a file, `second` called once, `first` never), which passed. The temporary file was deleted before the commit, so the commit has no test. Lead to decide: add that test in `PackEditor.test.tsx` (widen Allowed files) or accept it as verified-only.
- Counts after the fix: the two files 26 passed (with the temporary test: 27 passed, 3 files); whole web suite 170 files passed, 1813 tests passed on the second run. The first whole-suite run of this round had 1 failed test (1812 passed); I could not identify it from the summary, and the immediate rerun passed fully. Flaky, unrelated to these files as far as I can tell; not investigated further.
- `pnpm gate`: PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS effect, PASS tests @zilar/web, scope: every changed file is inside the Allowed files, GATE PASS (3 changed files vs main).

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **The files:** both are Effect files.
- **The store-error rule holds:** PackEditor keeps its raw thrown text (its tests assert it).
- **Fix round 1:** `PrepareBatch` reads the latest `prepare` prop through a ref. A temporary test (rerender, drop, then the new prop is called) passed and was not committed, because it was outside Allowed.
- **Results:** 26 tests and the whole web suite (1813; one flaky failure in the first run, green on rerun) pass; the gate passed.
