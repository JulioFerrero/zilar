---
id: T-2146
title: "Server (actions, approvals, card-media, roles, web-tools): fold single-use files back into their only importer where the split was for size or is one concept — fewer imports, exports and repeated types; no behaviour change"
status: merged
milestone: M5
branch: task/T-2146-server-folds-3
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2146: Fold single-use server files (actions, approvals, card-media, roles, web-tools)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. Each fold below removes the import and export lines, and any type or helper the two files both declare.

The lead listed these at `2386ee84d`. Each mover has exactly one production importer, the host; the tests listed import it too.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `actions/policy.ts` (45) | `actions/gateway.ts` (538) | — |
| `approvals/api-reads.ts` (252) | `approvals/api.ts` (354) | approvals/names.test.ts |
| `card-media/sniff.ts` (167) | `card-media/fetch.ts` (427) | — |
| `roles/queries.ts` (150) | `roles/service.ts` (453) | — |
| `web-tools/guarded-fetch-helpers.ts` (82) | `web-tools/guarded-fetch.ts` (359) | — |

All paths are under `apps/server/src/`.

### Steps
For each row, read both files.
1. **Fold** when the mover is a slice of the host's concept (a handler, a parser, a schema or a query helper that only the host uses) or was split out for size:
   - move its code into the host, and carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - delete the mover;
   - remove the now-internal `export`s the host no longer needs;
   - drop declarations that become duplicates.
2. **Chains.** Fold in order. For example, `actions/approval-path.ts` goes into `actions/decisions.ts`, which then goes into `actions/gateway.ts`, only if the result stays within the cap.
3. **Cap.** No host may end above 650 lines; skip a fold that would push it over. Several movers into one host count together.
4. **Skip** a fold when the mover is a separate concept a reader looks for by name, or a worker-thread or process entry loaded by path. Check for `new Worker(`, `import.meta.url` or a file-path string that names the mover before folding it.
5. **Tests.** Update the import path, or the `vi.mock(...)` path, in each listed test; change nothing else in it. No new tests.

### Rules
- No behaviour change: the same SQL, routes, limits, log fields and error strings.
- The diff only moves code, removes import/export lines and removes duplicates. It changes no line of logic.
- Do not touch `apps/server/src/agents/**` or `apps/server/src/auth/**`.
- Product lines go down by at least 20.

### Allowed files
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/policy.ts`
- `apps/server/src/approvals/api-reads.ts`
- `apps/server/src/approvals/api.ts`
- `apps/server/src/approvals/names.test.ts`
- `apps/server/src/card-media/fetch.ts`
- `apps/server/src/card-media/sniff.ts`
- `apps/server/src/roles/queries.ts`
- `apps/server/src/roles/service.ts`
- `apps/server/src/web-tools/guarded-fetch-helpers.ts`
- `apps/server/src/web-tools/guarded-fetch.ts`
- `work/T-2146-server-folds-3.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the server tests it runs.
- Product lines go down by at least 20.
- The Report lists each row: folded (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Folded all five movers into their only production importer. No logic changed; only moved code, merged imports, removed the movers and the exports that became internal. The approvals test import path was updated, nothing else in it.

Per row:

| Row | Result | Net lines saved |
| --- | --- | --- |
| `actions/policy.ts` → `actions/gateway.ts` | folded (582 lines, cap ok) | 1 |
| `approvals/api-reads.ts` → `approvals/api.ts` | folded (586 lines, cap ok) | 20 |
| `card-media/sniff.ts` → `card-media/fetch.ts` | folded (592 lines, cap ok) | 2 |
| `roles/queries.ts` → `roles/service.ts` | folded (601 lines, cap ok) | 2 |
| `web-tools/guarded-fetch-helpers.ts` → `web-tools/guarded-fetch.ts` | folded (431 lines, cap ok) | 10 |

Total product lines: 699 added, 734 deleted, net **-35**. No fold was skipped; none of the movers is referenced via `new Worker(`, `import.meta.url` or a file-path string.

Files changed: the five hosts, the five deleted movers, `approvals/names.test.ts` (import path only) and this task file.

### Checks run

- `pnpm install --frozen-lockfile`: done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/names.test.ts`: 1 file, 2 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/unattended.test.ts src/card-media/fetch.test.ts`: 2 files, 9 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/card-media/strip.test.ts`: 2 files, 27 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/adapters.test.ts src/actions/approval-reuse.test.ts`: 2 files, 21 tests passed.
- `pnpm gate`: GATE PASS. Summary lines:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  The gate also printed soft-limit size warnings for the five hosts (431–601 lines), which are expected from folding and under the task's 650 cap.

### Notes for the lead

- No behaviour change intended: SQL, routes, limits, log fields and error strings are identical.
- `/Users/julio/personal-projects/zilar-T-2146/apps/server/src/approvals/names.test.ts` changed one import path only.
- No open questions.

## Review (written by Claude)

Approved; the pre-review was clean. Net −35, all five rows folded:
- `actions/policy` → `gateway`;
- `approvals/api-reads` → `api`;
- `card-media/sniff` → `fetch`;
- `roles/queries` → `service`;
- `web-tools/guarded-fetch-helpers` → `guarded-fetch`.

Every host stays under 650 lines. No comment was lost (the lead diffed the comment lines). The only test edit is one import path in `approvals/names.test.ts`. The gate ran the server tests. The lead runs the route probe after the push.
