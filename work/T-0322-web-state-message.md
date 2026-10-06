---
id: T-0322
title: "Web kit migration: AIs, Connections and Machines pages use StateMessage for loading, error and empty"
status: todo
milestone: M5
branch: task/T-0322-web-state-message
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0322: page states on the kit StateMessage

## Spec (written by Claude, do not edit)

### Why
The kit `StateMessage` (`apps/web/src/components/ui/state-message.tsx`) is the one centred empty, loading or error block. Three settings pages still hand-roll all three states, each slightly differently. This task moves them to the kit.

### Verified facts (do not re-derive)
- **`StateMessage`:**
  - props: `kind: 'empty' | 'loading' | 'error'`, `title`, `hint?` and `action?: { label, onClick }`;
  - roles: `role="alert"` for error, `role="status"` for loading, none for empty;
  - icons: `Inbox` for empty, `CircleAlert` for error, a spinning `Loader2` for loading. There is no way to choose another icon.
  - Users today: `routes/RequestsPage.tsx`, `routes/BlockedPage.tsx` and `routes/FoldersPage.tsx`.
- **`apps/web/src/routes/AisPage.tsx`:**
  - line 97: loading, `<p>Loading…</p>`;
  - lines 99-108: error, a `<p role="alert">{errorMessage}</p>` and a Retry button (`retry`);
  - lines 110-125: empty, with the `Zap` icon, "You have no AIs yet. Create one to give it a chat account and a budget." and the "Create an AI" button (`setCreating(true)`).
- **`apps/web/src/routes/ConnectionsPage.tsx`:**
  - line 126: loading;
  - lines 128-144: error, with `role="alert"` and a Retry that runs `setStatus('loading'); void reload();`;
  - lines 146-154: empty, with the `Link` icon, "No provider connections yet" and "Add a connection" (`setShowForm(true)`).
- **`apps/web/src/routes/MachinesPage.tsx`:**
  - line 281: loading is `<MachineListSkeleton />`. **Keep it.**
  - lines 283-290: error, `<FieldError>{errorMessage}</FieldError>` plus Retry;
  - lines 294-308: empty, with the `Server` icon, "No machines yet. Add one to let your AIs work on your own computers." and "Add machine" (`setAdding(true)`).
- **Tests that read these states** (they must pass unchanged):
  - `apps/web/src/components/ais/AisPage.test.tsx`: `getByText('Loading…')` at line 120, `/You have no AIs yet/`, the "Create an AI" button, and `getByRole('alert').textContent` containing the error;
  - `apps/web/src/routes/ConnectionsPage.test.tsx`: `'No provider connections yet'` (exact), and the alert containing the error;
  - `apps/web/src/routes/MachinesPage.test.tsx`: `/No machines yet/`, the alert containing the error, and a `Retry` button.

### What to build
1. **`StateMessage`:** add an optional `icon?: LucideIcon` prop (type import from `lucide-react`).
   - It replaces the default icon for `empty` and `error`; `loading` always shows the spinner.
   - Add a test in `apps/web/src/components/ui/kit.test.tsx`: a custom icon renders instead of `Inbox`.
2. **AisPage:**
   - loading: `<StateMessage kind="loading" title="Loading…" />`;
   - error: `<StateMessage kind="error" title={errorMessage} action={{ label: 'Retry', onClick: retry }} />`;
   - empty: `<StateMessage kind="empty" icon={Zap} title="You have no AIs yet." hint="Create one to give it a chat account and a budget." action={{ label: 'Create an AI', onClick: () => setCreating(true) }} />`.
3. **ConnectionsPage:** the same three moves.
   - The Retry action keeps `setStatus('loading'); void reload();`.
   - The empty state is `icon={Link}`, `title="No provider connections yet"` and the "Add a connection" action.
4. **MachinesPage:**
   - error: `StateMessage` with the Retry action;
   - empty: `icon={Server}` and `title="No machines yet."`, with `hint="Add one to let your AIs work on your own computers."` and the "Add machine" action;
   - loading stays `MachineListSkeleton`.
5. Remove imports that become unused (`FieldError` only if nothing else uses it, the icons only if nothing else uses them).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/routes/FoldersPage.tsx` (an existing user), the three pages and the three tests above.

### Allowed files
`apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/MachinesPage.tsx`, `work/T-0322-web-state-message.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit AisPage ConnectionsPage MachinesPage
pnpm gate
```

### Acceptance
- None of the three pages hand-rolls a loading, error or empty block any more (except the Machines skeleton).
- The three page tests pass unchanged, and the new kit test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
