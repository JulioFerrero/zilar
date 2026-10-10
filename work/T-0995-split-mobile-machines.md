---
id: T-0995
title: "Size split T41: apps/mobile/src/app/settings/machines.tsx (717 lines) into components/machines/{mutations,use-machines-list,machines-header,pending-machines,approved-machines,revoked-machines,machine-card,add-machine-sheet}"
status: merged
milestone: M5
branch: task/T-0995-split-mobile-machines
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0995: Split the mobile machines screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/machines.tsx` is 717 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #37 (task T41). The eight new files go in `apps/mobile/src/components/machines/`:
- `mutations.ts`, `use-machines-list.ts`;
- `machines-header.tsx`, `pending-machines.tsx`, `approved-machines.tsx`, `revoked-machines.tsx`, `machine-card.tsx`, `add-machine-sheet.tsx`.

The screen keeps the header, the ScrollView, the ConfirmDialog and its default export.

- **Existing files:** the folder already holds `errors.ts`, `machine-change.ts`, `machines-mock.ts` and `use-machines-api.ts`. Leave them as they are.
- **In scope:** the in-file Dedup. `machine-card.tsx` is the one row that all three sections use, with each section's own buttons and texts.
- **Out of scope:** the `row-errors` item, because it crosses files to `connections.tsx`.

The lead runs a phone smoke of `/settings/machines` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #37, and `apps/mobile/src/app/settings/machines.tsx`.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/mutations.ts`, `apps/mobile/src/components/machines/use-machines-list.ts`, `apps/mobile/src/components/machines/machines-header.tsx`, `apps/mobile/src/components/machines/pending-machines.tsx`, `apps/mobile/src/components/machines/approved-machines.tsx`, `apps/mobile/src/components/machines/revoked-machines.tsx`, `apps/mobile/src/components/machines/machine-card.tsx`, `apps/mobile/src/components/machines/add-machine-sheet.tsx`, `work/T-0995-split-mobile-machines.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/app/settings/machines.tsx` (717 lines, main) per `docs/audit/size-plan.md`
§2.2 #37 (T41) and `docs/audit/split-rules.md`. No behaviour change: the code was moved unchanged
into the eight new files; imports were only adjusted to the new paths. The one in-scope **Dedup**
was applied — `machine-card.tsx` is the single row that all three sections (pending / approved /
revoked) reuse, each passing its own buttons and texts. The **`row-errors` dedup is out of scope**
per the spec ("crosses files to `connections.tsx`"), so `setRowError` / `clearRowError` stay inside
`use-machines-list.ts` as before.

The screen keeps the header, the `ScrollView`, the `ConfirmDialog` and its `default` export. It now
calls `useMachinesList()` for state and handlers, renders `MachinesHeader`, the section components,
`AddMachineSheet` and `ConfirmDialog`. The header/title bar JSX (plan 320–337) is the
`machines-header.tsx` component the screen renders; `use-machines-list.ts` holds the whole
`MachinesList` body (state + handlers + derived lists).

### Files changed

- `apps/mobile/src/app/settings/machines.tsx` (modified — screen)
- `apps/mobile/src/components/machines/mutations.ts` (new)
- `apps/mobile/src/components/machines/use-machines-list.ts` (new)
- `apps/mobile/src/components/machines/machines-header.tsx` (new)
- `apps/mobile/src/components/machines/pending-machines.tsx` (new)
- `apps/mobile/src/components/machines/approved-machines.tsx` (new)
- `apps/mobile/src/components/machines/revoked-machines.tsx` (new)
- `apps/mobile/src/components/machines/machine-card.tsx` (new)
- `apps/mobile/src/components/machines/add-machine-sheet.tsx` (new)
- `work/T-0995-split-mobile-machines.md` (this report)

Existing `components/machines/{errors.ts,machine-change.ts,machines-mock.ts,use-machines-api.ts}`
were left untouched.

