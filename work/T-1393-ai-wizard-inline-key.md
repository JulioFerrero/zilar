---
id: T-1393
title: "Create an AI: when there's no provider key, add one inline in the wizard step (mobile and web) instead of a dead end that says 'Add a provider key in the web app'; the new key is selected and Next works"
status: merged
milestone: M5
branch: task/T-1393-ai-wizard-inline-key
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1393: Inline provider key in the AI wizard

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, sent a screenshot of the mobile **Create an AI** wizard, step 3 of 6, and said: "I don't like this step". With no provider key it only shows the text *"Add a provider key in the web app: menu → Connections"* (`apps/mobile/src/app/ais/new.tsx:271-277`), and **Next** stays disabled (`:213`, `canAdvance`). That text is stale: mobile already has a Connections screen with an add-key form (`apps/mobile/src/app/settings/connections.tsx`; `apps/mobile/src/components/connections/add-connection-form.tsx:31-37`, `AddConnectionForm({ onCancel, onSaved(connection) })`).

**Web isn't much better:** `apps/web/src/components/ais/NewAiDialog.tsx:200-215` says "Add a provider key first, then come back to create an AI", then closes the dialog and navigates to Connections, so the user loses the wizard.

### What to build (both apps, same behaviour)
1. **Mobile, `apps/mobile/src/app/ais/new.tsx` step 3, when `connections.length === 0`:**
   - show one short line, "Add a provider key to continue.", and the existing `AddConnectionForm` **inline** in the step;
   - its `onSaved(connection)`:
     - reloads the list (`reloadConnections`, from `useQuery` at `:69-76`),
     - sets `form.providerConnectionId` to the new connection's id, so **Next** turns on;
   - `onCancel` keeps the user on step 3 with the form closed, showing an "Add a provider key" button that reopens it;
   - remove the stale "in the web app" text;
   - keep `new.tsx` at most 400 lines (it's 374): move the step-3 block into `apps/mobile/src/components/ais/provider-step.tsx` if needed.
2. **Web:**
   - move `AddConnectionForm` (`apps/web/src/routes/ConnectionsPage.tsx:358` to the end of that function) into `apps/web/src/components/connections/AddConnectionForm.tsx`, **unchanged in behaviour**, and import it back into `ConnectionsPage.tsx` (this also shrinks that 471-line file);
   - its `onSaved` should hand back the saved connection (or its id) so callers can select it; update `ConnectionsPage` to match;
   - in `NewAiDialog.tsx`, when `status === 'ready' && connections.length === 0`, show the same line and the form inline instead of leaving the dialog. On save, refetch the connections (the dialog's `useQuery` at `:57`, which may need its reload function) and select the new one.
3. **The add-key flow itself stays as it is:** the same API calls, validation and error texts. No new endpoints. Keys are never logged, and never shown after saving.
4. **Tests:** none (UI). Every file stays at most 400 lines.

### Read first
`AGENTS.md`, the files above, `apps/mobile/src/components/ais/provider-picker.tsx`, `apps/web/src/components/ais/ConnectionPicker.tsx`.

### Allowed files
`apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/components/ais/provider-step.tsx`, `apps/mobile/src/components/ais/provider-picker.tsx`, `apps/mobile/src/components/connections/add-connection-form.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/ais/ConnectionPicker.tsx`, `apps/web/src/components/connections/AddConnectionForm.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `work/T-1393-ai-wizard-inline-key.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's mock smoke on mobile:** with no connections, step 3 shows the inline form; saving a key selects it and enables Next.
- **The same on web:** the New AI dialog keeps the wizard open and selects the new key.

---

## Report (written by the worker when done)

### What I did

**Mobile** (`apps/mobile/src/app/ais/new.tsx`, new `apps/mobile/src/components/ais/provider-step.tsx`)

- Added `ProviderStep`, rendered at step 3. Over the caller's active connections it shows the existing `ProviderPicker`; with none it shows the line "Add a provider key to continue." plus the existing `AddConnectionForm` inline (the form starts open, per the spec's "show ... the form inline").
- `AddConnectionForm.onCancel` closes the form and leaves the user on step 3 with an "Add a provider key" button that reopens it.
- `onSaved(connection)` in `new.tsx` calls `reloadConnections()` and sets `form.providerConnectionId` to the new connection's id, so Next turns on.
- Removed the stale "Add a provider key in the web app: menu → Connections" text. `new.tsx` is 371 lines (was 374); the step-3 block moved into `provider-step.tsx` (45 lines).

**Web** (new `apps/web/src/components/connections/AddConnectionForm.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`)

- Moved `AddConnectionForm` out of `ConnectionsPage.tsx` into the new file, unchanged in behaviour (same provider select, key field, label, error texts and `createConnection` call). `onSaved` now hands back the saved `Connection`; `ConnectionsPage` imports the form and `providerLabel` back and ignores the argument.
- `ConnectionsPage.tsx` is 342 lines (was 471).
- `NewAiDialog.tsx`: `useQuery` now keeps its `refresh` (`refreshConnections`). When `status === 'ready' && connections.length === 0` the dialog shows the same line and the inline form instead of closing and navigating to Connections. On save it hides the form, sets `selectedConnectionId` to the new connection's id and refetches the list; the Create button then appears. On cancel it shows an "Add a provider key" button that reopens the form.

The key is never logged and never rendered back; on web the form is hidden as soon as the save resolves, so the typed key is not left on screen while the refetch runs. No new endpoints.

### Files changed

- `apps/mobile/src/app/ais/new.tsx`
- `apps/mobile/src/components/ais/provider-step.tsx` (new)
- `apps/web/src/components/connections/AddConnectionForm.tsx` (new)
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `work/T-1393-ai-wizard-inline-key.md`

### Commands and real results

- `pnpm install`: `Done in 10.9s` (only a pre-existing peer-dependency warning for `@types/react-dom`).
- `pnpm gate`: `gate: 6 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck (4.4s)`, `PASS effect`; `SKIP tests @zilar/mobile (no nearby test files)`, `SKIP tests @zilar/web (no nearby test files)`; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `GATE PASS`.
- No single test file was run: no test file sits next to the changed UI files (UI gets no tests, per the spec).

### Deviations / notes

- `providerLabel` (and its `PROVIDERS` list) moved with the web form into `AddConnectionForm.tsx` and is imported back by `ConnectionsPage.tsx`, so the provider list stays single-sourced.
- On web, cancelling the inline form keeps the dialog open; only the dialog's own Cancel/backdrop closes it.
- No tests added (UI).

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (1 nit); the packet is current for `0e4311cb`.** Mobile `ProviderStep` and web `NewAiDialog` reuse the existing add-key forms inline and select the saved key; the web form is extracted unchanged (`ConnectionsPage` is now 342 lines). The mock backend has connections, so the empty state is checked on Julio's real account with the next build.
