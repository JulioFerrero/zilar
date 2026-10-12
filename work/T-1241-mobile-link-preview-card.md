---
id: T-1241
title: "TG-3 mobile: a link preview card under a human text message's first https link (site name, bold title, two-line description; tap opens the link), fetched from the T-1234 route with a module cache; plus the contacts deep link"
status: merged
milestone: M5
branch: task/T-1241-mobile-link-preview-card
model: auto
effort: default
depends_on: [T-1234]
estimate: 0.3 day
---

# T-1241: Link previews on mobile

## Spec (written by Claude, do not edit)

### Why
It's item 3 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4). T-1234 (merged) added the server route and the web card; mobile must match the web.
- **The contract:** the `link-preview.ts` group in `packages/api-contract/src/link-preview.ts`.
- **The web client:** the call with its module cache and in-flight dedupe (`apps/web/src/lib/api/media.ts:108-150`) and the card (`apps/web/src/components/message/LinkPreviewCard.tsx`).
- **The mobile bubble:** a human text bubble renders through `PlainBubbleBody` (`apps/mobile/src/components/chat/message-bubble-content.tsx:238`), and that file is **at 400 lines**.

### What to build
1. **Client call:** add `linkPreview(url)` to the mobile chat API (`apps/mobile/src/lib/chat-api.ts`, next to `getContacts`, `:181`) through the typed client. A 204 is `null`.
   - **Mock mode:** if the mock backend has no route, add one to `packages/mock-backend/src/domains/media/` that answers 204, so mock mode logs no errors.
2. **The new `apps/mobile/src/components/chat/link-preview-card.tsx`:**
   - **What it shows:** the site name (muted, small), the title (`Geist_600SemiBold`, one line), and the description (two lines), in a `well`-style box with the bubble's radius, and no image.
   - **What it does:** tapping it opens the URL with `Linking.openURL`, the same way `link-text.tsx` opens links (cite it).
   - **Fetching:** a module-level `Map` cache and in-flight dedupe, as on the web, so list re-renders don't refetch. Nothing renders while loading or for `null`.
   - **Theme:** colours from `@/lib/colors`, the same in outgoing and incoming bubbles (as on the web: check `LinkPreviewCard.tsx`).
3. **Mount it** for a human text message that has an https link (the first one, from `splitLinks` in `packages/chat-core/src/links.ts:60`, as on the web) and no image or attachment, below the text.
   - **`message-bubble-content.tsx` must stay at most 400 lines.** Move `PlainBubbleBody` (`:238-324`) into a new `apps/mobile/src/components/chat/plain-bubble-body.tsx` and mount the card there. Cite the move.
