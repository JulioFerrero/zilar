---
id: T-1978
title: "Smooth app: Edit profile, Settings › Stickers and the pack editor stop flashing a loading state every time the screen regains focus — keep the shown data while a reload runs"
status: merged
milestone: M5
branch: task/T-1978-phone-keep-content-on-focus
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-1978: Keep content on focus reloads (phone)

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-17 for a smooth app: "no jumps". On 2026-10-18 the lead found that three phone hooks set their status to `'loading'` on every reload. Each of them also reloads on screen focus, so coming back to the screen, for example from a pack to Stickers, replaces the shown content with the loading state for a moment.

T-1971 fixes the same pattern in Connections and Machines.

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/components/`)
| Hook | Lines | Where `'loading'` is set | Focus reload |
|---|---|---|---|
| `settings/use-profile-settings.ts` (Edit profile) | 341 | `loadProfile` sets `setStatus('loading')` at `:103` | 2 `useFocusEffect` uses |
| `stickers/use-stickers-panel.ts` (Settings › Stickers) | 315 | `reload` sets `setStatus('loading')` at `:74` | `useFocusEffect` at `:99` |
| `stickers/use-pack-editor.ts` (pack editor) | 295 | `load` sets `setStatus('loading')` at `:141` | `useFocusEffect` at `:180-183` |

The pattern to copy is `approvals/use-approvals.ts:76-80`: `runLoad(showLoading)` sets `'loading'` only when `showLoading` is true.

### Steps
1. **Keep shown data on reload.** In each of the three hooks, set `'loading'` only when nothing is shown yet (status is not `'ready'`). Use a ref if the callback can't read the current status.
   - A reload over ready data keeps that data and swaps in the new data when it arrives.
   - A failed background reload keeps the data. Show the error only if the screen already has a way to show one without blanking.
2. **Never overwrite unsaved edits.** In `use-profile-settings.ts`, a focus reload must not overwrite fields the user has edited and not saved. If the hook already guards this, keep the guard. If it doesn't, don't apply server values over a dirty field.
3. **Keep the rest.** Keep "latest load wins" and every existing behaviour.
4. **No tests.** This is UI state. Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/components/stickers/use-pack-editor.ts`
- `work/T-1978-phone-keep-content-on-focus.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Stickers.** On the emulator (mock), open Settings › Stickers, open a pack, then go back. The Stickers list stays on screen, with no loading flash.
- **Edit profile.** Open Edit profile, type into Bio, open another app and come back. The typed text is still there.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- **Settings › Stickers** (`use-stickers-panel.ts`): `reload` now sets
  `'loading'` only via a functional update when the status is not `'ready'`, so a
  focus reload over the shown list keeps it (the new packs swap in when they
  arrive). A failed reload also keeps `'ready'` when data is shown, instead of
  switching to the error state that would blank the list.
- **Pack editor** (`use-pack-editor.ts`): `load` follows the same rule, so a
  reload over the shown pack keeps the form while the fetch runs. On failure,
  `'load-error'` is only painted when nothing was shown; a `'not-found'` answer
  still always applies, because a pack that was deleted elsewhere must not stay
  editable.
- **Edit profile** (`use-profile-settings.ts`):
  - the load paints `'loading'` only when the status is not `'ready'`, and a
    failed background reload keeps the shown profile instead of the error state;
  - added three dirty refs (name, handle, bio), set by the `onNameChange` /
    `onHandleChange` / `onBioChange` handlers and cleared when that field's Save
    lands (claim, name PATCH, bio update). A focus reload applies server values
    only to fields that are not dirty, so typed, unsaved text survives; while
    the bio is dirty its saved baseline (`savedBio`) is left untouched.
- "Latest load wins" and all other behaviour are unchanged: the profile load
  still uses `useAction { mode: 'replace' }`, and the stickers/pack loads keep
  their existing `Effect.runFork` flow.

Files changed:
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `apps/mobile/src/components/stickers/use-pack-editor.ts`
- `work/T-1978-phone-keep-content-on-focus.md`

### Checks run

- `pnpm install`: done, no errors (one pre-existing peer-dependency warning:
  `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (`pnpm gate` was run twice — before and after writing this report — and both
  runs ended `GATE PASS` with the same statuses.)
- I ran no single test files: the task says no tests for this UI state change,
  and the gate skipped mobile tests because no test file is near these hooks.
- I did **not** run the emulator, so the two acceptance flows (Stickers list
  without a flash, Bio text surviving a resume) are not verified on device by
  me; they need the lead's phone smoke.

### Notes for the lead

- No deviation from the spec.
- A failed background reload has no inline error line to show (all three
  screens render their content only in the `ready`/non-error state and use the
  error state as a full-screen message), so per step 1 of the spec the error is
  dropped and the shown data stays.
- In the pack editor I kept `'not-found'` (and `'forbidden'`) authoritative even
  over ready data: a pack deleted or no longer owned elsewhere should not stay
  editable. Only the generic load failure is suppressed while data is shown.
- The pack editor still re-applies server title and items on a focus reload
  (the spec only asks for the loading-state change there); unlike the profile
  fields, its form has no dirty guard, so an unsaved title edit could still be
  replaced if the screen regains focus. I left that as-is to stay within the
  spec — tell me if you want the same dirty guard there.


## Review (written by Claude)

**Approved and merged.** The pre-review was clean apart from 2 nits.

**Emulator check** (mock build of `02aab9d0f`): Settings › Stickers › Cats › Edit opens the Edit pack screen; pressing Back returns to Stickers. A screenshot about 200 ms after Back shows the full list (Cats, Moods, Import, ADDED Space cats), with no loading state.

**Nits, accepted as they are:**
1. **Profile dirty flags.** They stay set if a field is typed back to its original text. The only effect is that a later focus reload keeps the user's (identical) text.
2. **Pack editor title.** A focus reload still re-applies the server title, visibility and items over unsaved pack edits. That's the behaviour from before this task (the worker disclosed it), and the editor rarely loses focus mid-edit: the image picker is a native activity, not a route.
