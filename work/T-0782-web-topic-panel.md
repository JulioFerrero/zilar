---
id: T-0782
title: "WU16: TopicPanel on Effect"
status: merged
milestone: M5
branch: task/T-0782-web-topic-panel
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0782: WU16: TopicPanel on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/components/TopicPanel.tsx` (1108, H1 W4), tested in `TopicPanel.test.tsx`.
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
Convert the listed files with the pattern. It is large: convert one action at a time and run its test after each step.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/TopicPanel.test.tsx` (added in fix round 1, with the lead's permission), `work/T-0782-web-topic-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/TopicPanel
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** review. Gate: `GATE PASS` (scope: every changed file is inside the Allowed files).

### What changed
- `apps/web/src/components/TopicPanel.tsx` is converted. It imports `Effect` and uses `fromApi`, `useQuery`, `useAction`, `isWaiting` and `isApiFailureCode`. It has no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval`, and no raw storage. `grep` confirms the only `catch` matches are `Effect.catchTag` and `Effect.catchIf`.
- `TopicPanel` is now an outer guard (returns `null` without a topic, as before) around `TopicPanelBody`, so every hook runs before any early return.
- Mount loads (members, AIs, tools count, my AIs, roles) are `useQuery` atoms that write into the same local state as before. Retry uses the query's `refresh`.
- Each Remove / Add row is its own small component with its own `useAction`: `RemoveMemberButton`, `AddMemberButton`, `RemoveAiButton`, `AddAiButton`. Leave, Make private / public and Archive each have a `useAction` at panel level. Both ConfirmDialogs stay where they were in the tree, at panel level, and are not moved into rows.
- Member and AI reloads after an action do not reset the list to Loading. The picker close runs in the same sync step as the list update. This keeps a row's call mounted until its last step (an unmount interrupts the call).
- Roles stay one section-level `useAction` (`saveRoles`, ignore mode). Each save sends the whole role list, so two concurrent saves would drop one change. This is a deliberate exception to the per-row rule; see the open question.
- No new tests were added, and no existing test was edited.

### Effect map
`pnpm effect:map`: `apps/web/src/components/TopicPanel.tsx` is kind `effect`, legacy `[]`. Overall: 842 files, coverage 56.1%.

### Tests run
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/TopicPanel`: before 27 passed, after 27 passed (run after the first rewrite and again after the per-row rewrite).
- Whole web suite, `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: `Test Files 170 passed (170)`, `Tests 1813 passed (1813)`. The 1813 baseline is from the spec; I did not run the suite on main myself.
- `tsc --noEmit` for `tsconfig.json` and `tsconfig.node.json`: both exit 0. `oxlint` on the file: exit 0. `prettier --write` applied.

### Gate summary lines
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (1.0s)
PASS  effect  (0.7s)
PASS  tests @zilar/web  (5.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Behaviour differences (all of them)
1. **Fixed fallback sentences for non-API failures.** A failure that is not an `ApiError` (a plain `Error` thrown by the store) now shows a fixed sentence such as "Could not add the member." instead of its raw message. `ApiError` messages (for example "Could not reach the server") are shown unchanged, as the tests check. This is allowed by the spec.
2. **Button disabling is per row, not global.** The old code disabled every action button while any action ran. Now a row's button is disabled only while its own call runs. Two rows can run at once. A double click on the same row is ignored.
3. **Reload after an action keeps the list visible.** It no longer flashes Loading…. The list is replaced when the new list arrives.
4. **A failed reload after a delete keeps the list.** When the list had rows, the failure now leaves it as `ready` with the message "Could not refresh the list." and a Retry (the old code's intent, which the old state flow never reached because the list had already been reset to loading). When the list had one row or none, it shows the error state, as before.
5. **Unmount now cancels an in-flight call.** The old code kept reloading and updating state after close. This follows `use-action.ts` (unmount interrupts). The request itself still reaches the server, because `api.ts` ignores the abort signal.
6. **Confirm dialogs ignore a second click.** A second click on Confirm while the first call runs is dropped (ignore mode). The old code could send it twice.
7. **Leave, Make private / public and Archive** each show their own busy state through their `useAction`. Their labels and disabled states are the same as before, except that they no longer depend on other rows.
8. **Roles** keep their busy state for the whole section (the Remove and picker buttons are disabled while a save runs), as before.
9. **Retry** on a list that is already `ready` (the "could not refresh" line) no longer shows Loading… first; it keeps the rows on screen until the new list arrives.
10. **Removed guard.** The `topicId !== undefined` check before Tools and Routines is gone, because the body always has a topic.

### Open question / unsure
- Roles save is one section action, not per row. Per-row roles would race (each save sends the whole list). Tell me if you want per-row anyway.
- I am not fully sure that per-row disabling (item 2) is the behaviour you want. The old global disable was the existing behaviour, and I replaced it with per-row because of the lead's note.

### Fix round 1 (lead item 1)
- Chat-store actions (`addTopicMember`, `removeTopicMember`, `addTopicAi`, `removeTopicAi`, `leaveTopic`, `patchTopic`, `refreshTopicRow`, `setTopicRoles`, `listMyAis`) now go through `storeCall` in `TopicPanel.tsx`. It maps an `ApiError` as `toApiFailure` does, keeps a plain `Error`'s message (a `store_error` failure), and sends any other cause to the unknown failure, which shows the fixed fallback. API reads (`listTopicMembers`, `listTopicAis`, `listTopicTools`, `getTopic`, `listGroupRoles`) stay on `fromApi`.
- New test in `TopicPanel.test.tsx`: "shows the exact message of a plain Error thrown by a store action" (a store `removeTopicMember` rejecting with `new Error('Only admins can do that')` shows that exact text). Added to Allowed files with the lead's permission.
- Tests: `TopicPanel.test.tsx` 28 passed (27 before, plus the new one). Whole web suite: `Test Files 170 passed (170)`, `Tests 1814 passed (1814)`. `tsc` (both configs) and `oxlint` exit 0.
- Gate: `GATE PASS`, `gate: 3 changed file(s) against main`, `scope: every changed file is inside the Allowed files`.
- `grep` note: the only `catch` left is the `catch:` option of `Effect.tryPromise` in `storeCall` (not a try/catch statement).

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **The panel** is an Effect file with per-row actions; roles stay section-level, which is right given the whole-list save.
- **The dialogs** stay at panel level.
- **Fix round 1:** store failures keep their sentence (tested).
- **Results:** 28 tests and the whole web suite (1814) pass; the gate passed.
