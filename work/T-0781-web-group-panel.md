---
id: T-0781
title: "WU15: GroupPanel on Effect"
status: merged
milestone: M5
branch: task/T-0781-web-group-panel
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0781: WU15: GroupPanel on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/components/GroupPanel.tsx` (988, H1 W4), tested in `GroupPanel.test.tsx`. It has about 10 try blocks (plan §1.3), so convert one action at a time and run its test after each.
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
`apps/web/src/components/GroupPanel.tsx`, `work/T-0781-web-group-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/GroupPanel
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Changed:** `apps/web/src/components/GroupPanel.tsx` only (no test edited).

**Structure.** Loads are `useQuery`: invite links (managers only), roles (no group id = loading, via `Effect.never`), and my AIs for the picker. Actions are `useAction`: create link, topic switch, listener switch/eagerness, and one action for the roles section (each change is passed in as an Effect). Each AI row has its own remove action (`GroupAiRow`), and each picker option has its own add action (`AddAiOption`). API calls go through `fromApi` (`apiStep`); store calls go through `Effect.tryPromise` (`storeStep`), keeping the raw error for `describeAiError`. The invite-link revoke returns a promise through `runWeb`, because `InviteLinksSection` awaits it (T-0141). The promise never rejects. Dialogs (`AiMemoryDialog`, `ChatBackgroundDialog`) stay at panel level where they were; no row renders a dialog (the lead's note of this turn).

**effect:map (before, main 82db347b): `GroupPanel.tsx` needs-effect (H1, W4). After: `effect`, no signals.** Coverage 55.3% to 56.0%.

**Grep check.** `async`, `await`, `.then(`, `setTimeout`, `setInterval`: none. The only `try`/`catch` text is the `try:`/`catch:` option keys of `Effect.tryPromise` (2 places).

**Tests.** Before: `GroupPanel.test.tsx` has 29 tests; whole web suite 1813 (from the spec, not re-measured before my edit). After: GroupPanel file 29 passed; whole web suite `Test Files 170 passed (170)`, `Tests 1813 passed (1813)`. No test was edited.

**Behaviour differences (all in the panel's error text or per-row state):**
1. Non-API failures on API calls (links create/revoke/load, roles load and changes) now show the component's fallback sentence (`Could not create the link.` etc.) where the old code showed raw `error.message` for a non-ApiError (e.g. a network TypeError). ApiError messages are unchanged.
2. Store-call failures (add, remove, topic switch, listener) keep the old raw text (`The server is down` test asserts it), so no fallback there.
3. Add picker: each option disables only itself while its add runs. Before, all options and Cancel were disabled during any add. Cancel is no longer disabled.
4. AI removal: each row has its own confirm state. Before, one panel-level state allowed only one row in confirm; now two rows can be in confirm at once. Different rows can remove at the same time.
5. Invite links: one error slot before; now create error, then revoke error, then load error, each hidden while its own action runs. Links list keeps the old list while a refresh runs (`AsyncResult.getOrElse`).
6. Fixed in fix round 1: the picker now lists a snapshot of the eligible AIs taken when it opens (`pickerChoices`), so an option stays mounted until the panel closes the picker. The panel's `setPickerChoices(undefined)` runs on success and on Cancel. The option list no longer follows the live store while the picker is open (an AI added elsewhere meanwhile stays listed until the picker closes).
All other fixed sentences, labels and disabled states are unchanged.

**Fix round 1 (lead review).** Item 6 fixed as above; items 3 and 4 kept (per-option disabling, per-row remove). The lead asked for a test "open picker, add, picker closed, AI in list". I wrote it and it passes on the new code, but it is NOT committed: `apps/web/src/components/GroupPanel.test.tsx` is not in this task's Allowed files, and committing it fails the gate's scope check. Its diff is saved outside the repo. It also passes on the previous commit 908030a5 even when the mocked add removes the option from the live list first, so it does not reproduce the timing regression; the fix is structural (the option cannot unmount while the picker is open), not proven by that test. Needs the lead to add `apps/web/src/components/GroupPanel.test.tsx` to Allowed files if the test should land.
Whole web suite after fix round 1: `Test Files 170 passed (170)`, `Tests 1813 passed (1813)` (GroupPanel file 29 tests, all passing).
Gate after fix round 1: `scope: every changed file is inside the Allowed files`, `GATE PASS`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`.

**Gate.** `pnpm gate` (run once, from the worktree root):
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`
- `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`

Also run: `pnpm --filter @zilar/web typecheck` (passed), `pnpm exec oxlint apps/web/src/components/GroupPanel.tsx` (clean), `pnpm exec prettier --write` on the file.

**Not verified:** no browser run of the picker close (item 6) or of the two-row confirm (item 4).

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **The panel** is an Effect file. Store failures keep their sentences; API failures go through `ApiFailure`.
- **Fix round 1:** the picker lists a snapshot taken when it opens and closes after a successful add, as before. The picker list no longer follows the live store while it is open, which is accepted.
- **The worker's extra test was not committed:** it was outside Allowed and did not reproduce the old timing.
- **Results:** 29 tests and the whole web suite (1813) pass; the gate passed.
