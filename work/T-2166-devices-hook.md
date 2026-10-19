---
id: T-2166
title: "One Devices view model in client-core for web and phone (list sessions, sign out one, sign out all others); the phone drops its hand-built real/mock API; each app keeps only its markup; no behaviour change"
status: merged
milestone: M5
branch: task/T-2166-devices-hook
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2166: One Devices view model for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The big-cut plan (`docs/audit/big-cut-plan.md`, "UI twins") moves per-screen logic into client-core so each app keeps only its markup. Read at `2044ba9fe`, both Devices screens hold the same logic and the same two error texts:

- **Phone** `apps/mobile/src/app/settings/devices.tsx`:
  - Lines 27–28 hold `LOAD_ERROR` and `SIGN_OUT_ERROR`.
  - Lines 30–78 build a hand-written `DevicesApi` with a real and a mock variant, plus `useDevicesApi`. The shared `useApi(make)` in `apps/mobile/src/lib/use-mockable-api.ts` already does that switch.
  - Lines 97–176 hold the state:
    - sessions, status (loading/ready/error), error, signingOut, refreshing;
    - `load`, which keeps rows on screen when a refresh fails (comment at line 104);
    - `signOutOne`, which drops the row on success and shows `SIGN_OUT_ERROR` on failure;
    - `signOutAll`: `Promise.allSettled`, then the error if any failed, then a reload.
- **Web** `apps/web/src/routes/DevicesPage.tsx`:
  - Lines 17–27 hold the `listSessions`/`revokeSession` wrappers and the same two texts.
  - Lines 30–65 hold the `useQuery` load, `removedIds`, the bulk `useAction` (allSettled, error, reload; comment at line 36) and the error pick.
  - Lines 195–205 hold the per-row revoke action.
- **Phone wrappers:** `listSessions`/`revokeSession` in `apps/mobile/src/lib/auth-api.ts:116-131`; `devices.tsx` is their only caller.
- **Model to follow:** `packages/client-core/src/settings-api.ts` (a `make…Api(call)` port over `ZilarClient`) and `packages/client-core/src/people-search.ts` (a plain React hook).

### Steps
1. **Create `packages/client-core/src/devices.ts`** with three pieces:
   - **The API.** `makeDevicesApi(call)` returns `{ listSessions, revokeSession }` through `client.auth.listSessions()` and `client.auth.revokeSession({ params: { id } })`.
   - **The texts.** The two error texts, exported.
   - **The hook.** `useDevices(api)` returns:
     - `status` ('loading' | 'ready' | 'error') and `sessions`;
     - `current` and `others` (others leave out signed-out rows);
     - `error`, `setError`, `refresh()`;
     - `signOut(id)`, which resolves when done and tracks which ids are busy;
     - `signOutAll()` and `bulkBusy`.
2. **Keep today's rules in the hook:**
   - A refresh with rows on screen keeps them when it fails; only a first load shows `LOAD_ERROR`.
   - A one-row sign-out drops that row on success, or sets `SIGN_OUT_ERROR` and keeps it.
   - Sign out all revokes each other session with `allSettled`, sets `SIGN_OUT_ERROR` if any failed, then reloads.
   - Several rows can sign out at once (web allows it today).
3. **Phone.**
   - Use `useApi(makeDevicesApi)` and `useDevices`.
   - Delete lines 30–78 and the moved state code.
   - Keep the pull-to-refresh, the `useFocusEffect` reload, the `ConfirmDialog` flow (it closes after either outcome), the "Mock data" footer, all texts and the markup.
   - Delete `listSessions`/`revokeSession` from `apps/mobile/src/lib/auth-api.ts` if nothing else uses them.
4. **Web.**
   - Build the API with `makeDevicesApi(callApi)` and use `useDevices`.
   - Keep the inline confirms, the per-row buttons, all texts and the markup.
5. Export the new pieces from `packages/client-core/src/index.ts`.

