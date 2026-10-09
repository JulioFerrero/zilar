---
id: T-0773
title: "WU22: web dialogs on Effect — NewGroupDialog, NewTopicDialog, FolderEditorDialog, AddContactDialog use useAction/useQuery/fromApi; no async, try or timers in the components; same text and behaviour"
status: todo
milestone: M5
branch: task/T-0773-web-dialogs
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0773 (WU22): the web dialogs on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU22), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files** (`apps/web/src/components/`), with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `NewGroupDialog.tsx` (337, H1 H3 W4), tested in `NewGroupDialog.test.tsx`;
  - `NewTopicDialog.tsx` (376, H1 W4), tested in `NewTopicDialog.test.tsx`;
  - `FolderEditorDialog.tsx` (407, H1 W4), tested in `FolderEditorDialog.test.tsx`;
  - `AddContactDialog.tsx` (141, H1 H3), tested in `AddContactDialog.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/` (T-0759, T-0762). T-0767 (WU6 + WU14) converts other components with the same pattern; if it has merged when you start, read its diff (`git log --oneline -1 -- apps/web/src/routes/ApprovalsPage.tsx`) as a model.

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
Convert the four dialogs with the pattern. Submit and create become `useAction` (the `ignore` mode replaces the busy guards). Any search-as-you-type or debounce becomes `useQuery` keyed on the input, with `Effect.sleep` for the delay. Read the existing `setTimeout` uses and keep their delays.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/*`, the four files and their tests.

### Allowed files
`apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/AddContactDialog.tsx`, `work/T-0773-web-dialogs.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/NewGroupDialog src/components/NewTopicDialog src/components/FolderEditorDialog src/components/AddContactDialog
pnpm gate
```
Run `pnpm effect:map` and list the four kinds in the Report.

### Acceptance
- The four files import Effect, with no async, timers or try/catch of their own.
- The text and behaviour are the same, and the tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