### `wc -l` (old = `git show main:…`, new = working tree)

| file | lines |
| --- | --- |
| old `apps/mobile/src/app/settings/machines.tsx` | 717 |
| new `apps/mobile/src/app/settings/machines.tsx` | 172 |
| `components/machines/mutations.ts` | 71 |
| `components/machines/use-machines-list.ts` | 270 |
| `components/machines/machines-header.tsx` | 38 |
| `components/machines/pending-machines.tsx` | 60 |
| `components/machines/approved-machines.tsx` | 109 |
| `components/machines/revoked-machines.tsx` | 71 |
| `components/machines/machine-card.tsx` | 40 |
| `components/machines/add-machine-sheet.tsx` | 133 |

Every new file and the screen are well under 400 lines.

### Export list before / after

Before (`main`, old file) — the only export:

```
107:export default function MachinesScreen()
```

After — `apps/mobile/src/app/settings/machines.tsx` still exports the same single `default` name and
kind, so no importer changes:

```
apps/mobile/src/app/settings/machines.tsx:23:export default function MachinesScreen()
```

New names introduced by the split (none existed before; nothing was removed):

```
components/machines/mutations.ts:  MachineCallFailed, MachineChange, MachineMutation, call, mutationCall, applyChange
components/machines/use-machines-list.ts:  useMachinesList
components/machines/machines-header.tsx:   MachinesHeader
components/machines/pending-machines.tsx:  PendingMachines
components/machines/approved-machines.tsx: ApprovedMachines
components/machines/revoked-machines.tsx:  RevokedMachines
components/machines/machine-card.tsx:      MachineCard
components/machines/add-machine-sheet.tsx: AddMachineSheet
```

### Effect ratchet

- `mutations.ts`, `use-machines-list.ts`, `add-machine-sheet.tsx` import `effect` (value) → `effect`.
- `machines-header.tsx`, `machine-card.tsx`, `pending-machines.tsx`, `approved-machines.tsx`,
  `revoked-machines.tsx` and the screen are plain JSX with no signal → `plain`. No `// effect-plain:`
  marker was needed. `gate` step `effect` passed.

### Commands run and real results

- `pnpm install` → done in 33.3s; reused store, warnings only (unmet peer `@types/react-dom` wants
  `@types/react@^19.3.0`, found 19.2.18 — pre-existing).
- `pnpm --filter @zilar/mobile typecheck` → passed, no diagnostics.
- `pnpm gate` → exit 0, summary:

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.9s)
PASS  lint  (1.2s)
PASS  typecheck  (3.8s)
PASS  effect  (1.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test files were run: `gate` reported `SKIP tests @zilar/mobile (no nearby test files)`, and
this is a UI-only move (AGENTS.md: UI gets no tests).

### Deviations / notes

- The hook exposes a few thin bound callbacks that did not exist verbatim in the old file
  (`askRevoke`, `askDelete`, `cancelRename`, `cancelConfirm`, `toggleRevoked`) so each section gets a
  clean prop; each one only calls the moved handler (`askConfirm('revoke'|'delete', id)`,
  `setRenamingId(null)`, `setConfirming(null)`, `setShowRevoked(v => !v)`). No logic changed.
- `PageStatus` moves into `use-machines-list.ts` (its only user).
- Section components render only their block; the screen keeps the `status === 'ready' && …length > 0`
  guards, so the rendered output is identical.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `settings/machines.tsx` (717 lines) is now 172 lines, plus eight files in `components/machines/`, the largest `use-machines-list.ts` at 270. One `machine-card` serves all three sections.
- **The lead's phone smoke** (mock build, `/settings/machines`):
  - "Waiting for approval" shows Laptop with Approve and Deny, "Your machines" shows Home server with Rename and Revoke, and Revoked (1) shows;
  - Approve moves Laptop into Your machines;
  - Revoked expands to "Old box" with Delete.
- **Check:** the gate passed.
