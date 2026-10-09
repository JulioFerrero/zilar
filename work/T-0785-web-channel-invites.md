---
id: T-0785
title: "WU17: ChannelPanel, ChannelComposerBar, InviteDialog, InviteLinksSection on Effect"
status: merged
milestone: M5
branch: task/T-0785-web-channel-invites
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0785: WU17: ChannelPanel, ChannelComposerBar, InviteDialog, InviteLinksSection on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files**, with their lines and signals from `pnpm effect:map` on main `82db347b` (H1 async, H3 timers, H5 storage, W4 try/catch):
  - `apps/web/src/components/ChannelPanel.tsx` (563, H1 W4), no test;
  - `apps/web/src/components/ChannelComposerBar.tsx` (84, H1 W4), no test;
  - `apps/web/src/components/InviteDialog.tsx` (82, H1 W4), tested in `InviteDialog.test.tsx`;
  - `apps/web/src/components/InviteLinksSection.tsx` (262, H1 W4), tested in `InviteLinksSection.test.tsx`.
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
Convert the listed files with the pattern. For `ChannelPanel` and `ChannelComposerBar` (no tests), **write the tests first, against the current code, and commit them (": tests before")**; then convert, and the same tests must pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.6, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/routes/BlockedPage.tsx`, the listed files and their tests.

### Allowed files
`apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/ChannelPanel.test.tsx`, `apps/web/src/components/ChannelComposerBar.tsx`, `apps/web/src/components/ChannelComposerBar.test.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/InviteLinksSection.tsx`, `work/T-0785-web-channel-invites.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/ChannelPanel src/components/ChannelComposerBar src/components/InviteDialog src/components/InviteLinksSection
pnpm gate
```
Run `pnpm effect:map` and list each file's kind in the Report, then run the whole web suite once and paste its summary.

### Acceptance
- Each listed file imports Effect, with no async, timers, raw storage or try/catch of its own.
- The text and behaviour are the same, or each difference is listed in the Report; the old tests pass unchanged, any new tests pass, and the whole web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Commits:** `4744b3b0` "T-0785: tests before" (the two new test files, green on the unconverted code); the conversion commit is the one that carries this Report.

**Test counts**
- Before conversion (against the old code): `ChannelPanel.test.tsx` 19 passed, `ChannelComposerBar.test.tsx` 9 passed (28 total, all green).
- Test-file edits after the "tests before" commit, all type-only: `kind: 'channel'` changed to `'group'` (`ChatKind` is `dm | group | ai`), an unused `method` parameter renamed `_method`, and the mock type of `setMuted` widened to `unknown`. Re-run with the old component code: the same 28 pass.
- After conversion: `pnpm --filter @zilar/web test --reporter=dot src/components/ChannelPanel src/components/ChannelComposerBar src/components/InviteDialog src/components/InviteLinksSection`: 4 files, 35 passed (ChannelPanel 19, ChannelComposerBar 9, InviteDialog 1, InviteLinksSection 6). The same test bodies passed unchanged. No existing test was edited.
- Whole web suite (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`): 172 files passed, 1841 tests passed, 0 failed. (Main was 1813; +28 new.)

**effect:map kind** (`dist/effect-map/data.json` at the repo root, written by `pnpm effect:map`)
- `apps/web/src/components/ChannelPanel.tsx`: effect
- `apps/web/src/components/InviteDialog.tsx`: effect
- `apps/web/src/components/InviteLinksSection.tsx`: effect
- `apps/web/src/components/ChannelComposerBar.tsx`: **plain**. The classifier counts only a value import of `effect`; this file uses `fromApi` and the hooks and has no direct `effect` import. I did not add an import only to change the label. Lead to decide.

