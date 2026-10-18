---
id: T-1961
title: "Phone UI consistency M5: one ActionTiles row (40 dp key + 12 px label) on own profile, public profile, group info and channel info"
status: merged
milestone: M5
branch: task/T-1961-phone-action-tiles
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 40 min
---

# T-1961: Phone action tiles (M5)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **M5** of `docs/audit/ui-consistency.md` §5. The target is §1.6, and the API is §4.2.

**What the lead saw on the emulator:**
- own profile: wide tiles with the icon above the label (Set photo, Edit info, Settings);
- group info: square icon keys with the label below (Mute, Search, Add, More).

### Facts (read by the lead on 2026-10-18)
- **The own profile's tiles:** `ActionKey` in `apps/mobile/src/components/profile/profile-view.tsx:45-72`.
- **Group info's keys:** `InfoKeys` in `apps/mobile/src/components/group-info/info-keys.tsx` (117 lines).
- **The callers:**
  - `apps/mobile/src/components/profile/profile-actions.tsx`;
  - `apps/mobile/src/components/group-info/root-page.tsx`;
  - `apps/mobile/src/components/channel-info/root-page.tsx`;
  - `apps/mobile/src/app/u/[handle].tsx`.
- **The audit's §4.2 API:**
  - `ActionTiles({ items: { key, label, icon: LucideIcon, onPress, disabled? }[], accessibilityLabel? })`;
  - `flex-row gap-2`, each tile `flex-1 items-center gap-1.5`;
  - a 40 dp `IconButton` (radius 12) and a 12/400 muted label.
- **The kit `IconButton`** is `apps/mobile/src/components/ui/icon-button.tsx`.

### Steps
1. **New `apps/mobile/src/components/ui/action-tiles.tsx`** per §4.2. Each tile carries `accessibilityRole="button"` and `accessibilityLabel={label}`.
2. **The own profile and the public profile** (`profile-view.tsx`, `profile-actions.tsx`, `app/u/[handle].tsx`): render their action row with `ActionTiles`, using the same actions, icons and handlers, and delete `ActionKey`.
3. **Group info and channel info** (`info-keys.tsx`, `group-info/root-page.tsx`, `channel-info/root-page.tsx`): render the key row with `ActionTiles`.
   - `InfoKeys` may become a thin wrapper that maps its keys to `ActionTiles` items, or be deleted if every caller moves.
   - Keep every action, label, disabled state and handler.
4. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/mobile/src/components/ui/action-tiles.tsx`
- `apps/mobile/src/components/profile/profile-view.tsx`
- `apps/mobile/src/components/profile/profile-actions.tsx`
- `apps/mobile/src/components/group-info/info-keys.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/channel-info/root-page.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `work/T-1961-phone-action-tiles.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On phone smoke screenshots of `/me`, `/group-info/g-devteam` and a public profile (`/u/<handle>` from the mock), the action rows are the same 40 dp key + 12 px label tiles, in equal columns.
- Every action still works.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/ui/action-tiles.tsx` per audit §4.2: `ActionTile = { key, label, icon: LucideIcon, onPress, disabled? }`, one `flex-row gap-2` row, each tile `flex-1 items-center gap-1.5` with a 40 px `IconButton` (radius 12, role button, label as `accessibilityLabel`) and a 12 px `text-muted-foreground` label. The optional `accessibilityLabel` labels the row; empty rows render nothing.
- Fix round (pre-review nit 1): a disabled tile's wrapper now gets `opacity-50` via `cn`, like the old `ProfileActionButton`, so disabled keys dim again. `icon-button.tsx` was not touched.
- Own profile (`profile-view.tsx`): the Set photo / Edit info / Settings row now uses `ActionTiles`; deleted `ActionKey` and its gradient style. Same handlers and icons.
- Public profile (`profile-actions.tsx`, `app/u/[handle].tsx`): `buildActions` now returns `ActionTile[]`, the screen draws it with `ActionTiles`; deleted `ProfileActionButton` and `ProfileActions`. Same actions, icons and handlers.
- Group and channel info (`group-info/info-keys.tsx`): `InfoKeys` is now a thin wrapper that maps its Mute/Unmute, Search, Add, Share and More keys to `ActionTiles` items, keeping the disabled mute state, the manager/owner gating and the failure line; deleted the local `InfoKey`. `group-info/root-page.tsx` and `channel-info/root-page.tsx` needed no edit because the `InfoKeys` API is unchanged.
- No tests added (UI change, per the task and AGENTS.md). Longest changed file is 238 lines.
- Deviations: `ProfileAction` no longer has the `primary` accent flag (accept/send were drawn on the accent). §4.2's `ActionTiles` has a single tile look, so the public profile's row is now uniform; the actions and handlers are unchanged. Root pages listed in the task were left untouched since the wrapper kept their contract.

### Checks run

- `pnpm install` — "Done in 17.9s using pnpm v10.32.1".
- `pnpm gate` (after the fix round) — GATE PASS:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first run of the fix round failed `format` on `action-tiles.tsx` (line wrap); I ran Prettier on that one file and re-ran the gate, which passed as above.
- No single test files run: the task says UI gets no tests, and the gate found no nearby test files for `@zilar/mobile`.
- I did not run the app or take phone screenshots: the acceptance smoke on `/me`, `/group-info/g-devteam` and `/u/<handle>` is untested by me and needs the lead's emulator.

### Notes for the lead

- The group/channel key row previously sat in a `px-4 pb-[18px]` wrapper with `opacity-40` while the chat row loads; both are preserved, so the loading dimming still works.
- The own profile's old tiles were wide gradient keys; they now match the 40 px key + 12 px label layout of group info, which removes the gradient panel from `/me`.

## Review (written by Claude)

**Approved and merged after one lead fix round.** The lead checked the phone smoke (mock build of `3bf97ff8e`):
- `/me` (Set photo, Edit info, Settings), `/u/marta` (Message, Mute, Search) and `/group-info/g-devteam` (Mute, Search, Add, More) all show the same `ActionTiles` row: a 40 dp key with a 12 px label, in equal columns.
- The wide gradient `ActionKey` tiles on the own profile are gone.

**Fix round 1** (`0b951e06a`): a disabled tile dims to `opacity-50` again, as the old profile buttons did. The lead read the diff; the busy state isn't reachable in the mock.

`/me` showed the old inline header on this branch only because the branch predates T-1959. The merge takes T-1959's `me.tsx`.
