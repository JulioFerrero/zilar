---
id: T-1075
title: "Dither avatars: every avatar without a picture shows dither-avatar's coloured SVG (web and mobile, AIs too) instead of initials"
status: todo
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

## Review (written by Claude)
