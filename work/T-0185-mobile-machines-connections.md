---
id: T-0185
title: Mobile: machines (runners) and model connections screens
status: planned
milestone: M5
branch: task/T-0185-mobile-machines-connections
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0185: Mobile: machines (runners) and model connections screens

## Spec (written by Claude, do not edit)

### Why
Web has Settings pages for the machines that host AI desks and for the model provider connections (API keys). The phone has neither. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/MachinesPage.tsx`, `ConnectionsPage.tsx`, `apps/web/src/components/machines/*` (`AddMachineDialog`, `ApprovedMachineCard`, `PendingMachineCard`, `RevokedMachineCard`, `errors.ts`), `apps/web/src/components/ais/ConnectionPicker.tsx`; client functions in `apps/web/src/lib/api.ts`: `listMachines()` (~1093), `approveMachine(id)`, `denyMachine(id)`, `revokeMachine(id)`, `renameMachine(id, name)`, `deleteMachine(id)` (~1101-1125), `listConnections()` (~989), `createConnection(input)` (~1004), `testConnection(id)` (~1024), `deleteConnection(id)` (~1030), `setAiMachine(aiId, machineId)` (~981).
- Server: `apps/server/src/machines/routes.ts` and `apps/server/src/connections/routes.ts`: read for the request and error shapes. An API key is write-only: the server never returns it; the phone must never display, log or store one after sending it.
- Mobile: `apps/mobile/src/lib/ais-api.ts` already lists AIs; `app/ais/[id].tsx` is the AI detail (the machine and connection pickers belong there too if the web AI page has them: mirror `AiPanel`).
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; error text shown to the user is always a fixed plain sentence, never the server's raw message; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes, keys or message text; one row in `settings-items.ts` per settings page (`ownerOnly` where the web page is owner-only).

### What to build
1. `apps/mobile/src/lib/machines-api.ts` and `connections-api.ts` (+ tests) with the functions above.
2. `apps/mobile/src/app/settings/machines.tsx`: sections Pending (Approve / Deny), Approved (Rename, Revoke), Revoked (Delete); confirm before Revoke and Delete; the Add flow shows what web's `AddMachineDialog` shows (the pairing code/command with a Copy button using `expo-clipboard`); empty and error states. Row in `settings-items.ts` ('Machines', lucide `Server`, `ownerOnly` if the web page is).
3. `apps/mobile/src/app/settings/connections.tsx`: list (provider, label, status), Add (provider picker, the API key field is a secure text input, cleared after saving), Test (shows ok or the fixed failure sentence), Delete with confirm. Row 'Connections' (lucide `KeyRound`).
4. In `app/ais/[id].tsx` (and the create wizard if it has the step on web) let the owner pick the machine and the connection exactly as web does.
5. Tests (Vitest): both API modules, both screens (each state and action), a test that the API key is not present in any rendered tree or logged call after saving.

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), `apps/mobile/src/lib/settings-items.ts` (add your row), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/machines-api.ts`, `connections-api.ts` and tests, `apps/mobile/src/app/settings/machines.tsx`, `connections.tsx`, `apps/mobile/src/components/machines/**`, `apps/mobile/src/components/connections/**`, `apps/mobile/src/lib/settings-items.ts` (two rows), `apps/mobile/src/app/ais/[id].tsx` and `apps/mobile/src/components/ais/**` (only the pickers).

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 machines connections ais
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Machines can be approved, denied, renamed, revoked and deleted from the phone; the add flow shows the pairing instructions with Copy.
- Connections can be added, tested and deleted; the API key is never shown again, logged or kept.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Creating the runner itself, the AI creation wizard changes beyond the two pickers.

---

## Report (written by the worker when done)

## Review (written by Claude)
