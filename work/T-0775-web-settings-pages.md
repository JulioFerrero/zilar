---
id: T-0775
title: "WU7: web settings pages on Effect — routes AisPage, ConnectionsPage, IntegrationsPage use useAction/useQuery/fromApi (per-row actions per row); no async, try or timers in the components; same text and behaviour; a new AisPage test"
status: todo
milestone: M5
branch: task/T-0775-web-settings-pages
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0775 (WU7): the AI, connections and integrations pages on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU7), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `apps/web/src/routes/AisPage.tsx` (306, H1 W4), no test;
  - `apps/web/src/routes/ConnectionsPage.tsx` (374, H1 W4), tested in `ConnectionsPage.test.tsx`;
  - `apps/web/src/routes/IntegrationsPage.tsx` (524, H1 W4), tested in `IntegrationsPage.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/`. A finished example of the pattern, including per-row actions, is T-0767 (`git log -1 --format=%h -- apps/web/src/routes/BlockedPage.tsx`, then read `BlockedPage.tsx` and `RequestsPage.tsx`).
- **ConnectionsPage** saves and tests provider keys. Keys must never appear in an error text or a log (`AGENTS.md`); keep the existing redaction.

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
Convert the three pages with the pattern. Add `apps/web/src/routes/AisPage.test.tsx`, covering the load, the empty state and one action, with the API module mocked the way the other page tests do it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/*`, `apps/web/src/routes/BlockedPage.tsx` (the model), the three pages and their tests.

### Allowed files
`apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/AisPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `work/T-0775-web-settings-pages.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/routes/AisPage src/routes/ConnectionsPage src/routes/IntegrationsPage
pnpm gate
```
Run `pnpm effect:map` and list the three kinds in the Report.

### Acceptance
- The three files import Effect, with no async, timers or try/catch of their own.
- The text and behaviour are the same, the old tests pass unchanged, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
