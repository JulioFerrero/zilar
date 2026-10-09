---
id: T-0773
title: "WU22: web dialogs on Effect — NewGroupDialog, NewTopicDialog, FolderEditorDialog, AddContactDialog use useAction/useQuery/fromApi; no async, try or timers in the components; same text and behaviour"
status: merged
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

**Tests before/after:** 26 passed before (AddContactDialog 5, FolderEditorDialog 11, NewTopicDialog 6, NewGroupDialog 4); 26 passed after. No test file was edited.

**effect:map kind after the change (from `pnpm effect:map`, `dist/effect-map/data.json`):** all four files are `effect`, with no signals. Before: NewGroupDialog H1 H3 W4, NewTopicDialog H1 W4, FolderEditorDialog H1 W4, AddContactDialog H1 H3.

**What changed**
- `AddContactDialog.tsx`: the 300 ms debounced lookup is `useQuery(() => lookupHandle(trimmed), [trimmed])`, where `lookupHandle` is `Effect.sleep(300)` then `fromApi(lookupByHandle)`. A 404 maps to "missing", and rate limit or other errors map to the same two sentences as before. A relation change from the card is kept in a small state keyed on the handle.
- `NewGroupDialog.tsx`: the public-handle check is `useQuery` keyed on `[visibility, trimmedHandle]`, with `Effect.sleep(300)`. Create is `useAction<void, void, CreateFailure>`. The validation messages are typed errors (`NameMissing`, `HandleMissing`, `HandleRefused`), and API failures go through the same `friendlyCreateError` switch.
- `NewTopicDialog.tsx`: the roles and "my AIs" loads are `useQuery`. Create is `useAction` with an `Effect.gen`. Each AI add and the roles step keep their swallow-errors behaviour through `Effect.ignore`. The name check is a typed error.
- `FolderEditorDialog.tsx`: save and delete share one `useAction` with input `'save' | 'delete'`, so a save and a delete never overlap, as the shared busy flag did. A delete failure is the typed `FolderDeleteFailed`, which keeps its own sentence and still closes the confirm dialog.
- No `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` remains in the four files (checked by the gate's effect step and by reading them).

**Lead note (per-row actions):** the only per-row buttons in these dialogs are the checkboxes for contacts, members, AIs, roles and chats, and the "Remove" on stale chats. They call local state toggles, not async work, so none needed its own `useAction`. I added no per-row test for the same reason.

**Behaviour differences (all small; the tests pass unchanged)**
1. AddContactDialog: while a new handle is being looked up, the previous card is hidden. The old code kept it until the answer came. Clearing the input also hides the card.
2. NewGroupDialog: the availability line used to be cleared on every handle keystroke, including a trailing space that leaves the trimmed handle unchanged. Now the result is keyed on the trimmed handle, so a trailing space keeps the last result on screen.
3. NewTopicDialog: if the group detail id becomes undefined after roles were loaded, the roles list is now empty. The old code kept the previous roles.
4. FolderEditorDialog: starting a delete now hides the previous save error while the delete waits. The old code kept it until the delete finished.
5. Non-API failures: a plain exception thrown by the synchronous part (`onClose`, `navigate`, `store.setFolders`) is a defect, and the dialog shows no sentence for it. The old code showed the component's fallback sentence. I did not add a fallback for defects. A real network or server failure still gets the fallback sentence (`friendlyCreateError` maps the non-ApiError status 0 to the channel fallback, and `saveErrorMessage` and the topic text keep their old wording).

**Commands run (real results)**
- `pnpm install`: done.
- `pnpm --filter @zilar/web test --reporter=dot <four dialog files>`: 26 passed, before and after.
- `pnpm exec prettier --write` on the four files: done (three were reformatted).
- `pnpm effect:map`: exit 0; the kinds are listed above.
- First `pnpm gate`: FAIL at lint, two `no-unused-vars` errors on the `_: void` parameters in NewTopicDialog and NewGroupDialog. Fixed with `useAction<void, void, E>(() => ...)` and `runCreate()`.
- Final `pnpm gate`: exit 0.
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (0.9s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (3.4s)`
  - `PASS  effect  (1.2s)`
  - `PASS  tests @zilar/web  (5.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Open questions:** none blocking. Items 1 to 4 above are behaviour changes Julio may want to accept or reverse; the code can match the old behaviour if he says so.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff and the Report.
- **The dialogs:** all four are Effect files. Debounced lookups use `useQuery` keyed on the trimmed input with `Effect.sleep(300)`; create, save and delete use `useAction`.
- **Behaviour changes 1-4 are accepted:** a stale lookup card is hidden, results are keyed on the trimmed handle, roles clear when the group goes away, and a stale save error hides during a delete. All are neutral or better.
- **Item 5 is accepted:** a defect in synchronous UI code is a bug, not a user-facing state.
- **Results:** 26 tests pass unchanged, and the gate passed (with the effect step).
