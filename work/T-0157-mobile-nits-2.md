---
id: T-0157
title: Mobile nits bundle 2 (attachments, GIFs, roles load error)
status: review
milestone: M5
branch: task/T-0157-mobile-nits-2
model: meta/muse-spark-1.3-contributor
effort: medium
estimate: 0.5 day
---

# T-0157: Mobile nits bundle 2 (attachments, GIFs, roles load error)

## Spec (written by Claude, do not edit)

### Why
Deferred small items from the mobile reviews of T-0140, T-0143, T-0144, T-0148 and T-0150.

### What to build
1. `attachment-native.ts` and `real-store.ts`: an unknown picker size is reported as "That file is empty". Distinguish unknown from zero: unknown size means read the real size from the file (`expo-file-system`) before the cap check, and only a real zero says "That file is empty".
2. Tap-to-open file download has no size cap: cap it at the same 50 MiB, refuse with a plain message, and stop the download early (abort) when the cap is exceeded.
3. GIF panel infinite scroll can fire overlapping page loads: guard with a ref set synchronously, and test it.
4. `gifs-api.test.ts` "sends no session token cross-origin" is tautological: replace it with a test that fails if the Authorization header reaches a non-API origin (inspect the actual fetch call).
5. Caption edit for attachment messages (web has it): the mobile edit path only sends text corrections; let a long-press Edit on an attachment message edit its caption through the same correction path web uses, keeping the attachment payload, with a test.
6. A mounted-route test for the group roles load error (the screen shows the error state and a working Retry), using the existing mounted-route test pattern.
7. Search jump retries: add a test that the jump-to-message retry stops after its cap and leaves the list at the bottom instead of looping.
Report each item as done or not done.

### Read first
`AGENTS.md`, the Reviews of `work/T-0140-*.md`, `T-0147-*.md`, `T-0148-*.md`, `T-0150-*.md`.

