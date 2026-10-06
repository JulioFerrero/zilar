---
id: T-0396
title: "Web kit: the Connections page Test key, Remove connection and form Close icon buttons use the kit Button"
status: merged
milestone: M5
branch: task/T-0396-web-connections-icon-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0396: Connections icon buttons on the kit

## Spec (written by Claude, do not edit)

### Why
These are the last three raw buttons on the Connections page. T-0389 removed the key toggle.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - `ghost` = `hover:bg-surface-raised hover:text-foreground`;
  - sizes `icon` (size-8) and `icon-sm` (size-7);
  - `cn` merges a caller `className`;
  - `Button` is imported in `ConnectionsPage.tsx` (line 5).
- **The three buttons in `apps/web/src/routes/ConnectionsPage.tsx`** (the `<button` lines are 222, 232 and 303):
  - **Test:** `disabled={testingId === connection.id}`, `aria-label`/`title` "Test {provider} key", `onClick={() => void testConnection(connection.id)}`, `className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"`, `<Zap className="size-4" />`.
  - **Remove connection:** `aria-label`/`title` "Remove {provider} connection", onClick `setConfirmingId(connection.id); setRemoveError('');`, `className="rounded-full p-2 … hover:bg-danger/10 hover:text-danger"`, `<Trash2 className="size-4" />`.
  - **Close:** `aria-label="Close"`, `title="Close"`, `onClick={onCancel}`, `className="rounded-full p-1 text-muted-foreground hover:bg-muted"`, `<X className="size-4" />`.
- **Test:** `apps/web/src/routes/ConnectionsPage.test.tsx`. Keep every label, `title`, `disabled` and handler.

### What to build
1. **Test** → `<Button type="button" variant="ghost" size="icon" className="rounded-full text-muted-foreground" …>`.
2. **Remove connection** → the same, with `className="rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger"`.
3. **Close** → `<Button type="button" variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" …>`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and `apps/web/src/routes/ConnectionsPage.tsx`.

### Allowed files
`apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `work/T-0396-web-connections-icon-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in `ConnectionsPage.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the last three hand-rolled `<button>` elements in `ConnectionsPage.tsx` to the kit `Button`:
- Test connection: `<Button type="button" variant="ghost" size="icon" className="rounded-full text-muted-foreground" …>`, keeping `disabled={testingId === connection.id}`, `aria-label`/`title` "Test {provider} key" and `onClick={() => void testConnection(connection.id)}`.
- Remove connection: same `Button` with the danger hover classes in `className` (`rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger`), keeping the labels and `setConfirmingId`/`setRemoveError('')` handler.
- Form Close: `<Button type="button" variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" …>`, keeping `aria-label`/`title` "Close" and `onClick={onCancel}`.

No raw `<button` remains in `ConnectionsPage.tsx` (grep returned no matches). No test changes were needed; `ConnectionsPage.test.tsx` was not modified because all labels/titles stay the same and no new test was required.

### Files changed
- `apps/web/src/routes/ConnectionsPage.tsx`
- `work/T-0396-web-connections-icon-buttons-kit.md`

### Commands and results
- `pnpm install`: Done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConnectionsPage`: 1 test file passed, 11 tests passed.
- `pnpm gate`: exit 0, ended with `GATE PASS`:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
None. Followed the spec exactly.

### Blocked / needs a decision
None.

### Open questions
None.

## Review (written by Claude)

Approved (lead, 2026-10-06). Test key and Remove connection are kit ghost `icon` Buttons (Remove keeps the danger hover), and form Close is ghost `icon-sm`; labels, titles, disabled and handlers kept. No raw button left on the Connections page. Pre-review clean (0 findings).
