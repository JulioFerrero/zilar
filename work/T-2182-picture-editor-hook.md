---
id: T-2182
title: "Phone: one picture editor hook (pick, save, remove) for profile settings and group settings; no behaviour change"
status: merged
milestone: M5
branch: task/T-2182-picture-editor-hook
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2182: One phone picture editor hook

## Spec (written by Claude, do not edit)

### Why
Big-cut plan B6 (`docs/audit/big-cut-plan.md`). The phone has two copies of the same "pick, save, remove picture" state machine, and both drive `AvatarControl`:
- the profile settings screen;
- the group settings page.

One hook makes each screen shorter and gives readers one place to look.

### Facts (the lead read these on 2026-10-19)
1. `apps/mobile/src/components/settings/use-profile-settings.ts:416-587`: `useProfileAvatar(api, attempt, setAvatarUrl)`, with the `PickedAvatar` and `AvatarOperation` types and `PICK_ERROR`. It keeps `token`, `phase: AvatarPhase` and `busy`, and returns `{ token, phase, busy, reset, pick, savePicked, remove }`. Its three operations:
   - **pick:** `createPicturePicker().pickPicture()`. `picked` sets phase `picked`, `error` sets phase `failed` with the result's message, and a throw sets phase `failed` with `PICK_ERROR`.
   - **save:** sets phase `uploading` (progress 0), then calls `api.uploadAvatar(ownerId, new Blob([], { type }), uploaderFor(picked))`. `uploaderFor` reports progress into the `uploading` phase. Success calls `setAvatarUrl(url)` and sets phase `idle`. Failure sets phase `failed` with `friendlyAvatarError(cause)`.
   - **remove:** `api.removeAvatar(ownerId)`. Success calls `setAvatarUrl(undefined)` and sets phase `removed`. Failure sets phase `failed` with `friendlyAvatarError(cause)`.
   - **Shared rules:** one run at a time (`useAction(…, { mode: 'ignore' })`), and `busy` is true while a run is going.
2. `apps/mobile/src/components/group-info/settings-page.tsx:29-38` and `:77-229`: the same machine, with `PickedAvatar`, `PictureOperation`, `PICK_ERROR`, `SAVE_ERROR`, `REMOVE_ERROR`, `phase`, `pictureBusy` and `useAction(…, { mode: 'ignore' })`.
   - **pick:** identical.
   - **save:** reads a fresh bearer; none fails with `SAVE_ERROR`. Then it uploads with `createAvatarFileUploader().upload(groupAvatarSlot(groupId), { uri, mimeType, width: AVATAR_EXPORT_SIDE, height: AVATAR_EXPORT_SIDE }, bearer, onProgress)`. Failure gives `friendlyAvatarError(cause)`. Success calls `setChangedUrl(url)`, sets phase `idle` and calls `onPictureChanged()`.
   - **remove:** a `DELETE` on the slot with the bearer; no bearer or a non-ok response fails with `REMOVE_ERROR`. Success calls `setChangedUrl(undefined)`, sets phase `removed` and calls `onPictureChanged()`.
3. `AvatarPhase` lives in `apps/mobile/src/components/settings/profile-logic.ts:110`. `AvatarControl` lives in `apps/mobile/src/components/settings/avatar-control.tsx` (160 lines).
4. `apps/mobile/src/app/me.tsx` has a third, different flow: it keeps a staged pick through a failed save. It is **out of scope**; do not touch it.

### Steps
1. Add `usePictureEditor` to `apps/mobile/src/components/settings/avatar-control.tsx`, next to the control it feeds, and export it. It takes three things:
   - `upload: (picked: { uri: string; mimeType: string }, onProgress: (fraction: number) => void) => Promise<{ url: string }>`, rejecting with the message to show;
   - `remove: () => Promise<void>`, rejecting with the message to show;
   - `onChanged: (url: string | undefined) => void`.

   It returns `{ phase, busy, pick, savePicked, remove, reset }`, where `reset()` sets phase `idle`. It owns the pick logic, `PICK_ERROR`, the `uploading` progress phases, the `failed`/`idle`/`removed` phases, `busy` and the one-run-at-a-time `useAction(…, { mode: 'ignore' })`.
2. `use-profile-settings.ts`:
   - delete `useProfileAvatar` and its types and constants, and use `usePictureEditor`;
   - `upload` wraps `api.uploadAvatar` with the same uploader (same token rule, same `401 'No session'` error) and maps a failure with `friendlyAvatarError`;
   - `remove` wraps `api.removeAvatar` the same way.

   The owner id comes from the loaded profile, exactly where `savePicked(ownerId)` and `remove(ownerId)` get it today. Keep the `token` state where the screen needs it, and keep `avatarToken`, `avatarPhase`, `avatarBusy`, `pickPicture`, `savePickedPicture` and `removePicture` in the hook's return, so the screen does not change.
3. `settings-page.tsx`:
   - delete its machine, and use `usePictureEditor`;
   - `upload` keeps the group slot, the `AVATAR_EXPORT_SIDE` size, the bearer rule and `SAVE_ERROR`;
   - `remove` keeps the `DELETE` and `REMOVE_ERROR`;
   - `onChanged` calls `setChangedUrl` and `onPictureChanged()`.
4. Change no behaviour, no text, no error sentence, no phase order. Keep every "why" comment, on the moved code. Prettier formatting.
5. No new tests; existing tests must pass unchanged.
6. Report the line counts per file.

