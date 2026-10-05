---
id: T-0143
title: Mobile: stickers (see, send, panel)
status: merged
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
Web users can already send stickers (T-0120). The mobile app does not know the `sticker` payload, so a sticker from a web user shows as a bare emoji or nothing. Mobile is the smaller share of the work (about 20%): keep it small and follow how the mobile app already does payload messages, lists, sheets, its store and its mock (`EXPO_PUBLIC_ZILAR_MOCK`). Read `AGENTS.md` first, including the security checklist. Read the Spec, Report and Review of `work/T-0120-stickers.md` (and `work/T-0121-sticker-creator.md` once merged) for the wire contract.

### What to build
1. Rendering: a message whose payload is a `sticker` (validate with `StickerSchema` from `@zilar/protocol`; anything invalid falls back to the body text) is shown without a bubble, at most 200 pt, with the time and ticks in a small pill, and the usual long-press menu (react, reply, pin, delete; no edit, no copy text). Only sticker URLs of the Zilar API origin are ever fetched (a relative `/api/stickers/...` path is resolved against the API origin; an absolute URL of another host is never loaded: show the emoji or a placeholder). Auth headers are sent only to the API origin.
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
pnpm --filter @zilar/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`. Say in the Report what still needs a device look.

## Report (written by the worker)

### What I did
- Rendering: `stickerOf()` in `payload-card.tsx` validates `card` with `StickerSchema` (invalid falls back to body text). New `StickerMessage.tsx`: no bubble, max 200 pt, time+ticks pill, emoji/🙂 placeholder. Same-origin gate in `lib/stickers.ts` (`isSameOriginStickerUrl`: relative `/api/stickers/…/file` or same-origin absolute; other hosts/`data:`/blank never loaded). Bearer token rides the `Image` source only to the API origin. Bubble long-press menu kept (react/reply/pin/delete; no edit, no copy since stickers carry no editable text); failed stickers show Retry via `onRetrySticker` plumbed through `MessageList`.
- Panel: `StickerPanel.tsx` bottom sheet with pack tab row (Recent first), sticker grid, tap-to-send, loading/error+Retry/empty ("Create packs on the web for now") states. Pure view; composer owns loads. Hostile recents render the emoji tile, never an `<Image>`.
- Sending: `sendSticker`/`retrySticker` on both stores (`store/types.ts`), validated with `StickerSchema` BEFORE the optimistic insert (hostile value → visible `actionError`, no bubble). Same XMPP payload path; sticker-scoped echo signature (`chat|body|reply|sticker:id`) so two quick same-emoji stickers link their own server ids. Real store maps incoming sticker payloads onto `card`; failed sends get `failed: true` + Retry. Mock store sends demo stickers optimistically (sent→read timers).
- Mock mode: `mock/stickers.ts` — two demo packs (Cats, Moods) with relative file URLs passing `StickerSchema`; chat screen passes them as `demoPacks` when `NODE_ENV=test` or `EXPO_PUBLIC_ZILAR_MOCK=1`.
- Recents: `lib/stickers-storage.ts` — in-memory backend behind `RECENTS_STORAGE` (hostile data reads empty, failing writes never break sending). Documented that a persisted per-device store is a later task.
- Deletions of `card` on retraction unchanged (shared `withEdits` path drops `card` already).

### Files changed
- New: `apps/mobile/src/lib/stickers.ts` (+ test), `lib/stickers-api.ts` (+ test), `lib/stickers-storage.ts` (+ test), `components/chat/sticker-message.tsx` (+ test), `components/chat/sticker-panel.tsx` (+ test), `components/chat/payload-card.test.ts`, `components/chat/message-bubble-stickers.test.tsx`, `mock/stickers.ts` (+ test)
- Edited: `components/chat/payload-card.tsx` (`stickerOf`), `message-bubble.tsx` (sticker branch + Retry + menu rules), `message-list.tsx` (`onRetrySticker`), `composer.tsx` (sticker button + sheet wiring), `app/chat/[id].tsx` (send/retry/demo packs), `store/types.ts` (`sendSticker`/`retrySticker`/`SendStickerChoice`), `store/real-store.ts`, `store/chat-store.ts`, tests in both stores, `work/T-0143-mobile-stickers.md`

### Commands run and real results
- `pnpm install`: ok
- `pnpm format:check`: pass
- `pnpm lint` (oxlint): pass (fixed `set-state-in-effect` by moving the panel load to the button press; fixed unused import)
- `pnpm --filter @zilar/mobile typecheck`: pass
- Touched + neighbours (`--maxWorkers=2`): 9 files, 126 passed (stickers lib/api/storage, mock stickers, both store suites incl. 5 new real-store + 2 new mock-store sticker tests, panel/message/payload render tests)
- Neighbour suites: `pins-api`/`chat-api`/bubble/composer/types — 3 files, 22 passed; all other real-store suites + integration — 44 passed, 1 skipped
- Post-review re-run (`--maxWorkers=2`): 9 files, 134 passed (new: `resolveActivePackId` ×3, recents dims + old-format fallback ×2, panel default/stale-tab ×2, broken-tile label test)
- Post-review round 2 (`--maxWorkers=2`): 10 files, 144 passed (new: retry/echo single-bubble, error-clear ×2, malformed-pack drop, off-origin no-headers, bubble sticker branch ×5)
- Neighbour suites: `store/types`, `chat-api`, `pins-api` — 3 files, 22 passed

### Pre-review fixes round 1 (PREREVIEW.md at 4fe174f, all four findings fixed)
1. **Empty state**: `resolveActivePackId()` in `lib/stickers.ts` — keeps the current tab while its pack exists, defaults to the first pack when the user has packs but no recents, resets a stale tab (pack deleted on web) to Recent/first-pack. Composer's `loadPanel` also resets `activePackId` state after each load. "Create packs on the web for now" now shows only when the user has no packs AND no recents; a selected-but-empty tab shows "No stickers here yet." Tests: panel renders first-pack stickers with no recents; stale tab resolves to Recent content.
2. **Recents keep dimensions**: `RecentStickerEntry` gains `width`/`height`/`mime`; `persistRecent` stores them and `recentChoiceFor` puts the real values on the wire (non-square covered by a 300×200 test). Storage format change tolerates old entries: missing/out-of-range dims fall back to a 200 square + `image/png` instead of dropping the recent (send path still validates with `StickerSchema`).
3. **Dead code (CORRECTION — round 1 Report was inaccurate)**: round 1 only renamed `loadRecents(read)` to `loadRecents()` and switched the composer to `readStoredRecents()`; the `loadRecents` export itself was NOT deleted and still has zero callers. It is deleted in round 2 below (finding 5).
4. **Nit**: render test asserting the trusted branch (`<Image>` + label) and that the broken-tile path renders the same-label emoji tile (hostile URL shows it from the start); the animated `onError` swap itself still needs the device look.

### Pre-review fixes round 2 (PREREVIEW.md at d014c1c, all six findings + nits fixed)
1. **Must — retry/echo duplicate**: `retrySticker` now enqueues `messageId` under the sticker signature before `runStickerSend`, so the echo reconciles with the retried bubble instead of appending a second one. Test: fail → retry → emit echo → exactly one bubble with the server id.
2. **Stale error banner**: both stores clear this chat's `actionError` on a later validated send (real: send + retry paths; mock: send + retry paths). Tests in both store suites.
3. **Hostile tap persisted**: composer's `pickSticker` validates with `StickerSchema` BEFORE `persistRecent` — an invalid choice reaches the store (which shows the error) but is never written to Recents.
4. **Malformed pack**: `listStickerPacks` drops one bad pack and keeps the rest (like sticker rows); test renamed to say what it does ("drops one malformed pack and keeps the rest").
5. **Dead code, for real this time**: deleted the zero-caller `loadRecents()` export and its now-unused `readStoredRecents` import in `sticker-panel.tsx`. `RecentsStorage` type stays (used by `persistRecent`); `RECENT_STICKERS_KEY` stays (used by its test as the storage-key contract).
6. **Bubble tests**: new `message-bubble-stickers.test.tsx` (rendered via `react-dom/server`, all transitive native importers stubbed): sticker renders without Retry when sending; failed sticker shows Retry; menu has no Edit and no Copy for stickers (incoming and own), while a plain text message keeps both.
- **Nits**: mock `retrySticker` clears `failed` (via `clearMockFailure`); broken-tile test comment now states exactly what is pinned (tile the `onError` swap lands on; swap itself needs a device look); `payload-card.test.ts` comment corrected (hostile URL parses, renders the emoji tile — gate is at render); passthrough `vi.mock('@/lib/stickers')` removed from `sticker-panel.test.tsx`; `stickerImageSource` returns no auth headers for an off-origin URL even if a future caller forgets the gate (tested).

### Problems, deviations from the spec, open questions
- Deviation: Recents are kept in an in-memory per-device store, not persisted across restarts (no AsyncStorage dependency allowed; SecureStore is token-only). Session-long recents work in mock and real mode; a persisted device store needs a later task + a storage dependency decision.
- Deviation: outgoing sticker URL is relative (`/api/stickers/…/file`), like web — resolves against the API origin at render.
- No `any`, no `@ts-ignore`, no lint disables; prettier re-run after last edit.
- Needs a device look (per spec, no simulators started): sticker grid layout in the sheet, 200 pt render + pill overlay, Retry row, empty/loading/error states, mock-mode demo flow.

### Blocked / needs a decision
- None.

### Security checklist (AGENTS.md)
- No secrets/tokens in logs/errors: bearer token only in the `Image` source headers to the matched API origin, never logged.
- Same-origin gate enforced at render (`StickerMessage`), panel thumbnails (`isPanelStickerUrl`), and image source construction; hostile URLs show emoji/placeholder.
- `StickerSchema` validation before every optimistic insert (both stores) and on retry; invalid inbound payloads fall back to body text.
- No new routes (only `GET /api/sticker-packs` via existing session bearer auth); no audit/message-text capture.

## Review (written by Claude)

**Verdict:** approved, merged after three rounds. Mobile only, no schema.

### Findings
- Round fixes verified in the packets: empty-state copy and stale pack tab, recents keep real dimensions (old entries tolerated), retry-then-echo no longer duplicates the bubble, a later successful send clears the stale error, hostile choices are validated before they reach Recents, one malformed pack row no longer fails the whole panel, same-origin gate asserted inside `stickerImageSource` before the bearer token is attached.
- Lead fixes at merge: the sticker grid is now a `ScrollView` (large packs were clipped and unreachable; test added); the new `demoPacks` `useMemo` sat after the `if (!chat)` early return in `chat/[id].tsx`, a rules-of-hooks violation that `hooks-guard.test.ts` caught and neither the worker nor the pre-review ran: moved above the early return.
- Process note: the worker ran only touched-file tests, so a guard test elsewhere failed; the lead's per-batch full suite (or running neighbours) is what catches this class.
- Needs a device look: sticker panel on the emulator, broken-image tile, retry flow.

### Follow-ups
- GIF rendering and picker on mobile (T-0122 is merged).