4. **Deep link** (T-1237's follow-up): add `'contacts'` to `SETTINGS_PAGES` (`apps/mobile/src/lib/web-link.ts:16-26`).
5. **No tests** (UI).

### Read first
`AGENTS.md`, `work/T-1234-link-previews-server-web.md` (the Report and the Review), `apps/web/src/components/message/LinkPreviewCard.tsx`, `apps/web/src/lib/api/media.ts`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/link-text.tsx`, `apps/mobile/src/lib/chat-api.ts` and `apps/mobile/src/lib/web-link.ts`.

### Allowed files
`apps/mobile/src/components/chat/link-preview-card.tsx`, `apps/mobile/src/components/chat/plain-bubble-body.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/lib/web-link.ts`, `packages/mock-backend/src/domains/media/**`, `work/T-1241-mobile-link-preview-card.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):** a text bubble with an https link renders unchanged with no card when the mock answers 204, and formatting and links still work. The card itself is checked live after deploy.

---

## Report (written by the worker when done)

### What I did

- **Client call (`chat-api.ts`):** added `LinkPreview` (= the contract's type, re-exported) and an **optional** `linkPreview?(url): Promise<LinkPreview | null>` to `ChatApi`, implemented in `createChatApi` next to `getContacts` as `runApi(client.linkPreview.get({ query: { url } })).then((value) => value ?? null)`, so a 204 (no body) is `null`, exactly like web's `apps/web/src/lib/api/media.ts:120-141`. It is optional for the same reason `markChatRead` is: the store/port test fakes build `ChatApi` literals and are not in the Allowed files.
- **Mock mode (`packages/mock-backend/src/domains/media/`):** new `link-preview.ts` answers `204 No Content` (the shared `noContent()` helper) for `GET /link-preview`; `index.ts` composes it after the gallery handler. This mirrors the server, which mounts the route in the media API module (T-1234), and means mock mode serves the call instead of 404ing.
- **New card (`apps/mobile/src/components/chat/link-preview-card.tsx`):** renders nothing while loading or for `null`; otherwise a `well`-style box (`round-[14px]`, the bubble radius from `message-bubble.tsx:274`) with the site name (muted, `text-[11px] uppercase`) and the title (`font-semibold` → `Geist_600SemiBold` per `tailwind.config.js:74`, one line) and the description (`MUTED_FOREGROUND`, two lines). No image. Colours are `FOREGROUND`/`MUTED_FOREGROUND` from `@/lib/colors` via the shared `Text`'s `color` prop. Tapping opens the URL with `Linking.openURL` through `safeLinkTarget`, the same as `link-text.tsx:79-84`.
  - Fetching uses a module-level `Map` cache and in-flight dedupe, the rule of web's `linkPreview`; a hit is kept for the session, a miss shares one call, and a failure shows no card and is not cached.
  - The card builds its api with a small local hook mirroring `use-contacts-api.ts` (the `?mock=` param + `EXPO_PUBLIC_ZILAR_MOCK` gate, `mockFetch` in mock mode), so no card test or store wiring was needed and the api call is correct in a mock build.
- **Mount (`plain-bubble-body.tsx` + `message-bubble-content.tsx`):** moved `PlainBubbleBody` into the new `plain-bubble-body.tsx` and mount `<LinkPreviewCard url={url} />` below the text in both branches, where `url` is the first `https` link from `splitLinks` (`previewUrl`, copied from web `MessageTextBody.tsx:18-28`, skipped when the message has an image or an attachment). `message-bubble-content.tsx` is now 248 lines (was 400) and renders `PlainBubbleBody` from the new file.
- **Deep link (`web-link.ts`):** added `'contacts'` to `SETTINGS_PAGES` (the `/settings/contacts` route exists, and it is in `settings-items.ts:89-93`).
- **No tests** (UI), per the spec.

### Files changed

- `apps/mobile/src/components/chat/link-preview-card.tsx` (new, 147 lines)
- `apps/mobile/src/components/chat/plain-bubble-body.tsx` (new, 187 lines)
- `apps/mobile/src/components/chat/message-bubble-content.tsx` (248 lines)
- `apps/mobile/src/lib/chat-api.ts` (212 lines)
- `apps/mobile/src/lib/web-link.ts` (108 lines)
- `packages/mock-backend/src/domains/media/link-preview.ts` (new, 15 lines)
- `packages/mock-backend/src/domains/media/index.ts` (9 lines)
- `work/T-1241-mobile-link-preview-card.md` (status + this Report)

All inside the task's Allowed files; every touched file is well under 400 lines.

### Commands run and real results

- `pnpm install`: PASS ("Done in 13.2s using pnpm v10.32.1").
- `pnpm exec prettier --write <the 7 code files>`: PASS — only `link-preview-card.tsx` was reformatted (`useMemo` collapsed to one line), the rest "unchanged". (Done so the gate's `--check` step would pass without a full `pnpm format`.)
- `pnpm gate` (from the repo root, once, at the end): **GATE PASS**. Summary lines:
  - `gate: 8 changed file(s) against main`
  - `PASS  install (frozen)  (1.6s)`
  - `PASS  format  (0.5s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (4.8s)`
  - `PASS  effect  (1.8s)`
  - `PASS  tests @zilar/mobile  (1.8s)`
  - `SKIP tests @zilar/mock-backend (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`
- Single test files run while working: **none** — the change is UI/plumbing and adds no tests; the gate ran the mobile package's nearby tests (`tests @zilar/mobile`, 1.8s, PASS).

### Problems, deviations from the spec, open questions

1. **`BubbleInlineMeta` moved too.** The spec says move `PlainBubbleBody` only. `BubbleInlineMeta` is used by both the moved plain body and the markdown branch that stayed in `message-bubble-content.tsx`; importing it back from there would make the two files a cycle. I moved it into `plain-bubble-body.tsx` as well, so the dependency is one-way. If you would rather not have the shared meta in the plain file, say so and I will split differently.
2. **`linkPreview` is optional on `ChatApi`.** A required method would break the `ChatApi` literals in `apps/mobile/src/store/*.test.ts` (not in Allowed files). Optional is the `markChatRead` precedent and the card treats a missing method as `null`.
3. **The card builds its own api.** `MessageBubble` and `MessageBubbleContent` (the only callers) are not in Allowed files and there is no api on the store state, so the card builds a `ChatApi` with a local mock-aware hook (like `approval-card.tsx` → `use-approvals-api.ts`). I could not add a `use-link-preview-api.ts` file (not Allowed), so the hook lives in the card.
4. **Not run on a device.** The spec's acceptance is your emulator check. I verified the mock route by reading/typechecking only; I did not run the app, so the "no card on 204, text unchanged" behaviour is reasoned, not observed.
5. **Only the first https link** is previewed, matching web.

### Security checklist

- No secrets or tokens logged; the card logs nothing. The URL is only sent to our own `/api/link-preview` and opened through `safeLinkTarget` (which rejects non-http(s) schemes), the same guard as `link-text.tsx`.
- No server change, so no new route/ rate-limit/ scope concerns. `Linking.openURL` is user-initiated (a tap).

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 nits).**
- **The change:**
  - `PlainBubbleBody` moved to `plain-bubble-body.tsx`, so `message-bubble-content.tsx` went from 400 to 248 lines;
  - `link-preview-card.tsx` has a module cache and in-flight dedupe, and taps open the link;
  - `linkPreview` is in the mobile chat API, the mock answers 204, and `contacts` is in `SETTINGS_PAGES`.
- **Lead's emulator check (mock build of this branch, `SMOKE PASS`):** "see **this** https://example.com" sent in Marta's DM shows **this** bold and the link underlined, and no card appears, because the mock answers 204. The move broke nothing visible.
- **Not checked:** the card itself, against the live server. I'll do it on the next APK.
