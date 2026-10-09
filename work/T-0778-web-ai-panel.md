---
id: T-0778
title: "WU11 + WU12: web AI components on Effect — AiPanel, AiActivity, AiMemorySection, NewAiDialog"
status: merged
milestone: M5
branch: task/T-0778-web-ai-panel
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0778: WU11 + WU12: web AI components on Effect — AiPanel, AiActivity, AiMemorySection, NewAiDialog

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `apps/web/src/components/ais/AiPanel.tsx` (880, H1 W4), tested in `AiPanel.test.tsx`;
  - `apps/web/src/components/ais/AiActivity.tsx` (287, H1 W4), tested in `AiActivity.test.tsx`;
  - `apps/web/src/components/ais/AiMemorySection.tsx` (258, H1 W4), tested in `AiMemorySection.test.tsx`;
  - `apps/web/src/components/ais/NewAiDialog.tsx` (332, H1 W4), tested in `NewAiDialog.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` (per-row actions, T-0767) and `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery` and typed validation errors, T-0773).

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
Convert the listed files with the pattern. `AiPanel` is large: convert one action at a time and run its test after each step.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `work/T-0778-web-ai-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/ais
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report.

### Acceptance
- Each listed file imports Effect, with no async, timers or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, and any new tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Result:** the four files are converted and the gate passes. Status is set to review.

### What changed (4 files; no test file touched)
- `AiPanel.tsx`: the three list loads (`listAis`, `listConnections`, `listMachines`) are `useQuery` reads. `listAis` seeds the form inside its own `Effect.tap` (a plain `seedForm` helper); the other two are derived values. Six `useAction`s: save (`runSave`; `busy` = `isWaiting`), delegation (one action for both switches, which are disabled while busy), delete, stop, resume, and the home-machine change. Module-level helpers: `describeFailure` (rebuilds the `ApiError` that `describeAiError` reads) and `refetchAi` (the best-effort re-read after a failed write).
- `AiActivity.tsx`: the first page is a `useQuery` keyed on the scope key, applied with `Effect.tap`/`Effect.tapError`. Load more is a `useAction` in ignore mode (replaces `loadingMore`). Helper `auditFailureText`.
- `AiMemorySection.tsx`: the memory read is a `useQuery`. While the section is closed it holds the read with `Effect.never`, so opening it makes the first request. Retry and the post-clear reload use `refresh`. Forget is a `useAction`; a 404 still drops the row, and removed rows are a set of hidden ids reset by each read. Clear is a `useAction`.
- `NewAiDialog.tsx`: connections are a `useQuery` with derived status and error text. Create is a `useAction` in ignore mode (replaces the `inFlight` ref). It uses the same `describeFailure` helper as AiPanel.
- No `async`/`await`/`.then(`/`try`/`setTimeout`/`setInterval`/`useEffect`/`useRef` is left in the four files (checked by grep; the `catch` matches are Effect's `catchTag`/`catchIf`). The first version used synchronous `setState` in effects, and oxlint's `set-state-in-effect` rule flagged it; the state is now applied inside the Effect with `Effect.tap`.

### Effect map kinds (`pnpm effect:map`, `data.json`)
- `AiPanel.tsx`: needs-effect (H1, W4) before, now **effect** (no signals), 871 lines.
- `AiActivity.tsx`: needs-effect before, now **effect**, 279 lines.
- `AiMemorySection.tsx`: needs-effect before, now **effect**, 254 lines.
- `NewAiDialog.tsx`: needs-effect (H1, W4) before per the spec's listing (I did not re-list its baseline), now **effect**, 342 lines.

### Tests
- Before (baseline, no edits): `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ais`: 9 files, 117 tests, **116 passed, 1 failed**. The failure: `AiPanel.test.tsx > always allowed section (T-0100) > renders the section for the owner and fetches the AI rules once` (expected 1 `/approval-rules` request, got 2). It is in `AlwaysAllowedList`, which I did not touch.
- After: 9 files, 117 tests, **117 passed**. No test was edited and no test added (test files are outside Allowed files). The AiPanel test file, run three more times, passed 35/35 each time.
- I did not find out why the request count changed. It passes after the conversion, and I did not change `AlwaysAllowedList`.
- Also ran: `pnpm --filter @zilar/web typecheck` (no errors); `pnpm exec oxlint` on the four files (clean, after one round that flagged `set-state-in-effect` in AiActivity and AiPanel, now fixed); `prettier --write` on the four files.

### Behaviour differences
1. **Non-API failures.** Failures with no HTTP status (a network error or an unexpected throw) now show the component's fixed sentence instead of the raw error text such as "Failed to fetch". This applies to: AiPanel's loads, save, delegation, delete, stop, resume and home machine; AiActivity's load and load more; NewAiDialog's connection load and create. Server errors (`ApiError`) keep the same text, because `describeAiError` gets the same code, status and message.
2. **AiPanel delete.** The "Deleting…" flag clears when the delete succeeds. The original kept it until the panel unmounted. The panel closes on success either way.
3. **NewAiDialog create.** The Create button is enabled again right after a successful create (the original stayed "Creating…" until unmount). The dialog closes on success.
4. **Double clicks.** The guards are now the action's ignore mode, not a ref or a busy flag. Same result for every button.
5. **AiMemorySection.** The forget result is applied as a set of hidden ids, not by editing the memory object. Same rendered rows. Show, Retry and the post-clear reload reset the set.
6. Nothing else changed in text, labels, disabled states, props or exports.

### Gate
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.6s)
PASS  typecheck  (2.5s)
PASS  effect  (0.8s)
PASS  tests @zilar/web  (2.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Open points
- `describeFailure` is duplicated in `AiPanel.tsx` and `NewAiDialog.tsx`. It belongs in `apps/web/src/components/ais/errors.ts`, which is outside this task's Allowed files; a follow-up can move it.
- Why the AlwaysAllowedList request count changed is not known (see Tests).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **The components:** all four are Effect files; the behaviour changes (fixed fallbacks, and busy flags that clear after a successful delete or create) are accepted.
- **Main was red:** the AiPanel test "fetches the AI rules once" saw 2 fetches after T-0767 changed AlwaysAllowedList (the lead reproduced it 3 of 3 times). This branch passes it 35 of 35 over 3 runs, so it merges first to turn main green. The root cause (an extra fetch on remount under StrictMode, suspected) is a follow-up task.
- **Results:** 117 of 117 tests pass, and the gate passed.
