---
id: T-1006
title: "Size split T79: apps/mobile/src/app/settings/connections.tsx (519 lines) into components/connections/{use-connections,connections-header,connection-card,add-connection-form}"
status: merged
milestone: M5
branch: task/T-1006-split-mobile-connections
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1006: Split the mobile connections screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/connections.tsx` is 519 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #75 (task T79). The four new files go in `apps/mobile/src/components/connections/`:
- `use-connections.ts`;
- `connections-header.tsx`, `connection-card.tsx`, `add-connection-form.tsx`.

The screen keeps the ScrollView, the status and empty states, and its default export.

- **In scope:** the in-file part of the Dedup. `connection-card.tsx` replaces the inline provider-row copies.
- **Out of scope:** `row-errors.ts`, because it crosses files.
- **Existing files:** the folder already holds `connections-mock.ts`, `errors.ts`, `save-connection.ts` and `use-connections-api.ts`. Leave them as they are.
- **Same behaviour:** the provider API key field must keep never showing a saved key.

The lead runs a phone smoke of `/settings/connections` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #75, and `apps/mobile/src/app/settings/connections.tsx`.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/connections/use-connections.ts`, `apps/mobile/src/components/connections/connections-header.tsx`, `apps/mobile/src/components/connections/connection-card.tsx`, `apps/mobile/src/components/connections/add-connection-form.tsx`, `work/T-1006-split-mobile-connections.md`.

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

Split `apps/mobile/src/app/settings/connections.tsx` (519 lines) per `docs/audit/size-plan.md` §2.3 #75, following `docs/audit/split-rules.md`:

- `components/connections/use-connections.ts`: the `useConnections()` hook with all screen state (`connections`, `status`, `errorInfo`, `showForm`, `testingId`, `testResults`, `testErrors`, `confirmingId`, `removeError`, `busy`) and the three `useAction` effects (`load`/`reload`, `runTest`, `removeConnection`) plus `askRemove`/`cancelRemove`. Code moved unchanged from lines 60–178.
- `components/connections/connections-header.tsx`: `ConnectionsHeader` top bar (back, title, Add button), moved unchanged from lines 182–199.
- `components/connections/connection-card.tsx`: `ConnectionCard` renders one provider row, either the normal Test/Remove view or the inline Remove confirm. Moved unchanged from lines 244–327, with the row moved out of the `.map` so it is a single component (the in-scope part of the entry's Dedup).
- `components/connections/add-connection-form.tsx`: `AddConnectionForm` (provider picker + write-only key field), moved unchanged from lines 350–518. `PROVIDERS` (lines 28–36) moved here because only this form used it.
- `apps/mobile/src/app/settings/connections.tsx`: the screen keeps `SafeAreaView`, `ConnectionsHeader`, the `ScrollView`, the status/empty states and the default export. It reads state/handlers from `useConnections()` and renders `ConnectionCard`/`AddConnectionForm`.

The screen's only export was the default; the barrel keeps that exact name and kind, so no importer changes. `row-errors.ts` and the save/API/mock/errors files were left untouched (out of scope). The API key field still never shows a saved key: `AddConnectionForm` keeps the unchanged `keyAfterSave`/write-only logic.

### Commands run and results

- `pnpm install`: done in 15.7s (peer warning about `@types/react-dom` 19.3.0 vs `@types/react` 19.2.18, pre-existing).
- `pnpm gate` (repo root): `GATE PASS` — see below. Mobile tests skipped (`SKIP tests @zilar/mobile (no nearby test files)`); no test files were run by hand (the change is UI).

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (4.0s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 6 changed files are the 5 allowed source files plus this task file.

### wc -l (old vs new)

| file | lines |
| --- | --- |
| `apps/mobile/src/app/settings/connections.tsx` (old, `git show HEAD`) | 519 |
| `apps/mobile/src/app/settings/connections.tsx` (new barrel) | 137 |
| `use-connections.ts` | 164 |
| `connections-header.tsx` | 38 |
| `connection-card.tsx` | 118 |
| `add-connection-form.tsx` | 195 |

Every file is at most 400 lines. No `// effect-plain:` marker was needed: the gate's `effect` step reported PASS, and the two files that use Effect classify as `effect` while the three UI/barrel files carry no signals.

### Export list before/after (`grep -E "^export"`)

Old (`apps/mobile/src/app/settings/connections.tsx`):
```
export default function ConnectionsScreen() {
```

New (barrel + new files):
```
apps/mobile/src/app/settings/connections.tsx:export default function ConnectionsScreen() {
apps/mobile/src/components/connections/use-connections.ts:export function useConnections() {
apps/mobile/src/components/connections/connections-header.tsx:export function ConnectionsHeader({
apps/mobile/src/components/connections/connection-card.tsx:export function ConnectionCard({
apps/mobile/src/components/connections/add-connection-form.tsx:export function AddConnectionForm({
```

The old file's default export is unchanged; the four new files add the new named exports.

### Problems / deviations

- `ConnectionCard` takes `busy`, `testing`, `works`, `testError` and the row-level handlers instead of reading the hook directly, so it stays a presentational component and the screen wires the hook to it. Behaviour is the same.
- The redundant per-row `key` that used to sit on the two inline `<View>`s now lives on `<ConnectionCard key={connection.id} … />`; the component root itself is unkeyed.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `settings/connections.tsx` (519 lines) becomes the screen plus `components/connections/{use-connections,connections-header,connection-card,add-connection-form}`, the largest `add-connection-form.tsx` at 195.
- **The lead's phone smoke** (mock build, `/settings/connections`):
  - OpenAI (Work) and Anthropic (Personal) list as active, each with Test and Remove;
  - + opens "New connection" with seven providers, and an empty API key field ("Paste your key");
  - Test on Anthropic shows "Key works".
- **Check:** the gate passed.
