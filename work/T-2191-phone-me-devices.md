---
id: T-2191
title: "Phone: Me loads through useFocusList, Devices passes its refresh to the shell's pull-to-refresh; no behaviour change"
status: merged
milestone: M5
branch: task/T-2191-phone-me-devices
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2191: Me and Devices use the shared load and refresh

## Spec (written by Claude, do not edit)

### Why
T-2186 and T-2189 gave phone screens one load-on-focus hook (`useFocusList`) and one screen shell (`SettingsScreenShell`). Two screens still repeat what those already do.

### Facts (the lead read these on 2026-10-19)
1. `apps/mobile/src/app/me.tsx:54-84`: `status` state, a `load` callback that runs `Effect.all([fromApi(() => api.getMe()), sessionTokenEffect])` with `Effect.runFork`, and a `useFocusEffect` that calls it. Its rules:
   - a reload over a ready screen keeps it;
   - a failure shows the error only when nothing is on screen.

   The screen reads `status` at `:210-218`, and the photo actions update `profile` with `setProfile`.
2. `useFocusList(load)` in `apps/mobile/src/components/settings/use-focus-list.ts` holds exactly that load rule, and returns `data`, `setData`, `status`, `error`, `refreshing` and `refresh`.
3. `apps/mobile/src/app/settings/devices.tsx:50-92`: a `refreshing` state and a hand-built `RefreshControl` passed as `refreshControl` to `SettingsScreenShell`. `SettingsScreenShell`'s `onRefresh` already accepts `() => void | Promise<unknown>` and runs its own spinner (`usePullToRefresh` in `apps/mobile/src/components/settings/screen-shell.tsx:21`).

### Steps
1. `me.tsx`:
   - load `{ me, token }` with `useFocusList`, keeping the same two calls in parallel;
   - read `profile` and `token` from its `data`, and use `setData` where the photo actions now call `setProfile`;
   - keep the loading, error and ready views and their texts;
   - do not touch the photo flow (`staged`, `photoError`, `runPhoto`).
2. `devices.tsx`: delete the `refreshing` state and the hand-built `RefreshControl`, and pass `onRefresh={refresh}` to `SettingsScreenShell`. Drop the imports that become unused.
3. Change no behaviour or text. No new tests.
4. Report the line counts per file.

### Allowed files
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/settings/devices.tsx`
- `work/T-2191-phone-me-devices.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Phone emulator, mock mode, checked by the lead: Me loads and shows the profile; Devices loads, and pull-to-refresh works.
- Product lines are at least 15 lower.

---

## Report (written by the worker when done)

### What changed
- `apps/mobile/src/app/me.tsx` (467 → 457 lines, −10): the screen now loads `{ me, token }` through `useFocusList`, keeping the two existing calls in parallel and mapping the pair to `{ me, token }`. `profile` and `token` come from `data`; the avatar save/remove actions update `data.me` with `setData`; Retry calls `reload`. Loading, error and ready views and their texts are unchanged. `staged`, `photoError` and `runPhoto` are untouched.
- `apps/mobile/src/app/settings/devices.tsx` (239 → 229 lines, −10): removed the local `refreshing` state and the hand-built `RefreshControl`, and passed `onRefresh={refresh}` to `SettingsScreenShell`; dropped the now-unused `RefreshControl` and `MUTED_FOREGROUND` imports. The focus reload and all copy/layout are unchanged.
- No behaviour or text changes; no new tests (UI change only).

### Commands run
- `pnpm install`: completed with no output/errors.
- `pnpm gate`: `GATE PASS`.
  - `gate: 3 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP build @zilar/server`, `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration` and `images` checks passed.
  - `WARN size: apps/mobile/src/app/me.tsx: 457 lines (main 467)` — under the 800 hard limit.
  - `comments: no task IDs in added comments`

### Deviations / notes
- None from the spec. `useFocusList` owns the focus-triggered reload, so the old `useFocusEffect` in `me.tsx` was removed with the duplicated load rule.
- Not run by me: phone emulator mock-mode smoke (acceptance leaves it to the lead).

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −20.

**Me** loads `{ me, token }` through `useFocusList`; the photo actions update it with `setData`, and the photo flow is untouched.

**Devices** passes `refresh` to the shell's `onRefresh` instead of its own spinner state and `RefreshControl`.

**Phone emulator smoke passed:** Me shows the profile. Devices loads, and a pull-to-refresh keeps the list on screen.
