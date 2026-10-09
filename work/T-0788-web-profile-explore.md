---
id: T-0788
title: "WU24: ContactProfileRow, ExplorePage, ProfileSettingsSection, VisibilitySection on Effect"
status: merged
milestone: M5
branch: task/T-0788-web-profile-explore
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0788: WU24: ContactProfileRow, ExplorePage, ProfileSettingsSection, VisibilitySection on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, W4 try/catch):
  - `apps/web/src/components/ContactProfileRow.tsx` (338, H1 W4), tested in `ContactProfileRow.test.tsx`;
  - `apps/web/src/components/ExplorePage.tsx` (277, H1 H3 W4), tested in `ExplorePage.test.tsx`;
  - `apps/web/src/components/ProfileSettingsSection.tsx` (221, H1 H3 W4), tested in `ProfileSettingsSection.test.tsx`;
  - `apps/web/src/components/VisibilitySection.tsx` (252, H1 H3 W4), tested in `VisibilitySection.test.tsx`.
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` (per-row actions, T-0767), `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery` and typed validation errors, T-0773), and `apps/web/src/routes/StickersPage.tsx` (a page-level dialog with per-row actions, T-0783).
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
- **Keep the rendered structure.** Dialogs (`components/ui/dialog.tsx` is a non-portalled `fixed inset-0` overlay), lists and sections stay where they are in the tree. Moving a dialog into a row can clip it or stack it under other content (the lead's T-0783 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report. **Exception:** a chat-store action that rejects with a plain `Error` carries a user-facing sentence the store wrote, so keep showing its `message`, as GroupPanel does since T-0781. Only non-`Error` causes get the fallback.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the listed files with the pattern.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/VisibilitySection.tsx`, `work/T-0788-web-profile-explore.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/ContactProfileRow src/components/ExplorePage src/components/ProfileSettingsSection src/components/VisibilitySection
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Result: the four files are converted, `pnpm gate` ends with GATE PASS, and no test file was edited.

### Files changed
- `apps/web/src/components/ContactProfileRow.tsx`: one `useAction` with a union input (`send`, `accept`, `decline`, `cancel`, `block`, `unblock`) replaces the four handlers and the `busy` flag. `busy` is `isWaiting(state)`, so every button is disabled exactly as before. A module-level `onPendingRequest` (an `Effect.gen`) finds the pending request row; a missing row fails with the typed `RequestGone`.
- `apps/web/src/components/ExplorePage.tsx`: the debounced search is `useQuery` with `Effect.sleep(300)`, and Retry calls its `refresh`. "Show more" is a `useAction` in ignore mode. Join and Open are one `useAction` on the page (see differences).
- `apps/web/src/components/ProfileSettingsSection.tsx`: the live handle check is `useQuery` with `Effect.sleep(300)`. Save is a `useAction`. The copy button is a `useAction`. The avatar change's session refetch is a `useAction` in `replace` mode, because `ProfilePictureSection` runs before its early return.
- `apps/web/src/components/VisibilitySection.tsx`: the same check conversion. Save is a `useAction`, and so is the copy button.

Each file keeps its props and exports. No `async`, `await`, `.then(`, `try {`/`catch (`, `setTimeout` or `setInterval` remain. The only matches for `Promise` are `Effect.tryPromise` and the `Promise<A>` type annotation of a local helper `fromStore` (in ExplorePage and VisibilitySection, which lift the chat-store calls).

### Commands and results
- Baseline, before any edit: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ContactProfileRow src/components/ExplorePage src/components/ProfileSettingsSection src/components/VisibilitySection`: 4 files, 25 tests passed.
- After, each file alone: ContactProfileRow 7 passed, ExplorePage 8 passed, ProfileSettingsSection 4 passed, VisibilitySection 6 passed (25 in total, the same tests as before).
- Whole web suite, after: `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: Test Files 170 passed (170), Tests 1813 passed (1813). The 1813 baseline is from the spec; I did not run the whole suite before the edits.
- `pnpm --filter @zilar/web typecheck`: passed with no errors.
- `pnpm effect:map`: 842 files, coverage 58.7%. From `packages/devtools/dist/effect-map/data.json`, the kind is `effect` for all four files: ContactProfileRow, ExplorePage, ProfileSettingsSection, VisibilitySection.
- `pnpm gate` (run from the worktree root, pwd checked): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Behaviour differences (all deliberate, listed for review)
1. **Join and Open are one page-level `useAction`, not one per row.** The old code kept one join at a time for the whole page: `joiningId` disables every Join button. Per-row actions would change those disabled states, so I kept the old concurrency. Open and Join share the ignore-mode guard, and the Open button is disabled during a join just as before.
2. **Open now closes the dialog after the General topic id is resolved**, not before the lookup. The old code closed first and then awaited. The close and navigate run in one final step, so an unmount cannot cut the navigation short.
3. **Plain-Error messages from the chat store are shown.** `joinPublicGroup` (ExplorePage) and `setGroupVisibility` (VisibilitySection) can reject with a plain `Error` whose message the store wrote, for example `This group is not available yet.`. Per the spec's exception, that message is now shown. Before, the fixed fallback was shown (`Could not join. Try again.` / `Could not save the visibility. Try again.`). ApiError codes and their sentences are unchanged.
4. **Unmount interrupts a running action** (ContactProfileRow, ExplorePage, ProfileSettingsSection, VisibilitySection). Before, the old promise chain ran on after the component unmounted, so a block's `refreshBlockedJids` could finish after the row was gone. Now it is interrupted.
5. **The live handle check clears when the handle is empty or is the own handle** (ProfileSettingsSection and VisibilitySection). Before, the old effect returned early and left the old "is available" line on screen, for example `@ada2 is available` after the user typed `ada`. Now nothing shows.
6. **Typing that does not change the trimmed value no longer hides the check line** (VisibilitySection). Before, the typed handler cleared the check even when the trimmed value was unchanged, for example after a trailing space. The check now runs through `useQuery` keyed on the trimmed value, so the line stays while the trimmed value is unchanged.
7. **Failures that used to be silent or unhandled now end in a failed action state.** The copy buttons (`copyText` rejection) and the avatar change's session refetch used to be an unhandled promise rejection. They are now silent failed actions. Nothing new is shown to the user.
8. **Load-more failures** still show `Could not load more. Try again.` in the same join-error line, as before.
9. The search's loading state keeps the old timing: rows stay visible during the 300 ms debounce, and "Searching…" appears when the request starts. A query under 2 characters still makes no request. From reading the old effect, a 1-character query after an in-flight search leaves `Searching…` on screen. I kept that, not fixed.

### Open questions
- Items 1 and 3 are judgment calls: item 1 keeps the page-level join concurrency (the spec's per-row rule would change the disabled states), and item 3 follows the spec's plain-Error exception even though the current code shows the fallback there.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **The files:** all four are Effect files.
- **Join stays one page-level action,** as the old `joiningId` guard was.
- **Store `Error` sentences now show** (the agreed rule).
- **Behaviour changes accepted:** Open closes after the topic lookup; unmount interrupts; the stale handle check clears.
- **Results:** 25 tests and the whole web suite (1813) pass; the gate passed.
