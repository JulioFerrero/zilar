---
id: T-1907
title: "Smooth app task 9b: the phone AIs tab, Explore, Me and profile (/u/[handle]) refresh silently on focus — loading only shows when there is nothing yet; coming back to them never blanks or spins"
status: merged
milestone: M5
branch: task/T-1907-screens-keep-data
model: auto
effort: default
depends_on: [T-1901]
estimate: 30 min
---

# T-1907: The AIs tab, Explore, Me and profiles keep their content on focus

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §2.6, §4 P7 and §5 task 9.** This is the twin of T-1906 for the other phone screens. Each refetches on every focus and first sets a loading state, so going back to it blanks or spins.

### Facts (read by the lead on 2026-10-17)
The loading state set inside a loader called from `useFocusEffect`:
- `apps/mobile/src/app/(tabs)/ais.tsx:83` (`setStatus('loading')`), focus at `:102`;
- `apps/mobile/src/app/explore.tsx:125` (`setStatus('loading')`), focus at `:129`;
- `apps/mobile/src/app/me.tsx:69` (`setStatus('loading')`), focus at `:86`;
- `apps/mobile/src/app/u/[handle].tsx:110` (`setLoading(true)`), focus at `:116`.

### Steps
1. **In each loader,** go to the loading state only when the screen has nothing to show yet (the first load, or an error with no data). With data shown, refetch silently and replace the data on success. Use the screen's existing state, such as the functional `setStatus((s) => (s === 'ready' ? s : 'loading'))` form.
2. **A failed background refresh with data shown** keeps the data, with no full error view. The first load and Retry behave as today.
3. **`/u/[handle]` with a different `handle`** (a new profile) still shows its loading state, so another person's old data is never shown under a new handle.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/app/(tabs)/ais.tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/app/me.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `work/T-1907-screens-keep-data.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Returning to the AIs tab, Explore, Me or a profile** shows its content at once and refreshes it in place.
- **The first open** still shows the loading state.
- **A new handle** never shows the previous person.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **AIs tab** (`apps/mobile/src/app/(tabs)/ais.tsx`): `reload` only sets `loading` when the status is not `ready`, and a failed load only sets `error` when the status is not `ready`. With the list on screen a focus reload (or a 409 reload) refreshes it silently and swaps the rows on success; a failed background refresh keeps the rows and shows no error view. Retry from the error view and the first load still show the loader.
- **Explore** (`apps/mobile/src/app/explore.tsx`): same rule in the debounced search effect (the loader the focus reload triggers) and in `reload`. A focus reload leaves the current rows visible while the search runs and replaces them on success; a failed background search keeps the rows. The first open and Retry still show "Searching…".
- **Me** (`apps/mobile/src/app/me.tsx`): `load` only enters `loading` when the status is not `ready`, and the failure path only enters `error` when the status is not `ready`. A focus reload refreshes the profile in place; a failed refresh keeps the profile on screen.
- **Profile `/u/[handle]`** (`apps/mobile/src/app/u/[handle].tsx`): added a `loadedHandle` ref set on every successful load. `load` sets `loading` only when the ref does not match the current handle, so a focus reload of the same profile refreshes in place, while a different handle still blanks to the loader and never shows the previous person. In the failure path a failed refresh of the handle already on screen returns without setting the error or empty state (404 included); a load with nothing on screen behaves as before.

### Checks run
- `pnpm install` — Done in 24.9s, no changes.
- `pnpm gate` — `GATE PASS` (exit 0):
  - `gate: 5 changed file(s) against main`
  - `PASS install (frozen) (1.4s)`, `PASS format (1.0s)`, `PASS lint (1.2s)`, `PASS typecheck (5.8s)`, `PASS effect (1.2s)`
  - `SKIP tests @zilar/mobile (no nearby test files)` — the spec says no tests (UI).
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines` (ais 334, explore 345, me 283, u/[handle] 328)
- No tests were run individually: the spec says no tests (UI), and the gate found no nearby test files.

### Notes for the lead
- Explore's silent rule applies to the shared debounced search, so typing a query or changing the kind now also keeps the old rows until the new answer replaces them, instead of blanking to "Searching…". That follows step 1 literally ("go to the loading state only when the screen has nothing to show yet"); say if you want query changes to blank and only focus reloads to be silent.
- On `/u/[handle]`, a background refresh that answers 404 keeps the profile already on screen (step 2: a failed background refresh keeps the data). The empty "No user" state is unchanged for a handle with nothing loaded, including a new handle.
- File sizes stayed under the 400-line limit; no other files were touched.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `5b22b8f9b`.
- **The change:** the AIs tab, Explore and Me refresh silently once they are ready.
- **`/u/[handle]`** still blanks to its loader when the handle changes (`loadedHandle` ref), so another person's profile never shows under a new handle.
- **The nit has no visible effect:** a hidden error state is written.
- **Emulator** (mock): `/explore` renders normally on first open.
