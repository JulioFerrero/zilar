---
id: T-2175
title: "Server: drop pass-through re-exports in non-index files; every importer imports from the module that defines the name; no behaviour change"
status: merged
milestone: M5
branch: task/T-2175-server-reexports
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2175: Server imports point at the real module

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and a codebase people and AIs can follow. A pass-through `export { X } from './other'` in a service or API file gives a name two homes: a reader jumps to the wrong file, and a search finds both. At `74a5ec178` the server has 52 one-line re-exports in the 26 files below, and some multi-line `export {…} from` blocks besides. Find them all with:

```bash
git grep -nE "^export (type )?\{[^}]*\} from '|^export \* from '|^\} from '" -- apps/server/src ':!apps/server/src/auth' ':!*.test.ts' ':!**/index.ts'
```

Files with one-line re-exports at `74a5ec178`:
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/ai/model-client.ts`
- `apps/server/src/approvals/service.ts`
- `apps/server/src/avatars/service.ts`
- `apps/server/src/chat-prefs/service.ts`
- `apps/server/src/connections/providers.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/db/rows.ts`
- `apps/server/src/groups/service.ts`
- `apps/server/src/machines/service.ts`
- `apps/server/src/main.ts`
- `apps/server/src/pins/service.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/service.ts`
- `apps/server/src/roles/service.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/tools/adapters.ts`
- `apps/server/src/tools/service.ts`
- `apps/server/src/topics/rooms.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/voice-transcription/routes.ts`

### Steps
For each re-export (one-line or multi-line):
1. Find every importer of each re-exported name through this file: `git grep -n "<name>" -- apps/server/src`.
2. Change those imports to the module that defines the name.
3. Delete the re-export.
4. **Aliases.** If the re-export renames (`export { A as B } from`), the importers use the defining name `A`.
5. **Keep it** and say why in the Report when:
   - the file is a deliberate public entry point that a package or script outside `apps/server/src` imports by path;
   - removing it would need a change in `apps/server/src/auth/**`.

### Rules
- Imports and exports only: no runtime code changes.
- Do not touch `apps/server/src/auth/**`.
- No new tests. Update test import paths as needed.

### Allowed files
- `apps/server/src/**`
- `work/T-2175-server-reexports.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The grep above lists only the kept re-exports, each with a reason in the Report.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.

---

## Report (written by the worker when done)

### What I did

- Removed 70 pass-through `export … from` re-export statements from 32 files under
  `apps/server/src`: the 26 files with one-line re-exports from the spec, plus
  `agents/gateway.ts`, `chat-folders/service.ts`, `hands/cloud-hands.ts`,
  `invite-links/tokens.ts`, `routines/execute.ts` and `topics/access.ts`, which had
  multi-line blocks.
- Repointed 206 imported names in 104 importer files to the module that defines them.
  - Aliased re-exports were repointed to the defining name: importers now call
    `getTopic` directly (fix round, finding 1).
  - Re-export chains were followed to the real definition, e.g. `countTopicMembers`
    imported from `topics/access` goes to `topics/queries`, not to `topics/views`.
  - `export *` re-exports were expanded to their names: `agents/tool-loop.ts` →
    `./replies` and `db/rows.ts` → `./rows-agents`.
- Only import/export lines changed. Two test-side paths were updated so the code still
  loads: `push/component.test.ts` now mocks `./delivery` (where `handleIncomingPush`
  is defined) and the dynamic import of `canDecide` in `roles/roles.test.ts` points at
  `../approvals/access`.
- No re-export was kept. No importer outside `apps/server/src` referenced any removed
  name (checked repo-wide for `apps/server/src/…` and `@zilar/server/src/…` imports),
  and no removal needed a change inside `apps/server/src/auth/**`, so neither keep
  rule applied.

### Checks run

- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/component.test.ts`
  — `Test Files 1 passed (1)`, `Tests 5 passed (5)`.
- `pnpm gate` — exited 0 with `GATE PASS`:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Re-export grep: zero remaining `export … from` statements in `apps/server/src`
  (outside `auth/`, `*.test.ts` and `**/index.ts`).
- Net lines from `git diff main --numstat -- apps packages`: 136 files, +296 / −500,
  net −204. Note: `main` gained T-2174 (7 files, +55 net) while this task ran. Relative
  to the branch point the work is 129 files, +205 / −464, net −259.

### Notes for the lead

- The acceptance grep's third alternative, `^\} from '`, also matches the closing line
  of multi-line **imports**; those lines still appear. Filtering to statements that
  start with `export` and use `from` gives none.
- Left alone because the spec's grep does not match them (no `from`, they re-export
  names already imported by the same file): bare pass-throughs such as
  `contact-requests/api.ts`'s `export { isPendingPairViolation, … };`,
  `hands/cloud-hands.ts`'s `export { DeskError as HandsError, … };` and
  `agents/tool-loop.ts`'s `export { ChatCompletionError, … };`. They are the same
  pattern and can be a follow-up if wanted.

### Round

- Fixed finding 1 (should-fix): `routines/access.ts` and `routines/api.ts` now import
  and call `getTopic` directly; the `getTopic as findTopicById` local alias is gone,
  and no `findTopicById` remains in `apps/server/src`.
- Finding 2 is a recorded follow-up (bare no-`from` pass-throughs), not a should-fix,
  so it was left unchanged as before.
- Tests: no behaviour changed, so no new test; ran
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/topic-routines.test.ts src/routines/mine.test.ts`
  — 2 files, 4 tests passed.
- `pnpm gate` — `GATE PASS` (install, format, lint, typecheck, effect, build
  @zilar/server, tests @zilar/server; scope clean).



## Review (written by Claude)

Approved; the pre-review was clean after one autofix round. That round dropped a local import alias (`getTopic as findTopicById`) and one bare pass-through export.

Net −259 across 129 files, import and export lines only. Every pass-through re-export outside `auth/`, tests and `index.ts` is gone, and each importer now names the module that defines the name. None was kept.

1 nit: three bare `export { X };` pass-throughs without `from` remain (`contact-requests/api.ts`, `hands/cloud-hands.ts`, `agents/tool-loop.ts`). They are left for a later sweep.

**Comments:** the only comment change updates a test's module path (`./service` → `./delivery`).

**Checks:** the gate ran the server tests (23 test files changed import paths). The lead runs the route probe after the push.
