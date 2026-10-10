---
id: T-1005
title: "Size split T78: apps/mobile/src/app/settings/profile.tsx (521 lines) into components/settings/{use-profile-settings,name-field}"
status: merged
milestone: M5
branch: task/T-1005-split-mobile-profile
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1005: Split the mobile profile screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/profile.tsx` is 521 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #74 (task T78): `components/settings/use-profile-settings.ts` and `settings/name-field.tsx`, under `apps/mobile/src/`.

- **The screen keeps:** `SettingsScreenShell`, the status and HandleField wiring, and its default export.
- **Skip the Dedup:** `attempt-with-message.ts` crosses files to `machines`.
- **Existing files:** the folder already holds other files. Leave them as they are.
- **The 400-line limit:** if `use-profile-settings.ts` comes out over 400 lines, split it once more inside `components/settings/` (for example `use-profile-avatar.ts`), and name the new file in the Report.

The lead runs a phone smoke of `/settings/profile` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #74, and `apps/mobile/src/app/settings/profile.tsx`.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts`, `apps/mobile/src/components/settings/use-profile-avatar.ts`, `apps/mobile/src/components/settings/name-field.tsx`, `work/T-1005-split-mobile-profile.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/app/settings/profile.tsx` (521 lines) along the plan entry
(§2.2 #74 / task T78) into a thin route barrel plus three new files under
`apps/mobile/src/components/settings/`:

- `use-profile-settings.ts` — the screen's state and effects: the load, the
  debounced handle-availability check, `saveName`, `saveHandle`, and the
  derived `unchanged`/`nameUnchanged` flags.
- `use-profile-avatar.ts` — **the extra split the spec allows.** The settings
  hook came out at ~480 lines with the avatar code inline, so the avatar half
  (state, the picker/save/remove effect, the uploader) moved to this file, which
  the spec names in "The 400-line limit".
- `name-field.tsx` — the display-name editor (`NameField`), a copy of the
  `471–501` block, styled like the existing `HandleField`.

The barrel keeps only `SettingsScreenShell`, the status wiring, the avatar and
`HandleField` wiring, `NameField`, and its default export.

No behaviour change: code is moved unchanged apart from the mechanical hook
extraction. `useProfileAvatar` receives the shared call wrapper `attempt` and a
`setAvatarUrl` callback from the settings hook, so the avatar half stays a leaf
(no import cycle) and `attempt` keeps one definition. The load still resets the
avatar phase and stores the bearer through `avatar.reset(token)`.

Deviations / notes:
- The `attempt` helper is defined once in `use-profile-settings.ts` and passed to
  `useProfileAvatar` as `ProfileAttempt`. The plan's Dedup
  (`lib/effect/attempt-with-message.ts`) was skipped as the spec says; it crosses
  files to `machines`. Nothing outside my Allowed files was touched.
- The `ProfileFailed` class and `LOAD_ERROR`/`ProfileStatus` are now exported from
  the settings hook (they were module-private before) so the split files can use
  them; the barrel still exports exactly what it did before (`default`).

### Files and sizes (`wc -l`)

| File | Before | After |
| --- | --- | --- |
| `apps/mobile/src/app/settings/profile.tsx` | 521 | 106 |
| `apps/mobile/src/components/settings/use-profile-settings.ts` | — | 308 |
| `apps/mobile/src/components/settings/use-profile-avatar.ts` | — | 200 |
| `apps/mobile/src/components/settings/name-field.tsx` | — | 61 |

Every file is under the 400-line limit.

### Export diff (`grep -E "^export"`)

Before (`git show main:...profile.tsx`):
```
export default function ProfileSettingsScreen() {
```

After (barrel + new files):
```
apps/mobile/src/app/settings/profile.tsx:export default function ProfileSettingsScreen() {
apps/mobile/src/components/settings/use-profile-settings.ts:export type ProfileStatus = 'loading' | 'ready' | 'error';
apps/mobile/src/components/settings/use-profile-settings.ts:export class ProfileFailed extends Data.TaggedError('ProfileFailed')<{
apps/mobile/src/components/settings/use-profile-settings.ts:export const LOAD_ERROR = 'Could not load your profile.';
apps/mobile/src/components/settings/use-profile-settings.ts:export type ProfileAttempt = typeof attempt;
apps/mobile/src/components/settings/use-profile-settings.ts:export function useProfileSettings() {
apps/mobile/src/components/settings/use-profile-avatar.ts:export interface ProfileAvatar {
apps/mobile/src/components/settings/use-profile-avatar.ts:export function useProfileAvatar(
apps/mobile/src/components/settings/name-field.tsx:export function NameField({
```

The barrel still exports the same single `default`; no importer changes.

### Commands and results

- `pnpm install` — done, 1172 packages, no errors.
- `pnpm --filter @zilar/mobile typecheck` — passed (`tsc --noEmit`, no output).
- `pnpm gate` (after fixing one Prettier wrap) — summary:
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.5s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  effect  (0.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
No single test file was run: the change is UI only and `selectTestFiles` found no
nearby test (the first gate run's only failure was a Prettier wrap, fixed).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `settings/profile.tsx` (521 lines) becomes the screen plus `components/settings/{use-profile-settings,use-profile-avatar,name-field}`. `use-profile-avatar.ts` (200) is the extra split the spec allowed, and `use-profile-settings.ts` is 308.
- **The lead's phone smoke** (mock build, `/settings/profile`):
  - Add picture, Display name with Save name (disabled until an edit), and @username with Save username all render;
  - changing the name to "Ada L" and saving shows "Saved.", and the avatar initials become "AL".
- **Check:** the gate passed.
