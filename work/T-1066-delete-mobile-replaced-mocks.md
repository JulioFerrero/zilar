---
id: T-1066
title: "Mock sweep M2+R2 (mobile): delete the seven old mocks the H2 adapters replaced (ais, ai-memory, audit, tools, approvals, machines-mock, connections-mock)"
status: todo
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

## Review (written by Claude)
