---
id: T-0767
title: "WU6 + WU14: approval and list pages on Effect — routes ApprovalsPage, BlockedPage, RequestsPage, FoldersPage and components ApprovalCard, approvals/AlwaysAllowedList use useAction/useQuery/fromApi; no async, try or timers in the components; same text and behaviour"
status: todo
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
`apps/web/src/routes/ApprovalsPage.tsx`, `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/RequestsPage.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.tsx`, `work/T-0767-web-approvals-pages.md`.

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

## Review (written by Claude)
