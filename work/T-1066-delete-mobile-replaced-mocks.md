---
id: T-1066
title: "Mock sweep M2+R2 (mobile): delete the seven old mocks the H2 adapters replaced (ais, ai-memory, audit, tools, approvals, machines-mock, connections-mock)"
status: merged
milestone: M5
branch: task/T-1066-delete-mobile-replaced-mocks
model: auto
effort: default
depends_on: [T-1063, T-1064]
estimate: 0.1 day
---

# T-1066: Delete the replaced mobile mocks

## Spec (written by Claude, do not edit)

### Why
T-1061, T-1063 and T-1064 moved six mobile hooks onto `@zilar/mock-backend`: approvals, AIs, AI memory, audit, tools, machines and connections. The lead checked with grep on main (2026-10-11) that these old mocks have no importers left in `apps/mobile/src`, `app` or `test`:

| File | Lines |
| --- | ---: |
| `apps/mobile/src/mock/ais.ts` | 251 |
| `apps/mobile/src/mock/ai-memory.ts` | 38 |
| `apps/mobile/src/mock/audit.ts` | 83 |
| `apps/mobile/src/mock/tools.ts` | 369 |
| `apps/mobile/src/mock/approvals.ts` | 129 |
| `apps/mobile/src/components/machines/machines-mock.ts` | 172 |
| `apps/mobile/src/components/connections/connections-mock.ts` | 130 |

That is 1,172 lines in total.

### What to build
1. **Check before deleting each file:** `grep -rn` its module name across `apps/mobile`, including `import(` / `require(` / `typeof import(` forms and test files. If anything still imports a file, keep it and say so in the Report.
2. **Delete the seven files.** Doc comments elsewhere that mention a deleted file by name may stay, or be reworded to name the shared backend. Do not change any code.
3. **No other change.** If typecheck or lint fails, stop and report instead of rewriting code.

The lead runs a phone smoke in mock mode: the AIs tab, an AI's page, and Settings › Approvals.

### Read first
`AGENTS.md`, and `docs/audit/mock-sweep-status.md` §4.

### Allowed files
`apps/mobile/src/mock/ais.ts`, `apps/mobile/src/mock/ai-memory.ts`, `apps/mobile/src/mock/audit.ts`, `apps/mobile/src/mock/tools.ts`, `apps/mobile/src/mock/approvals.ts`, `apps/mobile/src/components/machines/machines-mock.ts`, `apps/mobile/src/components/connections/connections-mock.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/integrations/integrations-mock.ts`, `work/T-1066-delete-mobile-replaced-mocks.md`.

(`stickers-mock.ts` and `integrations-mock.ts` are listed only so their doc comments that name `machines-mock`/`connections-mock` may be reworded. Do not delete them, and do not change their code.)

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report shows each file's grep, run before its deletion.

---

## Report (written by the worker when done)

### What I did

1. Ran `pnpm install` in the worktree: `Done in 10.4s using pnpm v10.32.1` (peer-dep warning for `@types/react-dom` on mobile, pre-existing).
2. Grepped each of the seven modules across `apps/mobile` before deleting, including `import(`/`require(`/`typeof import(` forms (quote-terminated module specifiers, so dynamic forms are covered) and test files. Per file:
   - `mock/ais` (`./ais`): **no matches**.
   - `mock/ai-memory` (`./ai-memory`): **no matches**.
   - `mock/audit` (`./audit`): **no matches**.
   - `mock/tools` (`./tools`): **no matches**.
   - `mock/approvals` (`./approvals`): **no matches**.
   - `machines-mock`: one match, a doc comment in `components/stickers/stickers-mock.ts:13` (not an import).
   - `connections-mock`: one match, a doc comment in `components/integrations/integrations-mock.ts:12` (not an import).
   - A repo-wide re-grep after deletion found references only in docs and other task files (`docs/audit/*.md`, `work/T-*.md`), never in importable code.
3. Confirmed the seven files were tracked and totalled 1,172 lines (matching the spec), then removed them with `git rm`:
   `mock/ais.ts` (251), `mock/ai-memory.ts` (38), `mock/audit.ts` (83), `mock/tools.ts` (369), `mock/approvals.ts` (129), `components/machines/machines-mock.ts` (172), `components/connections/connections-mock.ts` (130).
4. Reworded the two now-dangling doc comments that named deleted files (comments only, no code change):
   - `components/stickers/stickers-mock.ts`: dropped the `components/machines/machines-mock.ts` name.
   - `components/integrations/integrations-mock.ts`: dropped the `components/connections/connections-mock.ts` name.

### Files changed

- Deleted: the seven files above.
- Edited (comment only): `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/integrations/integrations-mock.ts`.
- Edited: `work/T-1066-delete-mobile-replaced-mocks.md` (status + this Report).

### Commands and results

- `pnpm install`: Done, 10.4s.
- Greps above: as listed (no importers).
- `pnpm gate` (from repo root), real output summary:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.7s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single tests run while working: none (deletion-only change; gate skipped mobile as there are no nearby test files).

### Deviations / problems

- None. The two comment rewordings are explicitly allowed by the spec and touch no code.
- Tests `@zilar/mobile` was SKIPped by the gate (no nearby test files), not failed.

### Blocked / needs a decision

- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** deleted the seven old mobile mocks the H2 adapters replaced: `mock/{ais,ai-memory,audit,tools,approvals}.ts`, `components/machines/machines-mock.ts` and `components/connections/connections-mock.ts`. In total, 1,176 lines removed.
  - Two doc comments, in `stickers-mock.ts` and `integrations-mock.ts`, no longer name the deleted files.
  - No code changed.
- **What the lead checked:** with grep on main before the spec, none of the seven had an importer.
- **The lead's phone smoke** (mock):
  - **the AIs tab** lists Dev-1, QA-1 and Marketing AI;
  - **Dev-1's page** shows the backend persona and the connection keys;
  - **Settings › Approvals** loads;
  - **Settings › Machines** shows office-linux waiting for approval, dev-mac with Rename and Revoke, and "Revoked (1)".
- **Check:** the gate passed.
