---
id: T-2198
title: "Tests only for crucial code: delete 4 client tests of search text, media retry state and a media row parser; product code unchanged"
status: merged
milestone: M5
branch: task/T-2198-trim-ui-tests
model: deepseek/deepseek-flash
effort: default
estimate: 10 min
---

# T-2198: Delete 4 client tests outside the crucial areas

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10 (`CLAUDE.md`, Hard rules): tests only for crucial code, meaning auth and keys, permissions and money, and the message pipeline. There are no UI tests. These four files test people-search text, a media retry view state, and a media-tab row parser.

### Facts (the lead read these on 2026-10-19)
Delete:
- `packages/client-core/src/people-handle-search.test.ts` (16 lines, `peopleHandleFor`)
- `packages/client-core/src/people-search.test.ts` (35, `normalizePeopleQuery`)
- `packages/client-core/src/use-media-retry.test.ts` (92, the media retry view state)
- `apps/mobile/src/lib/media-api.test.ts` (37, drops a media row with a bad date)

These stay: `composer-drafts.test.ts` (one user's drafts never reach another), `errors.test.ts`, and the phone's push, URL-trust, DM-id, share, gallery and timeout tests.

### Steps
1. Delete the four files. Change no other file.
2. If a test-only helper was used only by them, delete it too and name it in the Report.
3. Run `pnpm gate`.

### Allowed files
- The four test files above
- `work/T-2198-trim-ui-tests.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The diff only deletes those test files.

---

## Report (written by the worker when done)

### What I did

Deleted the four test files named in the task and changed no product code:

- `packages/client-core/src/people-handle-search.test.ts`
- `packages/client-core/src/people-search.test.ts`
- `packages/client-core/src/use-media-retry.test.ts`
- `apps/mobile/src/lib/media-api.test.ts`

No test-only helper was deleted. I checked the imports the files used:
`jsonResponse` (`apps/mobile/src/test/wait.ts`) is still used by
`apps/mobile/src/lib/auth-api.test.ts`, and `peopleHandleFor`, `peopleFailureState`,
`makeChatExtrasApi` and the media retry functions are product code used by the apps.
The only helper local to the deleted files was `exhaust` inside
`use-media-retry.test.ts`, which went with the file.

### Commands

- `pnpm install`: Done in 13.7s, 1155 packages. One peer-dependency warning in
  `apps/mobile` (`@types/react@19.2.18` vs `@types/react-dom` wanting `^19.3.0`);
  it was already present before this task.
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.4s)
  SKIP effect (no source files changed)
  PASS  build @zilar/server  (0.8s)
  SKIP tests @zilar/client-core (no nearby test files)
  SKIP tests @zilar/mobile (no nearby test files)
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  The gate's scope check listed the same four deleted test files as "outside the
  Allowed files". They are exactly the files the task allows; the checker only reads
  backticked path tokens under "Allowed files", and this task names them in prose
  ("The four test files above"). I did not edit the Spec to add the backticked paths.
  There are no changed files beyond those four deletions and this task file.

No single test file was run while working: the task only deletes tests, and the gate
skipped tests for both packages because no test file remains near the change.

### Deviations

None. No product code, no test helpers and no other files changed.

### Blocked / needs a decision

Nothing.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings).

The diff only deletes the 4 listed test files (−180 test lines; product code unchanged), per Julio's 10-10 rule:
- people-search text;
- the media retry view state;
- a media row date parser.
