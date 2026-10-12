---
id: T-1253
title: "TG-3 images mobile: the mobile link preview card shows the preview image (T-1252's /api/link-preview/image/<key> path) as a 64 px thumbnail, loaded from our API origin with the session bearer like useMediaSource; a broken image hides it"
status: merged
milestone: M5
branch: task/T-1253-mobile-link-preview-image
model: auto
effort: default
depends_on: [T-1252]
estimate: 0.2 day
---

# T-1253: Link preview image on mobile

## Spec (written by Claude, do not edit)

### Why
- **T-1252 (merged)** added `image?: string` to the link preview (`packages/api-contract/src/link-preview.ts:16-18`). It's a **server path**, `/api/link-preview/image/<key>`, served only with a session (the route is at `:32-36`). The web card shows it.
- **The mobile card** `apps/mobile/src/components/chat/link-preview-card.tsx` (147 lines, T-1241) shows only text.

### What to build
1. **A hook** `useLinkPreviewImage(path: string | undefined)` in a new `apps/mobile/src/lib/link-preview-image.ts`, built like `useMediaSource` in `apps/mobile/src/lib/media-source.ts:18-52`:
   - build the absolute URL as `API_URL` (`apps/mobile/src/lib/auth.ts`, as imported at `apps/mobile/src/lib/attachment-common.ts:12`) + the path;
   - **only** when the path starts with `/api/link-preview/image/`. Anything else gives no image; never load an outside URL;
   - read the token with `getSessionToken()` and return `{ uri, headers: { authorization: 'Bearer …' } }`;
   - interrupt the token read on cleanup, the same way `media-source.ts:31-43` does.
2. **The card:**
   - when `preview.image` is set and the hook gives a source, show an `expo-image` thumbnail (64×64, `contentFit="cover"`, rounded like the card's corners) beside the text, the same layout as the web's `apps/web/src/components/message/LinkPreviewCard.tsx`;
   - `onError` hides it;
   - with no image, today's look stays;
   - keep the card at most 400 lines.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `work/T-1252-link-preview-images-proxy.md`, `apps/mobile/src/components/chat/link-preview-card.tsx`, `apps/mobile/src/lib/media-source.ts`, `apps/mobile/src/lib/attachment-common.ts` and `apps/web/src/components/message/LinkPreviewCard.tsx`.

### Allowed files
`apps/mobile/src/lib/link-preview-image.ts`, `apps/mobile/src/components/chat/link-preview-card.tsx`, `work/T-1253-mobile-link-preview-image.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead checks it live on the next APK:** a github.com link shows the thumbnail.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/lib/link-preview-image.ts` (new):** `useLinkPreviewImage(path: string | undefined)` returning `LinkPreviewImageSource | undefined` (`{ uri, headers }`). It accepts the path **only** when it starts with `/api/link-preview/image/` (`LINK_PREVIEW_IMAGE_PREFIX`); any other value — including an absolute `https://…`, another API path, or `undefined` — yields no source, so the card can never load an outside URL or leak the token to another host. On an allowed path it builds `${API_URL}${path}` and reads the token with `getSessionToken()`, exactly like `useMediaSource` (`media-source.ts:18-52`): the read runs in a forked `Effect` and a cleanup `Fiber.interrupt`s it, `onSuccess` stores `{ authorization: 'Bearer …' }`, and while the token has not resolved (or there is no token) it returns `undefined`, so the card shows no image.
- **`apps/mobile/src/components/chat/link-preview-card.tsx`:** the hook is called **before** the `state.kind !== 'ready'` early return (stable hook order), with `state.preview.image` when ready and `undefined` otherwise. After the early return, `thumbnail = image !== undefined && image !== brokenImage ? imageSource : undefined`; `brokenImage` (the failed path, like web's `brokenImage`) is set from the image's `onError`, which hides the thumbnail. When `thumbnail` is set the `Pressable` becomes a row (`flex-row items-start gap-3`), an `expo-image` `Image` (`h-16 w-16`, `contentFit="cover"`, `shrink-0`, `rounded-[14px]` to match the card's corners) sits beside the text, and the text moves into a `min-w-0 flex-1 gap-0.5` `View`. With no image the `Pressable` keeps today's `mt-1.5 gap-0.5 rounded-[14px] px-3 py-2 active:opacity-80` and the three `Text`s are rendered as before. File is 184 lines (limit 400).
- **No tests:** UI change, as the spec says; the lead's APK check covers it.

### Files changed

- `apps/mobile/src/lib/link-preview-image.ts` (new)
- `apps/mobile/src/components/chat/link-preview-card.tsx`
- `work/T-1253-mobile-link-preview-image.md` (status + this Report)

All inside the task's Allowed files. I ran no single test file: there is no test near these UI files (`grep` over `apps/mobile/src` found no `*.test.*` referencing `link-preview`/`LinkPreviewCard`), and the spec says UI gets no tests.

### Commands run and real results

- `pnpm install`: PASS — `Done in 10.8s using pnpm v10.32.1` (one peer-dep warning for `@types/react-dom` vs `@types/react`, pre-existing).
- `pnpm gate` (first run): **GATE FAIL** — only `format` failed (`[warn] apps/mobile/src/components/chat/link-preview-card.tsx`); `scope: every changed file is inside the Allowed files`.
- `pnpm exec prettier --write apps/mobile/src/components/chat/link-preview-card.tsx`: PASS (collapsed one JSX ternary onto one line).
- `pnpm gate` (second run, final): **GATE PASS**. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (3.9s)`
  - `PASS  effect  (0.9s)`
  - `PASS  tests @zilar/mobile  (1.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Problems, deviations from the spec, open questions

1. **Thumbnail corner radius.** The spec says "rounded like the card's corners"; the card is `rounded-[14px]`, so the thumbnail uses the same `rounded-[14px]` (the web twin uses a smaller `rounded-md` on a `rounded-[10px]` card). If a smaller radius is wanted, it is a one-class change.
2. **No session / no token.** The route requires a session (T-1252), so the hook returns no source until `getSessionToken()` resolves and, like `useMediaSource`, shows nothing when the token is absent. No broken request is attempted.
3. **Mock mode.** In mock mode `handleLinkPreview` answers 204, so the card never renders and never requests the image route; unchanged from T-1252's note.
4. No new dependency, no `any`, no `@ts-ignore`, no check disabled.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (0 nits).**
- **What the lead read:** `useLinkPreviewImage` loads only paths that start with `/api/link-preview/image/`. It joins them to `API_URL`, so the bearer goes only to our API origin. The token read is interrupted on cleanup, like `useMediaSource`. The card shows a 64 px `expo-image` thumbnail, and `onError` hides it.
- **Not checked visually:** mock mode has no images, and its previews carry no `image`. The live server gives 200 `image/png` for github.com's preview image (lead's check after T-1252 deployed). Check the thumbnail on the next APK.