### Allowed files
`apps/mobile/**`, `work/T-0157-mobile-nits-2.md`. Not allowed: server, web, packages, new dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 attachment gifs gif-panel real-store chat-store hooks-guard roles
```

### Acceptance
- Each item is done with a test, or listed as not done with the reason.
- hooks-guard and the neighbouring suites pass.

## Report (written by the worker when done)

### What I did (item by item)
1. **Unknown picker size (done)**: `createAttachmentPicker` takes an optional `SizeReader` (`createSizeReader`, an `expo-file-system` stat seam). `pickedFile` now distinguishes unknown (`size` and `measuredSize` both undefined → proceeds with `size: 0` on the wire shape) from a real zero (refuses with "That file is empty."). When the picker reports no size, the real size is read from the file before the cap check. Tests: stat-provided size lands on the picked file; a stat zero says "empty"; an over-cap stat refuses; an unreadable stat stays unknown (not "empty"); a reported zero never stats.
2. **Tap-to-open size cap (done)**: `createAttachmentOpener` takes an injectable `download` (default `File.downloadFileAsync`) and passes an `AbortController` signal plus an `onProgress` guard: an announced total or written bytes over 50 MiB aborts mid-download and reports "That file is larger than 50 MB." (the same line as the pick cap). Tests: announced-length refusal, mid-download abort (signal observed aborted), under-cap opens.
3. **GIF infinite-scroll guard (done)**: `loadingMoreRef` set synchronously before the append fetch starts (state only mirrors it for the spinner); the scroll handler checks `!loadingMoreRef.current`. Extracted `fetchGifPage` (trending vs search routing) for unit tests. Tests: pager routing + a source pin that the guard wiring exists (fails if the ref check is removed).
4. **Tautological cross-origin test (done)**: replaced with a test that inspects the actual fetch call — asserts the request URL origin equals the API origin AND the Authorization header rides that same call, so it fails if the token ever reaches a non-API origin.
5. **Caption edit for attachments (done)**: `MessageBubble` no longer excludes attachment messages from Edit; the mobile `editMessage` store path already sends a text-only XEP-0308 correction (body + `<replace/>`, no payload child), so the attachment payload is kept by construction — same wire shape web uses (web's composer edits the caption text; `sendCorrection` carries no payload). Tests: store-level correction sends the new caption with the payload untouched (`edited: true`, attachment equal); bubble menu gate offers Edit on an own attachment message. Note: web's `MessageBubble` currently also gates `message.attachment === undefined`, so "web has it" in the spec means the shared correction path, which both apps use identically.
6. **Mounted-route roles load error test (done)**: new `group-roles-mounted.test.tsx` renders the real `GroupRolesSheet` (the exact sheet the group screen renders) fed by the screen's exact mount-effect mapping (`describeRolesError(error, 'load')`, imported from the real modules), asserting the 404-gone vs generic lines and a working Retry affordance; plus a source pin that the mount effect maps through `describeRolesError(error, 'load')` (fails on the hardcoded-line regression), mirrored in `hooks-guard.test.ts` per the existing mounted-route pattern (source-level pins, since expo-router owns `app/` at build).
7. **Search jump retry cap (done)**: extracted `openSearchHit` (`components/chat/search-jump.ts`) — one `openAtMessage` attempt (the store pages at most `MESSAGE_JUMP_MAX_PAGES` then throws `message_not_found`), success pushes the chat, failure pushes the chat with `notFound: '1'` (bottom landing) and reports the miss. `MessageSearchList.openHit` now calls it (same behavior, no loop). Tests: landed path, give-up path (exactly one attempt, bottom landing, miss reported), cap-contract pin.

### Files changed
- `apps/mobile/src/lib/attachment-native.ts` (`SizeReader`/`createSizeReader`, unknown-vs-zero pick, opener 50 MiB cap with abort)
- `apps/mobile/src/components/chat/gif-panel.tsx` (`loadingMoreRef` guard, `fetchGifPage`)
- `apps/mobile/src/lib/gifs-api.test.ts` (non-tautological origin+header test)
- `apps/mobile/src/components/chat/message-bubble.tsx` (Edit offered on attachment messages = caption edit)
- `apps/mobile/src/components/chat/message-search-list.tsx` (uses `openSearchHit`), new `search-jump.ts`
- Tests: `attachment-native.test.ts` (+9), `gif-panel.test.tsx` (+2), `gifs-api.test.ts` (reworked), `real-store.test.ts` (+1 caption correction), `message-bubble-stickers.test.tsx` (+1 caption gate, fixed stale-date plain-text case), new `search-jump.test.ts` (+3), new `group-roles-mounted.test.tsx` (+4), `hooks-guard.test.ts` (+1 source pin)

### Commands run and real results
- `pnpm install`: pass (~10s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (oxlint): pass.
- `pnpm typecheck` (turbo, 11 tasks): pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 attachment gifs gif-panel real-store chat-store hooks-guard roles`: 29 files, 316 passed.
- Neighbours `jump-scroll message-search search-jump group-roles message-bubble composer use-message-search`: 9 files, 52 passed.
- No `any`/`@ts-ignore`/disable comments in touched non-test source; no simulators/Metro/`expo run` started.
- Deviation from spec item 6: "mounted-route test" uses the repo's established mounted-route pattern (render the real route-owned sheet + source pin on the call site) rather than mounting the expo-router route itself, because routes under `src/app` cannot be imported in Node tests (Metro owns them at build; `hooks-guard.ts` documents this). The pin fails if the screen regresses to the hardcoded line.

### Problems, deviations, open questions
- Web parity note (item 5): web's `MessageBubble` also hides Edit for attachments today; the shared correction path (body + `<replace/>`, no payload) is what both apps use, and the mobile store path needed no change. If the lead wants web's menu gate flipped too, that's a web task.
- Security checklist: bearer rides only to the API origin (opener + GIF paths unchanged); no new logging (queries never logged); no new routes; caps enforced before requests (pick + open); correction keeps the same author/target rules; audit carries ids only.
- Still needs a device look (no simulator run): unknown-size photo pick, over-cap tap-to-open refusal, GIF scroll under load, caption edit round-trip against a real server, roles sheet gone-line on a deleted group, search-jump miss landing.

## Review (written by Claude)
