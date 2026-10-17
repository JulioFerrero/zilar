---
id: T-1906
title: "Smooth app task 9a: the six phone settings screens (contacts, integrations, blocked, requests, notifications, devices) refresh silently on focus — the spinner/loading state only shows when there is nothing to show yet, so coming back to a screen never blanks it"
status: merged
milestone: M5
branch: task/T-1906-settings-screens-keep-data
model: auto
effort: default
depends_on: [T-1901]
estimate: 35 min
---

# T-1906: Settings screens keep their content on focus

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §2.6, §4 P7 and §5 task 9** (Julio, 2026-10-17: "every time i enter … loads and then apear … moving all the settings down"). These screens refetch on every focus and first set a loading state, so returning to one (for example from a profile) blanks it or spins, then pops the list back in.

### Facts (read by the lead on 2026-10-17)
Each screen has a loader that starts with `setStatus('loading')` and is called from `useFocusEffect`. Example: `apps/mobile/src/app/settings/contacts.tsx:58-88`, where the `reload` action runs `setStatus('loading'); setError('')`, then `api.listContacts()`, then `setPeople`, `setStatus('ready')`, with an error path setting `setStatus('error')`. The loading state and focus call in each screen (from the plan):
- `apps/mobile/src/app/settings/contacts.tsx:61,86`
- `apps/mobile/src/app/settings/integrations.tsx:84,88`
- `apps/mobile/src/app/settings/blocked.tsx:49,74`
- `apps/mobile/src/app/settings/requests.tsx:57,83`
- `apps/mobile/src/app/settings/notifications.tsx:123,162`
- `apps/mobile/src/app/settings/devices.tsx:127,150`

### Steps
1. **In each of the six loaders,** set `'loading'` only when the screen has no data yet (the first load, or after an error with an empty list). With data shown, keep the current status and data during the refetch, then replace them on success. Use the state each screen already has, such as `people.length > 0`, or `status === 'ready'` read via a ref or the functional `setStatus((s) => (s === 'ready' ? s : 'loading'))` form.
2. **A failed background refresh with data shown** keeps the data and doesn't switch to the full error view. Show nothing extra; the next focus retries. Retry buttons and the first load behave as today.
3. **No other behaviour changes.** Actions (unblock, approve, revoke…) work as now.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/app/settings/devices.tsx`
- `work/T-1906-settings-screens-keep-data.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Returning to any of the six screens** shows its content at once and refreshes it in place, with no spinner and no blank.
- **The first open** still shows the loading state.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

The six settings loaders no longer drop the screen back to the loading state on
a focus refresh when they already have content:

- `contacts.tsx`, `blocked.tsx`, `requests.tsx`: the loader's first step is now
  `setStatus((current) => (current === 'ready' ? current : 'loading'))`, so a
  screen that has settled keeps `'ready'` and its rows while the refetch runs;
  the success handler replaces the rows in place as before. On failure the new
  `if (status === 'ready') return;` keeps the rows and shows no extra error;
  a failure on the first load, or after an error, still sets `'error'` and the
  Retry view.
- `integrations.tsx`: same approach, with `keepContent` captured when the load
  effect is built. A failed background refresh keeps the cards instead of
  switching to the error/forbidden view; `reload` only sets `'loading'` when the
  screen is not already `'ready'`.
- `notifications.tsx`, `devices.tsx`: these loaders are `useCallback`s that keep
  their identity between focuses, so they read the current status from a
  `statusRef` (synced in an effect) and capture `keepContent` at call time; the
  spinner is shown only when the screen has never settled, and a failed
  background refresh is silent. First load, Retry and all row/action behaviour
  are unchanged.

No tests were added (UI-only change, per the spec). No file grew past 400 lines.

### Checks run

`pnpm gate` (repo root) — real output:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (1.2s)
PASS  lint  (1.1s)
PASS  typecheck  (1.4s)
PASS  effect  (0.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the gate found no nearby test files for
`@zilar/mobile`, and the change is UI-only (the spec asks for no tests).

### Notes for the lead

- The ref in `notifications.tsx`/`devices.tsx` is only read at the start of a
  load (to capture whether content is on screen); it never gates the retry
  path, so Retry after an error still shows the spinner and the error view on a
  second failure.
- Behaviour I deliberately left alone: a background refresh still clears an
  inline action error (`error`/`actionError`) at its start, matching the old
  loader; no other state or action changed.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `e298ceeff`.
- **The change:** all six loaders use `setStatus((s) => (s === 'ready' ? s : 'loading'))`, and a failed background refresh keeps the rows.
- **The nit is accepted:** an inline action error clears on refocus. The old loader cleared it too.
- **Emulator** (mock): `/settings/contacts` renders its list normally on first open.
