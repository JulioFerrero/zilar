---
id: T-1075
title: "Dither avatars: every avatar without a picture shows dither-avatar's coloured SVG (web and mobile, AIs too) instead of initials"
status: merged
milestone: M5
branch: task/T-1075-dither-avatars
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1075: Dither avatars for avatars without a picture

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, after seeing a preview: avatars without a picture use [dither-avatar](https://github.com/maartenkeizer/dither-avatar) **in its shipped colours, for everyone, AIs too**. It replaces the initials and the monochrome shades.

The lead read the package and the code on main:
- **The package:** npm `dither-avatar@1.0.0` (MIT, no dependencies, published 2026-05-11).
  - `generateDitherAvatar(seed): string` returns an SVG, and `SIZE = 200`.
  - The SVG starts `<svg width="200" height="200" xmlns=… shape-rendering="crispEdges">` and has **no `viewBox`**, so it does not scale inside a sized box until one is added.
- **Shared avatar helpers** live in `packages/chat-core/src/avatar.ts` (58 lines: `avatarGradient`, `initials`), exported from `packages/chat-core/src/index.ts:4`.
- **The four places that draw the fallback today:**
  - **web** `apps/web/src/components/Avatar.tsx` (96 lines): `avatarShade` and initials at `:56-82`; the `<img>` for a real picture at `:84`; the online dot at `:86-92`;
  - **mobile** `apps/mobile/src/components/chat/avatar.tsx` (65 lines): a shaded circle with initials at `:31-50`, using `avatarShade` from `apps/mobile/src/lib/depth.ts:159`;
  - **mobile** `apps/mobile/src/components/profile/profile-view.tsx:101-118`: the 104 px circle with `initials(profile.name)`, where `profile.id` exists on `MyProfile`;
  - **mobile** `apps/mobile/src/components/nav/floating-tab-bar.tsx:87-90`: the Profile tab fallback with `initials(profile?.name ?? '?')`, where `TabProfile.id` exists.
- **Mobile can render it:** it already depends on `react-native-svg` 15.15.4 (`apps/mobile/package.json:62`), which has `SvgXml`.
- **Web can show `data:` images:** the CSP allows them (`apps/web/Caddyfile`: `img-src 'self' data: blob: https:`).

### What to build
1. **The shared helper.** Add `"dither-avatar": "1.0.0"` (exact) to `packages/chat-core/package.json` dependencies, and run `pnpm install`. In `packages/chat-core/src/avatar.ts`, add:
   - `ditherAvatarSvg(seed: string): string`: `generateDitherAvatar(seed)` with `viewBox="0 0 200 200"` (use `SIZE`) added to the root `<svg>`, so it scales to any box;
   - `ditherAvatarDataUri(seed: string): string`: `'data:image/svg+xml,' + encodeURIComponent(ditherAvatarSvg(seed))`.
2. **Web `Avatar.tsx`.** With no `avatarUrl`, render `<img src={ditherAvatarDataUri(id)} alt="" aria-hidden="true" className="h-full w-full rounded-full object-cover" />`.
   - Keep the real picture and the online dot unchanged.
   - Remove `avatarShade`, `PERSON_SHADES`, `AI_SHADE`, `hashId` and the `User` icon import if nothing else uses them (`grep` first). The `ai` prop may stay in the props for callers, but it no longer changes the look.
3. **Mobile `components/chat/avatar.tsx`.** Replace the shaded circle and initials with a `View` of `size` × `size`, `borderRadius: size / 2`, `overflow: 'hidden'`, holding `<SvgXml xml={ditherAvatarSvg(id)} width={size} height={size} />`.
   - Keep the online dot.
   - Remove the `avatarShade` import. If nothing else uses `avatarShade`, `AI_SHADE`, `PERSON_SHADES` and `AvatarShade` in `apps/mobile/src/lib/depth.ts`, delete them (`grep` first).
4. **Mobile `profile-view.tsx` and `floating-tab-bar.tsx`.**
   - In profile-view, the no-picture fallback becomes the dither of `profile.id`, at the same size and with the same `accessibilityLabel`.
   - In the tab bar, the fallback becomes the dither of `profile.id` when `profile` is present, sized to the existing face. Keep the `?` text when `profile` is undefined.
5. **No tests** (UI code). No other files change, and every file stays under 400 lines.

The lead checks:
- on the web with `?mock=1`: the chat list, a chat header, the members list and Settings › Profile;
- on the phone in mock mode: Chats, the Profile tab, a profile page and AIs.

### Read first
`AGENTS.md`, the files listed in Why, and `packages/chat-core/src/avatar.ts`.

### Allowed files
`packages/chat-core/package.json`, `packages/chat-core/src/avatar.ts`, `pnpm-lock.yaml`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `work/T-1075-dither-avatars.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report shows the first 120 characters of `ditherAvatarSvg('u-ana')`, which must include the `viewBox`.

---

## Report (written by the worker when done)

### What I did

- **Shared helper** (`packages/chat-core`): added `"dither-avatar": "1.0.0"` (exact) to dependencies and ran `pnpm install`. In `src/avatar.ts` added `ditherAvatarSvg(seed)` (runs `generateDitherAvatar(seed)` and injects `viewBox="0 0 ${SIZE} ${SIZE}"` into the root `<svg>`) and `ditherAvatarDataUri(seed)` (`'data:image/svg+xml,' + encodeURIComponent(ditherAvatarSvg(seed))`). Both are re-exported through the existing `export * from './avatar'` at `src/index.ts:4`.
- **Web** `apps/web/src/components/Avatar.tsx`: with no `avatarUrl` it now renders `<img src={ditherAvatarDataUri(id)} alt="" aria-hidden="true" className="h-full w-full rounded-full object-cover" />`. The real picture and the online dot are unchanged. Deleted `avatarShade`, `AvatarShade`, `PERSON_SHADES`, `AI_SHADE`, `hashId` and the `User` / `initials` imports after grepping: nothing else in the repo used them. `id` and `name` stay in `AvatarProps` for callers; `ai` stays in the props but is no longer destructured or used.
- **Mobile `components/chat/avatar.tsx`**: replaced the shaded circle/initials with a `size`×`size` `View` (`borderRadius: size / 2`, `overflow: 'hidden'`) holding `<SvgXml xml={ditherAvatarSvg(id)} width={size} height={size} />`. Online dot kept. Removed the `avatarShade` and `initials` imports and the `Text` import. `name`/`ai` stay in the props for callers but are no longer destructured.
- **Mobile `lib/depth.ts`**: deleted `avatarShade`, `AI_SHADE`, `PERSON_SHADES` and `AvatarShade` — a repo grep showed `avatarShade` was only used by `components/chat/avatar.tsx` (and the web had its own copy). `senderColor` and the sender colours are untouched.
- **Mobile `profile/profile-view.tsx`**: the no-picture fallback is now a 104×104 circle with `overflow: 'hidden'` holding `<SvgXml xml={ditherAvatarSvg(profile.id)} width={104} height={104} />`, with the same `accessibilityLabel={`${profile.name} picture`}`. Removed the `initials` import.
- **Mobile `nav/floating-tab-bar.tsx`**: the Profile tab fallback is the dither of `profile.id` (20×20, matching the resolved picture) when `profile` is present, and the `?` text when it is undefined. Removed the `initials` import.
- Updated a few comments that still said "initials" to say "dither".
- No tests written (UI code, as the spec says).
- Deviation: none from the spec. `name` in both `AvatarProps` types also stays for callers (like `ai`), since the spec only names `ai`; removing it would break callers and it is outside scope.

### Files changed

`packages/chat-core/package.json`, `packages/chat-core/src/avatar.ts`, `pnpm-lock.yaml`, `apps/web/src/components/Avatar.tsx`, `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/components/profile/profile-view.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `work/T-1075-dither-avatars.md`.

### Commands and real results

- `pnpm install`: ok (added `dither-avatar@1.0.0`; it landed at `packages/chat-core/node_modules/dither-avatar`, exports `generateDitherAvatar` and `SIZE = 200`, `dist/index.d.ts`).
- Single tests: none run separately — no test file sits next to any changed file (checked; the package suites have no avatar tests). The gate ran the nearest package suites instead.
- `pnpm gate` (from the repo root):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.7s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first run failed on `format` for `apps/mobile/src/lib/depth.ts` (a leftover blank line from the deletion); I ran `pnpm exec prettier --write` on that one allowed file and re-ran the gate.

### Acceptance: `ditherAvatarSvg('u-ana')` first 120 characters

```
<svg viewBox="0 0 200 200" width="200" height="200" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rec
```

(120 chars; includes `viewBox="0 0 200 200"`.)

### Blocked / needs a decision

Nothing blocked. Not verified on web/mobile at runtime (mock mode) — that is the lead's smoke test.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The shared helpers:** `dither-avatar@1.0.0` (exact) in `@zilar/chat-core`. `ditherAvatarSvg` adds `viewBox="0 0 200 200"`, and `ditherAvatarDataUri` wraps it.
- **Web:** `Avatar.tsx` shows the dither `<img>` when there is no picture. The monochrome shades are removed.
- **Mobile:** `chat/avatar.tsx` uses `SvgXml` in a round clip. `profile-view` and the Profile tab face use the viewer's id. `avatarShade` and the shades are removed from `lib/depth.ts`.
- **The lead's web check** (`?mock=1`): coloured dithers in the chat list, the chat header and message avatars, AIs (Dev-1) too.
- **The lead's phone smoke** (mock):
  - **Chats:** Dev AI, Dev team, Marta, Familia, QA squad, Acme, Luis and Marketing AI each show their own dither, scaled to the circle;
  - **Profile:** the 104 px dither for Ada, plus the tab-bar face;
  - **`/u/some_guy` and AIs** pass.
- **Check:** the gate passed.
