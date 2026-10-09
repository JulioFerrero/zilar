---
id: T-0767
title: "WU6 + WU14: approval and list pages on Effect — routes ApprovalsPage, BlockedPage, RequestsPage, FoldersPage and components ApprovalCard, approvals/AlwaysAllowedList use useAction/useQuery/fromApi; no async, try or timers in the components; same text and behaviour"
status: merged
milestone: M5
branch: task/T-0767-web-approvals-pages
model: auto
effort: default
depends_on: [T-0762]
estimate: 0.5 day
---

# T-0767 (WU6 + WU14): the approvals and list pages on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (tasks WU6 and WU14), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their line counts and signals from `pnpm effect:map` on 2026-10-09:
  - `apps/web/src/routes/ApprovalsPage.tsx` (291, H1 H3 W4), tested in `ApprovalsPage.test.tsx`;
  - `apps/web/src/routes/BlockedPage.tsx` (121, H1 W4), tested in `BlockedPage.test.tsx`;
  - `apps/web/src/routes/RequestsPage.tsx` (171, H1 W4), tested in `RequestsPage.test.tsx`;
  - `apps/web/src/routes/FoldersPage.tsx` (239, H1 W4), tested in `FoldersPage.test.tsx`;
  - `apps/web/src/components/ApprovalCard.tsx` (254, H1 W4), tested in `ApprovalCard.test.tsx`;
  - `apps/web/src/components/approvals/AlwaysAllowedList.tsx` (268, H1 W4), tested in `AlwaysAllowedList.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/` (T-0759, T-0762).

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the six files with the pattern. Approve, deny, unblock, accept or decline, and folder save or delete become `useAction`; list loads become `useQuery`, with `refresh` after a successful action where the component reloads today. The `setTimeout` in `ApprovalsPage` becomes an Effect (read what it does first).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/*`, the six files and their tests.

### Allowed files
`apps/web/src/routes/ApprovalsPage.tsx`, `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/RequestsPage.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.tsx`, `apps/web/src/routes/ApprovalsPage.test.tsx`, `apps/web/src/routes/BlockedPage.test.tsx`, `apps/web/src/routes/RequestsPage.test.tsx` (the three test files were added by the lead for fix round 1), `work/T-0767-web-approvals-pages.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/routes/ApprovalsPage src/routes/BlockedPage src/routes/RequestsPage src/routes/FoldersPage src/components/ApprovalCard src/components/approvals
pnpm gate
```
Run `pnpm effect:map` and list the six kinds in the Report.

### Acceptance
- The six files import Effect, with no async, timers or try/catch of their own.
- The text and behaviour are the same, and the tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** The six files now use `useAction`, `useQuery`, `fromApi` and `failureOf`/`isWaiting`, and import `Effect` from `effect`. Their own code has no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval`. Text and props are unchanged. Edited files: the six listed in Allowed files, plus this task file.

**Counts.** Tests, 7 files (the six test files plus `components/approvals`): before 72 passed, after 72 passed. No test was edited. Each test file was run alone on its own, and the set was run together.

**effect:map kinds.** Before, all six were `needs-effect` (H1/W4, ApprovalsPage also H3). After, all six are `effect`:
- ApprovalsPage.tsx 291 -> 240 lines
- BlockedPage.tsx 121 -> 122
- RequestsPage.tsx 171 -> 180
- FoldersPage.tsx 239 -> 228
- ApprovalCard.tsx 254 -> 258
- AlwaysAllowedList.tsx 268 -> 240

**Per-file notes.**
- ApprovalsPage: the list is a `useQuery`; `refresh` runs on focus, on the 30 s poll and on Refresh/Retry. The 30 s poll is `Effect.repeat(Schedule.spaced)` + `Effect.delay`, and the 60 s countdown tick is the same shape, both inside `useQuery`. The notice timer is `useAction(Effect.sleep, { mode: 'replace' })`; the notice shows while it is waiting. Each row is a small `PendingApproval` component with its own `useAction`, so two rows can still be decided at once. The "decided" filter is state, so a late list response does not bring rows back.
- ApprovalCard: the decision is a `useAction`. A stale answer re-reads the card; `always_*` refusals set the same flags as before.
- AlwaysAllowedList: the list is a `useQuery` keyed on the scope key, and Retry is its `refresh`. Revoke is a `useAction`; a 404 drops the row.
- BlockedPage and RequestsPage: load is a `useQuery`; unblock, accept, decline and cancel are `useAction`s. Removed rows are kept in a set.
- FoldersPage: only the reorder is an action. Folder save and delete live in `FolderEditorDialog`, which is not in Allowed files, so they were not converted.

**Deviations (please review).**
1. (Fixed in fix round 1, see below.) Concurrency across rows in BlockedPage and RequestsPage.
2. Generic failures (intended, per the lead): a failure that is not an `ApiError` (for example a network error) now shows the page's fixed fallback sentence (for example "Could not send the decision."), not the raw error text. `fromApi` cannot carry that text through.
3. The `useQuery` deps for the list are `[]` (ApprovalsPage, BlockedPage, RequestsPage) or the scope key (AlwaysAllowedList).

**Gate.**
```
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  tests @zilar/web  (3.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Single tests run:** `src/routes/BlockedPage`, `src/routes/RequestsPage`, `src/routes/FoldersPage`, `src/components/approvals/AlwaysAllowedList`, `src/components/ApprovalCard`, `src/routes/ApprovalsPage` (each with `--reporter=dot`), then the six together as in Checks. All passed. `pnpm --filter @zilar/web typecheck` and `oxlint` on the six files also passed.

**Not verified.** No test covers the 3 s/5 s notice timeout, or the 60 s countdown tick; I did not add a test. `ApprovalCard` still uses `useApprovalPolling` (in `lib/`, not in Allowed files), which I did not read or change.

**Fix round 1 (lead review).**
- Per-row concurrency: BlockedPage and RequestsPage now render each row as its own component with its own `useAction`. A click on a second row runs at once; a second click on the same row is ignored while it waits. The row's error is reported to the page's single alert (the same place and text as before). In BlockedPage a removed row stays mounted but renders nothing, so the refresh after the unblock still runs to the end (an unmount would cancel it, and the order of "remove, then refresh" is unchanged). RequestsPage rows unmount on removal, which is safe because nothing runs after it.
- ApprovalsPage already had one action per row (`PendingApproval`), so it is unchanged.
- AlwaysAllowedList keeps one action for the list. This is the same as before: while one revoke runs, every Revoke button is disabled (`revokingId !== null`), and a Confirm can only be open after its Revoke was clicked, so two revokes cannot be in flight. FoldersPage's reorder already blocked a second reorder while one ran (`if (reordering) return`), so it is unchanged too.
- Tests added: BlockedPage (two rows unblocked at once; the same row clicked twice sends one call), RequestsPage (two rows answered at once; the same row clicked twice sends one call), ApprovalsPage (two rows decided at once, the same row clicked again sends nothing new; the 3 s notice stays at 2.9 s and goes at 3.1 s; the expires-in text moves at 60 s, not at 59 s; the 30 s poll does not move it).
- Counts: the six test files (7 files, including `components/approvals`): before fix round 1 72 passed; now 79 passed (72 + 7 new).
- Scope: these three test files (`apps/web/src/routes/ApprovalsPage.test.tsx`, `BlockedPage.test.tsx`, `RequestsPage.test.tsx`) are NOT in Allowed files. The coordinator asked for the tests, so they are in the commit. The gate prints `scope: 3 file(s) outside the Allowed files` (the line ends in GATE PASS). Please add these three paths to Allowed files, or tell me to drop the tests.
- Gate after fix round 1:
```
PASS  install (frozen)  (0.9s)
PASS  format  (0.7s)
PASS  lint  (0.6s)
PASS  typecheck  (2.9s)
PASS  tests @zilar/web  (3.2s)
scope: 3 file(s) outside the Allowed files:
  apps/web/src/routes/ApprovalsPage.test.tsx
  apps/web/src/routes/BlockedPage.test.tsx
  apps/web/src/routes/RequestsPage.test.tsx
GATE PASS
```

**Open questions.** Deviation 2 (fixed fallback sentences) is intended. The three test files outside Allowed files need the lead's decision (see Scope above).

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The pages:** all six files are Effect files.
- **Per-row actions:** BlockedPage and RequestsPage use one action per row, so two rows can run at once while a double click on one row is ignored (tested). AlwaysAllowedList and FoldersPage keep one action, matching their disabled-while-busy buttons.
- **ApprovalsPage timers:** the 3 s notice and the 60 s tick are tested.
- **Intended change:** a non-API failure shows the fixed fallback sentence.
- **Results:** tests go from 72 to 79; the lead added the three test files to Allowed; the gate passed.
