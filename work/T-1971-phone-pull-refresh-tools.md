---
id: T-1971
title: "Phone parity: pull to refresh on Connections, Machines, Integrations and Notifications (shell gets an onRefresh prop)"
status: merged
milestone: M5
branch: task/T-1971-phone-pull-refresh-tools
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1969]
estimate: 30 min
---

# T-1971: Pull to refresh on the tools settings lists (phone)

## Spec (written by Claude, do not edit)

### Why
Julio chose this on 2026-10-18 from the Telegram/WhatsApp gaps in `docs/audit/ui-consistency.md` §6 (item 1). It is the second half of T-1970. It waits for T-1969, because both tasks change `components/settings/screen-shell.tsx`.

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/`)
- **The pattern to copy:** `app/settings/approvals.tsx:73-84`, which is a `RefreshControl` with `tintColor={MUTED_FOREGROUND}`.
- **`app/settings/connections.tsx`:** it gets `reload` from its data hook (`:57`) and has its own `ScrollView` at `:110`.
- **`app/settings/machines.tsx`:** it gets `reload` (`:58`) and has a `ScrollView` at `:84`.
- **`app/settings/integrations.tsx`:** it renders through `SettingsScreenShell`, and `reload` is a `useCallback` at `:91`.
- **`app/settings/notifications.tsx`:** it renders through `SettingsScreenShell`, and `load` is a `useCallback` at `:130`. The file is at 388 lines.
- **`components/settings/screen-shell.tsx`:** its `ScrollView` is at about `:35`. After T-1969 it also takes `tabName`.

### Steps
1. **The shell.** In `components/settings/screen-shell.tsx`, add an optional `onRefresh?: () => void | Promise<unknown>`. When it is set, the `ScrollView` gets a `RefreshControl` that shows while the refresh runs and always stops, failure included.
   - If `onRefresh` returns nothing, stop after the next render or after a short timeout (at most 800 ms). Say which one you chose in the Report.
2. **Integrations and Notifications.** In `integrations.tsx` and `notifications.tsx`, pass `onRefresh={reload}` and `onRefresh={load}`. Notifications must not grow past 400 lines.
3. **Connections and Machines.** In `connections.tsx` and `machines.tsx`, add the `RefreshControl` to their own `ScrollView`, calling `reload`, following the approvals pattern.
4. **No tests** (UI). Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/components/connections/use-connections.ts` (added by the lead, fix round 1)
- `apps/mobile/src/components/machines/use-machines-list.ts` (added by the lead, fix round 1)
- `work/T-1971-phone-pull-refresh-tools.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the emulator (mock), the lead pulls each of the four pages: the spinner shows, the page reloads, and the spinner stops.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `components/settings/screen-shell.tsx`: added the optional `onRefresh` prop. When it is set, the shared `ScrollView` gets a `RefreshControl` (`tintColor={MUTED_FOREGROUND}`). The spinner logic lives in a small exported `usePullToRefresh(onRefresh)` hook so the two screens with their own `ScrollView` share the same behavior: it awaits the returned promise when there is one (and stops on rejection too), and stops on a **600 ms timer** when the callback returns nothing (Integrations and Notifications pass synchronous callbacks).
- `app/settings/integrations.tsx`: passes `onRefresh={reload}`.
- `app/settings/notifications.tsx`: passes a void wrapper that calls `load` (see the deviation below). File is 391 lines, under 400.
- `app/settings/connections.tsx` and `app/settings/machines.tsx`: added `RefreshControl` to their own `ScrollView`, wired with `usePullToRefresh(reload)`, following the approvals pattern.

Files changed (all inside Allowed files): the five source files above plus this task file.

**Fix round 1 (PREREVIEW findings 1 and 2):**

- Finding 2 — keep the list on reload. In `components/connections/use-connections.ts` and `components/machines/use-machines-list.ts`, `reload` now sets `'loading'` only when the page is not already `'ready'` (read from a `statusRef` kept current in an effect, so `reload` keeps its identity and the focus effect does not loop). A reload over a ready list keeps the rows and swaps in the new data on success. A failed background reload keeps the rows, sets `errorInfo`, and the screen shows it as a red `role="alert"` banner above the list instead of blanking the page; the banner is cleared when the next load starts. `reload` returns a promise that settles when its load ends: the load effect receives an Effect `Deferred` and completes it in `ensuring`, so the promise resolves on success, failure, interruption by the newer load, and unmount. `{ mode: 'replace' }` and the "latest reload wins" comment are unchanged.
- Finding 1 — sync throw. `usePullToRefresh` now calls `onRefresh()` inside `try`/`catch`: on a synchronous throw it runs `stop()` (clears the timer, resets `active` and `refreshing`) and rethrows, so the spinner cannot stay pinned and later pulls are not ignored.

### Checks run

- `pnpm install` — done (18.7s, lockfile unchanged).
- No single test files were run by hand: the change is UI only. I did not open an emulator, so the pull gesture itself is untested by me; the lead's phone smoke covers the acceptance.
- `pnpm gate` at the end of fix round 1 (both items) — exit 0, summary:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- `pnpm gate` after fix round 1, item 1 — exit 0, summary:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- The first `pnpm gate` (before fix round 1) — exit 0, summary:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.0s)
PASS  effect  (0.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation in notifications:** `onRefresh={load}` did not typecheck, because `load` is also a `useFocusEffect` callback and returns its cleanup (`() => void`), not `void | Promise<unknown>`. I kept the shell's type as specified and passed a wrapper with a block body instead (`onRefresh={() => { load(); }}`), which discards the cleanup.
- **Fallback choice:** when `onRefresh` returns nothing, the spinner stops after a 600 ms timer (the spec allows up to 800 ms). Both the shell and the two own-`ScrollView` screens use the same hook and duration.
- **Effect ratchet:** the 600 ms timer made `screen-shell.tsx` `needs-effect`, so I added the standard `// effect-plain:` marker first line with the reason "the settings shell owns no I/O; the pull spinner is a local UI timer over callbacks the screens own." No check was disabled; the gate's `effect` check passes.
- The earlier background note is fixed in round 1: Connections and Machines keep their lists on pull, and their pull spinner stops when `reload`'s promise settles rather than on the 600 ms fallback. Integrations and Notifications still use the fallback because their callbacks return nothing.
- No tests were added, as the spec asks.


## Review (written by Claude)

**Approved and merged after one lead fix round.** The second pre-review was clean.

**Fix round 1:**
- a reload over a ready list now keeps the list, so neither a pull nor a focus reload blanks Connections or Machines;
- `reload` returns a promise that settles when the load ends;
- the pull spinner stops when `onRefresh` throws synchronously.

**Emulator check** (mock build of `2655b5624`):
- **During a pull:** on `/settings/connections` and `/settings/machines` the spinner shows over the list, and the list stays visible.
- **3 s later:** the spinner is gone and the list is unchanged.
