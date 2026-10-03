---
id: T-0185
title: Mobile: machines (runners) and model connections screens
status: review
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

Done. Machines and model connections are manageable from the phone, mirroring
web's `MachinesPage`, `ConnectionsPage` and `AiPanel` (machine + connection
pickers).

What I built:
- `apps/mobile/src/lib/machines-api.ts` (+ test): `listMachines`,
  `createPairingCode`, `approveMachine`, `denyMachine`, `revokeMachine`,
  `renameMachine`, `deleteMachine`, `setAiMachine` (PUT
  `/api/ais/:id/machine`, reads `machineId` off the fresh public AI). Same
  boundary-guard + `MachinesApiError(status, code)` pattern as `ais-api.ts`.
- `apps/mobile/src/lib/connections-api.ts` (+ test): `listConnections`,
  `createConnection`, `testConnection`, `deleteConnection`, plus
  `buildCreateConnectionBody` with exactly the server's strict-schema keys.
- `apps/mobile/src/app/settings/machines.tsx`: Pending (Approve / Deny),
  Approved (inline Rename, Revoke with confirm), Revoked collapsed behind
  `Revoked (n)` with Delete + confirm; the add flow shows the pairing code
  big with a Copy button (`expo-clipboard`) and the
  `zilar-runner pair <CODE>` command, plus the honest "runner not published
  yet" line from web. Loading, empty and error states; per-row fixed-sentence
  errors; double-tap guards.
- `apps/mobile/src/app/settings/connections.tsx`: list (provider label via
  the shared `providerLabel`, label, status), add form (provider picker
  chips, secure key entry with show/hide, optional label), Test (shows "Key
  works" or the fixed failure sentence), Delete with inline confirm.
  The key lives only in the form's state and is cleared the moment the save
  resolves; it is never rendered back, logged or stored.
- `apps/mobile/src/components/machines/` and `components/connections/`:
  `use-*-api` hooks (real-or-mock, copied from `use-ais-api.ts`), colocated
  mocks (same scenario pattern as the contacts mock), `errors.ts` mappers
  (fixed plain sentences, mirroring web's machines `errors.ts`).
- `apps/mobile/src/app/ais/[id].tsx`: owner can now pick the provider
  connection (`ProviderPicker`, re-prefills the default model like web) and
  the home machine (`MachinePicker`, new, mirrors web's select including the
  "unavailable" current-value row). Connection/model diffs ride the same
  PATCH as web's `AiPanel`. `machineId` is read tolerantly off the server
  response because mobile's `PublicAi`/`UpdateAiInput` predate T-0091 and
  those files are outside my Allowed files. Also added the missing
  `defaultModelFor` to mobile's `models.ts` (identical to web's).
- Two rows in `settings-items.ts`: Machines (`Server`), Connections
  (`KeyRound`). No `ownerOnly`: web guards both pages with `RequireAuth`
  only (a user manages their own machines/keys), and the mobile hub has no
  such flag concept. The settings hub screen itself does not exist yet
  (T-0181 owns it; only `settings-items.ts` exists), so the rows land when
  the hub does.
- Tests (all in allowed paths): both API modules (verbs, bodies, bearer
  header, error codes, no-session fast fail); both screens (loading, empty,
  error+Retry, rows and actions) via the `requests-screen.test.tsx` static
  render pattern (screens live under `src/app/`, which must hold no test
  files); `machine-picker.test.tsx`; a no-API-key-in-tree test for
  connections. The create wizard already had the connection step; the task's
  "out of scope" line excludes wizard changes beyond the two pickers, so I
  left `new.tsx` untouched.

Files changed: `lib/machines-api.ts`, `lib/connections-api.ts` (+ tests),
`app/settings/machines.tsx`, `app/settings/connections.tsx`,
`components/machines/**` (hook, mock, errors, screen test),
`components/connections/**` (same), `lib/settings-items.ts` (two rows),
`app/ais/[id].tsx` + `components/ais/machine-picker.tsx` (+ test) and
`components/ais/models.ts` (`defaultModelFor` only).

Commands (real results):
- `pnpm install`: ok (10.1s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 machines connections ais`:
  9 files, 93 tests, all passed.
- `pnpm format:check`: pass. `pnpm lint` (oxlint): pass after fixing a
  ref-during-render and a spread-fallback error. `pnpm typecheck`
  (turbo, all 11 packages): pass.
- Note: `npx prettier` is blocked in this environment (needs lead
  approval); used the repo's own `./node_modules/.bin/prettier` instead.

Deviations / notes:
- Web's deny flow asks for confirm; mobile denies immediately (same as the
  contacts Accept/Decline pattern) — Revoke and Delete keep confirms per
  the spec. Say if you want Deny confirmed too.
- The lead tests on the emulator and the phone (per the task's Checks note).

Security checklist: no keys/tokens/codes in logs, errors or rendered trees
(verified by test); no server change; deletes/updates hit owned,
single-id routes; confirms precede revoke/delete; double-tap refs on all
writes; user-facing error text is always a fixed sentence.

## Round 1 (lead review findings, six commits)

1. `T-0185: finding 1 - parse machineId on PublicAi…`: added optional
   `machineId` to `PublicAi` (optional, not required, so `mock/ais.ts` —
   outside Allowed files — still typechecks) and parse it in
   `parsePublicAi` (string kept, missing/non-string → null). The edit
   screen reads `loaded.machineId` directly; the raw-record helper is gone.
   Tests: string kept, missing/non-string → null, picker marks the AI's
   home row selected. Note: `UpdateAiInput` still predates the
   model/connection fields, so the edit screen keeps sending them via a
   local extension type — say if you want that promoted into `ais-api.ts`.
2+3. `T-0185: findings 2 and 3 - home machine state round-trips…`: new
   `components/machines/machine-change.ts` (`applyMachineChange`) — success
   shows the PUT answer, failure restores the previous value; errors go
   through `describeMachinesError`, never `describeAisError`. Tested both
   paths including a 503 with raw text.
4. `T-0185: finding 4 - mappers answer the fallback…`: both `errors.ts`
   `default:` branches return the call-site `fallback`; added fixed
   sentences for `invalid_transition` (machines), `key_unreadable` and
   `connections_unavailable` (connections). New `errors.test.ts` for both
   mappers: unmapped code + raw message → fallback, raw string absent.
5. `T-0185: finding 5 - test and add double-tap guards…`: Test button
   ignores taps while a test is in flight; `openAdd` has an `addBusyRef`
   (each tap mints a code, 10/hour); the `✕` glyph is lucide `X`.
6. `T-0185: finding 6 - extract the connection save…`: new
   `components/connections/save-connection.ts` (`saveConnection` +
   `keyAfterSave`, wired into the form's submit). Tests execute the real
   path with a test-typed key: (a) key sent in the POST body, (b) success →
   field becomes `''` and the created connection carries no key field,
   (c) failure → key kept for retry but absent from error text. No
   `react-test-renderer` (not installed, and no new deps allowed), so the
   executed unit is the handler's async core + the exact field transition
   the submit runs — not a press through a renderer.

Round 1 checks (real results): `pnpm --filter @zilar/mobile test
--maxWorkers=2 machines connections ais` → 13 files, 107 tests, all
passed. `pnpm lint` → pass. `pnpm typecheck` (turbo, 11 packages) → pass.
`pnpm exec prettier --check apps/mobile/src work/T-0185…` → pass (repo-wide
`format:check` flags only the untracked `PREREVIEW.md`, not mine — left
untouched). Used `pnpm exec prettier`, never `npx`. Status stays `review`.
The lead tests on the emulator and the phone.

## Review (written by Claude)
