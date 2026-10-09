---
id: T-0779
title: "WU13: web tools sections on Effect — RoutinesSection, ToolDetailPanel, ToolsSection (JSON.parse via Schema), plus a test for each"
status: todo
milestone: M5
branch: task/T-0779-web-tools-sections
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0779: WU13: web tools sections on Effect — RoutinesSection, ToolDetailPanel, ToolsSection (JSON.parse via Schema), plus a test for each

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `apps/web/src/components/tools/RoutinesSection.tsx` (284, H1 W4), no test;
  - `apps/web/src/components/tools/ToolDetailPanel.tsx` (484, H1 W4 W6), no test; W6 is a `JSON.parse`, so decode it with an Effect Schema instead;
  - `apps/web/src/components/tools/ToolsSection.tsx` (196, H1 W4), no test.
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
Convert the listed files with the pattern. None of the three has a test today. **Write each test first, against the current code, and commit it ("T-0779: tests before") so it pins today's behaviour.** Then convert, and the same tests must pass unchanged. Mock the API module the way `apps/web/src/components/ais/AiPanel.test.tsx` does.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/tools/RoutinesSection.tsx`, `apps/web/src/components/tools/RoutinesSection.test.tsx`, `apps/web/src/components/tools/ToolDetailPanel.tsx`, `apps/web/src/components/tools/ToolDetailPanel.test.tsx`, `apps/web/src/components/tools/ToolsSection.tsx`, `apps/web/src/components/tools/ToolsSection.test.tsx`, `work/T-0779-web-tools-sections.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/tools
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report.

### Acceptance
- Each listed file imports Effect, with no async, timers or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, and any new tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