**What was done**
- Files converted: `ChannelPanel.tsx`, `ChannelComposerBar.tsx`, `InviteDialog.tsx`, `InviteLinksSection.tsx`. No `async`, `await`, `.then(`, `try`/`catch`, timers or raw storage remain in them (the one `.then` in InviteDialog and the one in InviteLinksSection are gone; `copyText` runs through `Effect.tryPromise` in `useAction`).
- Loads use `useQuery` with `fromApi` (admins, invite links, my AIs, InviteDialog's invite). Actions use `useAction`: mute, copy, create link, leave, role flip, add AI (one action, with the picked id kept so only that button says "Adding…"), and per-row remove AI and per-row revoke link.
- Non-query skips (manager/no group) return `Effect.never`, so nothing loads and no failure shows.

**Behaviour differences (please check)**
1. Non-API failures (plain `Error`s, including the store's own guard sentences like "This channel is not available yet.") now show the component's fixed fallback instead of the thrown text. This is the case the spec allows. API failures (`ApiError`, including network status 0) keep their exact text: `ApiError.message`, or the AI mapping through `describeAiError`. `shownText` tells the two apart with `failure.code === 'unknown_error'`, the marker `toApiFailure` gives non-API throws.
2. `InviteLinksSection`'s `onRevoke` prop now also accepts an `Effect` (type `void | Promise<void> | Effect<void, unknown>`). `GroupPanel` still passes its promise and is unchanged. Props and exports are unchanged. This was needed because ChannelPanel cannot produce a promise without `runPromise` in a component.
3. Revoke: the row's busy state now ends when the DELETE settles. The old code also waited for the list reload; the reload is now a query refresh started right after, not awaited, so "Revoking…" clears slightly earlier.
4. Create link: the list reload after create is a query refresh. If that reload fails, the message is "Could not load the invite links." (old: "Could not create the link.").
5. Load error vs action error: both are kept; the action error shows first when both exist. Old code had one slot; a successful create no longer clears an earlier load error.
6. Concurrency kept as before: role flip and add stay one-at-a-time (the old global `roleBusy` / `addingId` disabled every button); remove AI and revoke link are per row (the old code allowed two rows at once).
7. Remove success closes the confirm (as before). Add success also closes any open confirm (new, so a stale confirm cannot reappear if the same AI is re-added).
8. Dialogs: nothing was moved. The only `Dialog` is `InviteDialog`'s own top-level dialog, as before. The row components contain no `Dialog`. The AI confirm was always inline buttons in the row, and it still is.
9. Copy (InviteDialog and InviteLinksSection): `copyText` resolves in practice, so the visible behaviour is the same. The new `tryPromise` gives any rejection a typed error that is ignored, where the old `.then` left it unhandled; "Copied" appears only on success, as before.

**Gate** (`pnpm gate` from the worktree root, exit 0):
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (3.9s)
PASS  format  (3.7s)
PASS  lint  (4.3s)
PASS  typecheck  (12.8s)
PASS  effect  (4.9s)
PASS  tests @zilar/web  (8.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```
The gate's test step runs only the nearest web tests. The whole web suite was run separately (above).

**Fix round 1 (lead review, item 1)**
- Store-action failures in ChannelPanel (add AI, remove AI, leave, change role) now go through `storeCall`. An `ApiError` keeps the API path (`ApiFailure`, server message, or the AI sentence mapping). A plain `Error` becomes `StoreFailed` and shows its own message. Any non-Error throw shows the fixed fallback for that action.
- Tests added: role change rejecting with `new Error('Only admins can do that')` shows that exact text; a non-Error rejection shows "Could not change the role.". Both are new tests, and no existing test was edited.
- Counts after the fix: the four target files 37 passed (ChannelPanel 21, ChannelComposerBar 9, InviteDialog 1, InviteLinksSection 6). Whole web suite 172 files, 1843 tests passed. `pnpm gate`: GATE PASS (7 changed files, all in Allowed).

**Open questions**
- `ChannelComposerBar` is `plain` by the classifier although it uses Effect through `fromApi`; the acceptance line "each listed file imports Effect" may need a decision.
- Point 2 changes a prop type. If the lead wants `InviteLinksSection` to stay Promise-only, ChannelPanel would need another way to keep "Revoking…" busy until the DELETE settles.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Worker: Haiku 5.5. The lead reviewed the Report.
- **Tests first:** 28 tests were committed against the old code.
- **The kinds:** three files are Effect; ChannelComposerBar is plain, which is fine because it uses the hooks with no async of its own.
- **Fix round 1:** store-action failures keep the store's own sentence (tested), and non-Error causes get the fixed fallback.
- **Results:** 37 tests and the whole web suite (1843) pass; the gate passed.
