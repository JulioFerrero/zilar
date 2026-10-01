---
id: T-0143
title: Mobile: stickers (see, send, panel)
status: todo
milestone: M5
branch: task/T-0143-mobile-stickers
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0120]
estimate: 1.5 days
---

# T-0143: Mobile: stickers

## Spec (written by Claude, do not edit)

### Why
Web users can already send stickers (T-0120). The mobile app does not know the `sticker` payload, so a sticker from a web user shows as a bare emoji or nothing. Mobile is the smaller share of the work (about 20%): keep it small and follow how the mobile app already does payload messages, lists, sheets, its store and its mock (`EXPO_PUBLIC_GALENA_MOCK`). Read `AGENTS.md` first, including the security checklist. Read the Spec, Report and Review of `work/T-0120-stickers.md` (and `work/T-0121-sticker-creator.md` once merged) for the wire contract.

### What to build
1. Rendering: a message whose payload is a `sticker` (validate with `StickerSchema` from `@galena/protocol`; anything invalid falls back to the body text) is shown without a bubble, at most 200 pt, with the time and ticks in a small pill, and the usual long-press menu (react, reply, pin, delete; no edit, no copy text). Only sticker URLs of the Galena API origin are ever fetched (a relative `/api/stickers/...` path is resolved against the API origin; an absolute URL of another host is never loaded: show the emoji or a placeholder). Auth headers are sent only to the API origin.
2. Panel: a sticker button in the composer opens a bottom sheet with the user's panel (`GET /api/sticker-packs`, ordered, with stickers), a pack tab row, a Recent row (kept per device in storage), and tap-to-send. Empty state when the user has no packs ("Create packs on the web for now"). Loading, error and retry states.
3. Sending: build the `sticker` payload, validate it with `StickerSchema` BEFORE the optimistic insert (a hostile or bad value never throws in the store), send in the current chat/topic through the same store path as other payload messages, optimistic bubble, failed state with Retry.
4. Mock mode: two demo packs so the flow works without a server.
5. Out of scope: creating packs, favorites, discover, GIFs (a later task), animated stickers, server or web changes.

### Read first
`AGENTS.md`, `work/T-0120-stickers.md`, `packages/protocol/src/sticker.ts`, the web `StickerMessage.tsx`, `StickerPanel.tsx`, `lib/stickers.ts` and `lib/sticker-url` tests for the rules, `apps/mobile/src/components/chat/message-list.tsx`, the composer and the real store.

### Allowed files
`apps/mobile/**`, `work/T-0143-mobile-stickers.md`. Not allowed: server, web, packages (if a shared type must change, say so in the Report and stop), dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

## Review (written by Claude)
