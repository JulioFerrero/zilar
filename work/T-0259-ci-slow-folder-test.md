---
id: T-0259
title: "CI: main is red. Make the folder picker cap test fast and the MachinesPage 'Copied' check wait for the update"
status: merged
milestone: M5
branch: task/T-0259-ci-slow-folder-test
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0259: CI green again

## Spec (written by Claude, do not edit)

### Why
CI on `main` has been red since T-0244 (runs 37379381144, 37381418802, 37382722630 and others; `gh run list --workflow CI --branch main`). Every failure is `apps/web/src/components/FolderEditorDialog.test.tsx` > "caps the include and exclude pickers at 100": `Error: Test timed out in 60000ms`. One run (37380177319) also failed `apps/web/src/routes/MachinesPage.test.tsx` > "opens the add-machine dialog and shows the code with a working copy key" with `AssertionError: expected 'Copy' to contain 'Copied'`. Local gates pass, so both are slow-runner timing problems.

### Verified facts (do not re-derive)
- `apps/web/src/components/FolderEditorDialog.test.tsx` lines 97-124 render 101 chats, open "Create new folder", then click 100 checkboxes one by one (lines 116-118) before checking "100 of 100 selected" and that `Chat 100` is disabled. The test has `{ timeout: 60000 }`.
- `FolderEditorDialog` takes `folder: ApiChatFolder | null` (`apps/web/src/components/FolderEditorDialog.tsx` line 46). An existing folder's `includeChats` start selected.
- `apps/web/src/routes/MachinesPage.test.tsx` lines 432-436: after clicking "Copy pairing code" it awaits `writeText` with `waitFor`, then reads the button text synchronously, expecting "Copied".

### What to build
1. **Cap test:**
   - start from an existing folder whose `includeChats` already holds `c-0`..`c-99`, either through the store (`setFolders`) and opening that folder's editor, or the way the other tests in the file open an existing folder;
   - assert "100 of 100 selected" and that `Chat 100` is disabled;
   - click `Chat 0` to unselect, check "99 of 100" and that `Chat 100` is enabled;
   - check the Hide picker still says "0 of 100 selected".
   No loop of 100 clicks. Remove the 60 s timeout.
2. **MachinesPage:** put the "Copied" check inside the `waitFor` (or use `findByText`).
3. Run each changed test file 3 times locally and report the durations.

### Read first
`AGENTS.md`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/routes/MachinesPage.test.tsx` (lines 400-440).

### Allowed files
`apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`, `work/T-0259-ci-slow-folder-test.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot FolderEditorDialog MachinesPage
pnpm gate
```

### Acceptance
- The cap test runs in well under 5 s locally. No product code changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did

1. `apps/web/src/components/FolderEditorDialog.test.tsx` — rewrote the cap test
   ("caps the include and exclude pickers at 100"). It no longer opens the create
   dialog and clicks 100 checkboxes. Instead it seeds the store with an existing
   "Personal" folder whose `includeChats` are `c-0`..`c-99`, opens that folder's
   editor with the `Edit Personal` button, asserts "100 of 100 selected" and that
   `Chat 100` is disabled, clicks `Chat 0` once to unselect, asserts
   "99 of 100 selected" and that `Chat 100` is enabled, and asserts the Hide
   picker still says "0 of 100 selected". The `{ timeout: 60000 }` and the
   100-iteration loop are gone, and the test is now synchronous (no `async`).
2. `apps/web/src/routes/MachinesPage.test.tsx` — moved the `'Copied'` text
   assertion inside the same `waitFor` as the `writeText` assertion, so it
   retries until React commits the `copied` state instead of reading the button
   synchronously right after `writeText` resolves.

No product code changed.

### Files changed

- `apps/web/src/components/FolderEditorDialog.test.tsx`
- `apps/web/src/routes/MachinesPage.test.tsx`
- `work/T-0259-ci-slow-folder-test.md`

### Commands and real results

Single files, 3 runs each, `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot <path>`:

- `src/components/FolderEditorDialog.test.tsx`: 10/10 passed each run; file
  durations 1.85s, 1.64s, 1.68s (a first verification run was 3.07s).
- `src/routes/MachinesPage.test.tsx`: 16/16 passed each run; file durations
  1.62s, 1.65s, 1.77s (a first verification run was 2.19s).

`pnpm gate` from the repo root:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (15.9s)
PASS  lint  (0.8s)
PASS  typecheck  (8.7s)
PASS  tests @zilar/web  (3.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The first gate run failed on `format` for `FolderEditorDialog.test.tsx`; I ran
`pnpm exec prettier --write apps/web/src/components/FolderEditorDialog.test.tsx`
and the next gate passed. `pnpm install` left `pnpm-lock.yaml` untouched (git
status shows only the 3 allowed files changed).

### Notes

- The cap test now finishes well under 5s; the whole test file is under 2s.
- No deviations from the spec, no open questions.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (0 nits).
- The cap test now starts from a folder with 100 chats, checks 100/100 and that `Chat 100` is disabled, then unselects one: about 1.7 s instead of a 60 s timeout.
- The "Copied" check now sits inside the `waitFor`.
- No product code changed.
