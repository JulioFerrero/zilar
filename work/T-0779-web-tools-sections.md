---
id: T-0779
title: "WU13: web tools sections on Effect — RoutinesSection, ToolDetailPanel, ToolsSection (JSON.parse via Schema), plus a test for each"
status: merged
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

**Result:** the three components are converted, the 19 new tests pass unchanged after the conversion, and `pnpm gate` ends with GATE PASS.

**Commits (branch `task/T-0779-web-tools-sections`):**
- `bfd22ff4` "T-0779: tests before": the three new test files, run green against the old code.
- The second commit, "T-0779: convert web tools sections to Effect", holds the conversion.

**Files:**
- Converted: `apps/web/src/components/tools/ToolsSection.tsx`, `RoutinesSection.tsx`, `ToolDetailPanel.tsx`.
- New tests: `ToolsSection.test.tsx` (6), `RoutinesSection.test.tsx` (5), `ToolDetailPanel.test.tsx` (8). They stub `fetch` as `tools.test.tsx` does; no API module is mocked.
- `work/T-0779-web-tools-sections.md` (this Report, status).

**Test counts:**
- Before conversion: 19 new tests, all green on the old code. The folder `src/components/tools` ran 42 tests (19 new plus the 23 in `tools.test.tsx`), all passing.
- After conversion: the same 42 pass. Test bodies did not change. The one edit after the tests-before commit removed an unused `waitFor` import from `ToolsSection.test.tsx`, which tsc flagged. Prettier formatted the test files before the commit.
- The spec says none of the three has a test. That is not quite right: `tools.test.tsx` (497 lines, 23 tests) covers all three through stubbed `fetch`. I kept it unchanged and added the per-file tests the Allowed files call for.

**effect:map kinds** (from `packages/devtools/dist/effect-map`, data.json; the summary line is `842 files, coverage 51.8%`):
- `ToolsSection.tsx`: effect
- `RoutinesSection.tsx`: effect
- `ToolDetailPanel.tsx`: effect
- I did not record the kinds before the change.

**Checks run:**
- `pnpm --filter @zilar/web test --reporter=dot --maxWorkers=2 src/components/tools`: 4 files, 42 passed.
- `tsc --noEmit -p tsconfig.json` and `tsconfig.node.json` in `apps/web`: clean (one real type error fixed: `useAction` needed `<void, void, ApiFailure>` for the delete action).
- Grep of the three files for `async`, `await`, `.then(`, `try`, `catch`, `setTimeout`, `setInterval`, `JSON.parse`: no matches.
- `pnpm effect:map`: ran, ok.
- `pnpm gate` (run twice, both GATE PASS). Summary lines:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Behaviour differences** (user-visible text is byte-identical otherwise):
1. Non-API failures show a fixed sentence instead of `Error.message`: "Could not load the tools." / "Could not load the routines." / "Could not load the tool." / "Could not load that version." / "Could not delete the tool." / "Could not run the tool." / "Could not update the routine.". `lib/tools.ts` only throws `ApiError`, so I expect no visible change. API messages (for example "Forbidden", "Tool not found") still show as before.
2. ToolDetailPanel, "Show source": a new click cancels a version load that is still running (`mode: 'replace'`). Before, both loads ran and the slower reply could win. Clicking the current version also cancels a pending load.
3. Double click on Revert's confirm, or on Delete's confirm: one request is sent. Before, a second click could send a second request.
4. Run input: the JSON check uses `Schema.fromJsonString(Schema.Unknown)` instead of `JSON.parse`. The messages and their order are unchanged: invalid JSON first, then "at most 4 KB".
5. RoutinesSection: each row has its own `useAction`, but a shared busy flag still disables every row's buttons while any action runs. Same disabled states as before.

**Open question (needs a decision):**
- The spec asks for per-row concurrency ("different rows can run at the same time"). The current code, and the spec's rule that disabled states stay byte-identical, both mean only one routine action runs at a time. I kept the disabled rule, so rows never overlap. Letting rows run in parallel would change what the buttons look like while a request is in flight. Julio should decide which one he wants.
- `failureText` is repeated in the three files because `errors.ts` is outside the Allowed files. Moving it to `apps/web/src/lib/effect/errors.ts` would be a small follow-up.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **Tests first:** they were committed against the old code (19 new) and pass unchanged after the conversion (42).
- **The sections:** all three are Effect files; the run input is decoded by Schema.
- **The shared busy flag across routine rows is kept**, which is right here because it preserves the old disabled states.
- **Behaviour changes accepted:** a newer source load cancels the old one, and a double confirm sends once.
- **Results:** the gate passed.