### Allowed files
- `apps/mobile/src/components/settings/avatar-control.tsx`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/group-info/settings-page.tsx`
- `apps/mobile/src/components/settings/profile-logic.ts` (only if a type has to move)
- `work/T-2182-picture-editor-hook.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `useProfileAvatar` is gone, and the group settings page has no picture state machine of its own.
- Phone emulator, mock mode, checked by the lead: Settings → Profile picture pick and remove, and a group's Settings page picture control.
- Product lines are at least 100 lower.

---

## Report (written by the worker when done)

### What I did
- Added `usePictureEditor` (exported, with `PicturePick`) to `avatar-control.tsx`. It owns the pick, save, remove phases, `PICK_ERROR`, upload progress, `busy` and the `useAction(…, { mode: 'ignore' })` one-run-at-a-time rule. It returns `{ phase, busy, pick, savePicked, remove, reset }`; `reset()` sets phase `idle`.
- `use-profile-settings.ts`: deleted `useProfileAvatar`, `PickedAvatar`, `AvatarOperation`, `ProfileAvatar`, `PICK_ERROR` and the now-unused `ProfileAttempt` export; the screen hook now calls `usePictureEditor` with a wrapper around `api.uploadAvatar` / `api.removeAvatar`. The wrapper keeps the same uploader (`expo-file-system`, `width: 0, height: 0`), the same token rule and `401 'No session'` error, and maps failures through `friendlyAvatarError`. The avatar token stays as local state (`resetAvatar(token)`), and `avatarToken`, `avatarPhase`, `avatarBusy`, `pickPicture`, `savePickedPicture`, `removePicture` are still returned.
- Because `profile.tsx` (outside the Allowed files) still calls `savePickedPicture(profile.id)` and `removePicture(profile.id)`, those returned wrappers accept the id and store it in a ref that the upload/remove closures read. The screen file is untouched and the id still comes from the loaded profile, passed where it is passed today.
- `settings-page.tsx`: deleted the local picture machine (`PickedAvatar`, `PictureOperation`, `PICK_ERROR`, `phase`, `pictureBusy`, the pick/save/remove effects and `useAction` for pictures) and uses `usePictureEditor`. `upload` keeps the group slot, `AVATAR_EXPORT_SIDE`, the bearer rule and `SAVE_ERROR`; `remove` keeps the `DELETE`, credentials, bearer and `REMOVE_ERROR`; `onChanged` sets `changedUrl` and calls `onPictureChanged()`.
- No text, sentences, phase transitions or behaviour were changed intentionally. Kept the existing "why" comments on the moved code (expo-file-system upload, bearer reads, changed-url precedence).

### Files changed and line counts
- `apps/mobile/src/components/settings/avatar-control.tsx`: 160 → 263 lines (+103, the new hook).
- `apps/mobile/src/components/settings/use-profile-settings.ts`: 587 → 470 lines (-117).
- `apps/mobile/src/components/group-info/settings-page.tsx`: 326 → 225 lines (-101).
- Product total: 1073 → 958 lines, **115 lower**.
- `work/T-2182-picture-editor-hook.md`: report/status only.

### Commands and results
- `pnpm install`: completed, 1155 packages, one pre-existing peer warning (`@types/react-dom` vs `@types/react`).
- `pnpm exec prettier --write` on the three touched source files (needed after the first gate reported formatting).
- `pnpm gate` (first run): FAIL on format only (3 files listed); all other checks passed.
- `pnpm gate` (final run), from the repo root:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`; `images: …`; `comments: no task IDs in added comments`
  - `WARN size: apps/mobile/src/components/settings/use-profile-settings.ts: 470 lines (main 587); limit 400`
  - `size: no changed source file is over 800 lines`
  - `GATE PASS`
- No single test file was run: there are no tests under `components/settings` or `components/group-info`, and the gate reported no nearby test files. No tests were added, and none changed.

### Problems / deviations
- The first gate run failed format; fixed with Prettier, and the final gate passes.
- `use-profile-settings.ts` is still over the 400-line soft limit (470, down from 587); the gate reports it as a warning and the file is kept whole as the rules allow.
- `profile-logic.ts` was not changed; `AvatarPhase` already lived there.
- Visual/emulator behaviour was not run by me; the lead's phone smoke covers it.

### Fix round
- Restored the two "why" comments from the old `useProfileAvatar`, above the `uploadAvatar` callback and its `uploaderFor`, in `use-profile-settings.ts`.
- `settings-page.tsx`: the failed `DELETE` now throws `new Error(REMOVE_ERROR)` instead of an empty `new Error()`.
- `pnpm gate`: **GATE PASS** (`install`, `format`, `lint`, `typecheck`, `effect` pass; server build and mobile tests skipped; scope clean; same soft-limit warning for `use-profile-settings.ts` at 470 lines).

### Blocked / needs a decision
- Nothing blocked.


## Review (written by Claude)

Approved; the pre-review was clean after one lead fix round, which reworded the upload comments and named the remove error. Net −115 across 3 files.

**What changed:** `usePictureEditor` sits in `avatar-control.tsx`, next to the control it feeds. It holds pick, the upload progress phases, save, remove and one-run-at-a-time. Profile settings and the group Settings page each pass only their upload and remove calls and their error sentences.

**Gone:** `useProfileAvatar` (~170 lines) and the group page's own copy of the same state machine.

**Out of scope:** `me.tsx` keeps its own flow, because it holds a staged pick through a failed save.

**Phone emulator, mock mode, checked by the lead:**
1. Settings → Profile → Add picture opens the system picker; Back cancels with no error.
2. Picking a photo and cropping shows "A new picture is ready. Save it below."
3. Save picture → "Change or remove your picture."
4. Remove → "Picture removed."
5. Group Dev team → Settings shows the picture control, toggles and Visibility.
