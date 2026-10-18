---
id: T-1970
title: "Phone parity: pull to refresh on Contacts, Blocked, Contact requests and Devices"
status: merged
milestone: M5
branch: task/T-1970-phone-pull-refresh-people
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-1970: Pull to refresh on the people settings lists (phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, chose this from the Telegram/WhatsApp gaps in `docs/audit/ui-consistency.md` §6, item 1.

Chats, topics, Approvals and Routines can be pulled to refresh; these lists can't.

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/app/settings/`)
- **The pattern to copy.** `approvals.tsx:73-84` sets a `ScrollView` with `refreshControl={<RefreshControl refreshing={refreshing} tintColor={MUTED_FOREGROUND} onRefresh={() => { setRefreshing(true); runLoad(false); }} />}`.
- **Each page already has a loader it calls on focus.**

| Page | Loader | Main list |
|---|---|---|
| `contacts.tsx` | `const [, reload] = useAction(...)` (`:56`), called in `useFocusEffect` (`:90-93`) | `:157` |
| `blocked.tsx` | `reload` (`:46`, focus at `:80-83`) | `:115` |
| `requests.tsx` | `reload` (`:54`, focus at `:89-92`) | `:136` |
| `devices.tsx` | `const load = useCallback(...)` (`:134`), with `useFocusEffect(load)` (`:163`) | `ScrollView` at `:214` |

### Steps
1. **Add a `RefreshControl`.** In each of the four files, put one on the page's main list (the `FlatList` or `ScrollView` above), with `tintColor={MUTED_FOREGROUND}`. Its `onRefresh` calls the page's existing loader.
2. **Stop the spinner.** `refreshing` is a local state, set true on pull. Set it false when the load finishes: use the promise if the loader returns one; otherwise the page's existing loading state, which shows its spinner or error.
   - The spinner must always stop, even when the load fails.
   - A failed load shows the page's existing error.
3. **No tests** (UI). Every file stays at or under 400 lines; `devices.tsx` is at 362, so keep the change small.

### Allowed files
- `apps/mobile/src/app/settings/contacts.tsx`
- `apps/mobile/src/app/settings/blocked.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/devices.tsx`
- `work/T-1970-phone-pull-refresh-people.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The lead checks on the emulator (mock): a pull on each of the four pages shows the spinner, reloads, and the spinner stops.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added a `RefreshControl` (`tintColor={MUTED_FOREGROUND}`) to the main `ScrollView` of `contacts.tsx`, `blocked.tsx`, `requests.tsx` and `devices.tsx`.
- Each `onRefresh` sets a local `refreshing` state and calls the page's existing loader (`reload()` on the three `useAction` pages, `load()` on devices).
- The spinner stops in the loader's success `tap` and in its `catch`, so a failed pull also clears it; the failure still takes the existing path (rows kept when they are on screen, the page's error state otherwise).
- Files changed (all within the Allowed list): `contacts.tsx` (234 lines), `blocked.tsx` (224), `requests.tsx` (296), `devices.tsx` (375), plus this task file.

### Checks run
- `pnpm install --frozen-lockfile`: Done in 17.8s.
- No single test run: the change is UI-only and `pnpm gate` reported `SKIP tests @zilar/mobile (no nearby test files)`.
- `pnpm gate` (repo root):
  ```
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.1s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Not smoke-tested on the emulator; this is for the lead's acceptance pass.
- `devices.tsx` clears the spinner from `load`'s own success/failure branches, matching how that page already tracks its load; `refreshing` is not tied to the focus effect's cleanup, so leaving the screen mid-pull and coming back shows the pull spinner until the focus load finishes, then it stops.


## Review (written by Claude)

**Approved and merged.** The pre-review was clean.

The lead checked on the emulator (mock build of `5c7ce4cb7`), pulling down on `/settings/devices` and `/settings/contacts`. On both, the refresh spinner shows during the pull and is gone 3 s later, with the list unchanged.

Blocked and Requests use the same pattern; the lead read their diffs.