### Rules
- No behaviour change.
- Never show a token or an IP address. Keep the comment at web line 15 once.
- Keep every "why" comment, once.
- **Tests:** no new tests. The `auth-api` tests must pass unchanged.

### Allowed files
- `packages/client-core/src/devices.ts`
- `packages/client-core/src/index.ts`
- `apps/mobile/src/app/settings/devices.tsx`
- `apps/mobile/src/lib/auth-api.ts`
- `apps/web/src/routes/DevicesPage.tsx`
- `work/T-2166-devices-hook.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`, counting the new file.
- **Lead check:**
  - Web mock (`/settings/devices`): the list, sign out one row, sign out all others.
  - Phone emulator (`/settings/devices`): the same steps.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/devices.ts`:
  - `makeDevicesApi(call)` with `listSessions` and `revokeSession`.
  - `DEVICES_LOAD_ERROR` and `DEVICES_SIGN_OUT_ERROR`.
  - `useDevices(api)` with `status`, `sessions`, `current`, `others`, `error`, `setError`, `refresh`, `signOut`, `signOutAll`, `busyIds` and `bulkBusy`. It keeps today's rules: a failed refresh with rows on screen keeps them, a first load shows the load sentence, one-row sign-out drops the row or keeps it with the sign-out sentence, and sign out all uses `allSettled`, sets the error if any failed, then reloads. Several rows can sign out at once. A focus refresh joins the mount load already in flight, so the phone still makes one request on open.
- Exported the new module from `packages/client-core/src/index.ts`.
- Phone `apps/mobile/src/app/settings/devices.tsx`: removed the hand-written real/mock `DevicesApi` and the moved state; now uses `useApi(makeDevicesApi)` and `useDevices`. Kept pull-to-refresh, the `useFocusEffect` reload, the confirm flow that closes after either outcome, the mock footer and all markup/texts.
- Deleted the now-unused `listSessions`/`revokeSession` wrappers from `apps/mobile/src/lib/auth-api.ts`.
- Web `apps/web/src/routes/DevicesPage.tsx`: uses `makeDevicesApi(callApi)` and `useDevices`; kept the inline confirms, per-row buttons, the token/IP comment and all markup/texts.

Net source lines from `git diff --cached --numstat main` (new file counted):
`apps/mobile/src/app/settings/devices.tsx` +34/-134, `apps/mobile/src/lib/auth-api.ts` +1/-21, `apps/web/src/routes/DevicesPage.tsx` +38/-81, `packages/client-core/src/devices.ts` +140/-0, `packages/client-core/src/index.ts` +1/-0. Product net: **-22 lines** (214 added, 236 deleted). The task file itself is new against `main` and is not product code.

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`: 1 file passed, 7 tests passed.
- `pnpm gate` from the repo root:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`, `PASS tests @zilar/client-core`, `PASS tests @zilar/mobile`, `SKIP tests @zilar/web (no nearby test files)`.
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Notes for the lead

- No new tests, per the spec; the `auth-api` tests pass unchanged.
- `busyIds` is the hook's way to expose which rows are mid sign-out, so the web per-row button can show "Signing out…" like before; the spec named the behaviour but not the field.
- Lead check: web mock `/settings/devices` — list, sign out one row, sign out all others; phone emulator `/settings/devices` — the same steps.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Rebased on T-2163; the worker resolved the `devices.tsx` conflict (main's `SettingsScreenShell` + the new hook).

Net −22. The 140-line `useDevices` hook is now the one place for the list, sign-out and sign-out-all rules. The phone's hand-built real/mock API (`useApi` does that switch) and the two `auth-api` wrappers are gone.

**Web mock**, identical to main at each step: list, confirm one, after one, confirm all, after all. No page errors.

**Phone emulator:**
- The smoke passed.
- Sign out Chrome via the dialog: the row drops.
- After a fresh open, "Sign out all other devices": the dialog, then only this device remains.
