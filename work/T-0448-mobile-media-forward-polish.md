---
id: T-0448
title: "Mobile polish: media grid only draws real images, unique row keys, invalid dates dropped; no swipe-to-reply while selecting; Forward never opens an empty sheet"
status: merged
milestone: M5
branch: task/T-0448-mobile-media-forward-polish
model: auto
effort: low
depends_on: [T-0436, T-0445]
estimate: 0.2 day
---

# T-0448: mobile polish (media sheet and multi-select)

## Spec (written by Claude, do not edit)

### Why
These are the pre-review nits of T-0436 (media sheet) and T-0445 (multi-select), kept for one small pass.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/media-sheet.tsx`:**
  - `rowKey(item)` at lines 56-58 returns `` `${item.messageId}:${item.linkUrl ?? item.kind}` ``. One message that links the same URL twice gives two equal keys. It is used at lines 154, 157, 188, 196 and 198, inside `items.map((item) => …)` callbacks.
  - The grid (lines 150-168) renders `<Image source={{ uri: item.url }} …>` for **any** item with a `url`. That includes the mock's `gradient:` URIs and non-image kinds.
- **`apps/mobile/src/lib/media-api.ts`:** `parseMediaItem` (line 89) accepts any string `at` (lines 93-103), so `"not-a-date"` survives and later renders as `NaN.NaN.NaN`.
- **`apps/mobile/src/components/chat/swipe-to-reply.tsx`:**
  - `SwipeToReply({ color, onReply, children })` (line 36) wraps `Swipeable` from `react-native-gesture-handler/ReanimatedSwipeable` (lines 4-7), which accepts an `enabled` prop;
  - `message-bubble.tsx:404` wraps every normal row in it, so a swipe still replies while select mode is on.
- **`apps/mobile/src/app/chat/[id].tsx:313-316`:** `forwardSelected` always calls `setForwarding(selectedInOrder(...))`, even when every selected message has since been retracted (an empty list).

### What to build
1. **`media-sheet.tsx`:**
   - make every key unique by adding the map index: the map callbacks take `(item, index)`, and keys become `` `${rowKey(item)}:${index}` ``;
   - in the grid, draw the `Image` only when `item.kind` is `image` or `gif` **and** `item.url` starts with `http://` or `https://` (case-insensitive). Any other item in the grid renders as a `FileRow`.
2. **`media-api.ts`:** `parseMediaItem` returns `null` when `Number.isNaN(Date.parse(at))`.
3. **`swipe-to-reply.tsx`:** a new optional `enabled?: boolean` prop (default true), passed to `Swipeable` as `enabled`. **`message-bubble.tsx`:** pass `enabled={selecting !== true}`.
4. **`[id].tsx`:** in `forwardSelected`, compute the list first. When it is empty, only clear the selection; otherwise open the sheet as today.
5. **Tests:**
   - `media-sheet.test.tsx`:
     - a `gradient:` URL and a `file` item in the media tab render no `Image`;
     - an `https` image does render one;
     - two items with the same message id and link render without a duplicate-key warning (spy on `console.error`);
   - `media-api.test.ts`: an item with `at: "not-a-date"` is dropped;
   - **new `swipe-to-reply.test.tsx`:** `enabled={false}` reaches `Swipeable` (mock the module the way other tests in `components/chat` mock native modules).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/media-sheet.tsx:40-200`, `apps/mobile/src/components/chat/media-sheet.test.tsx`, `apps/mobile/src/lib/media-api.ts:80-130`, `apps/mobile/src/components/chat/swipe-to-reply.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:395-410`, `apps/mobile/src/app/chat/[id].tsx:305-320`.

### Allowed files
`apps/mobile/src/components/chat/media-sheet.tsx`, `apps/mobile/src/components/chat/media-sheet.test.tsx`, `apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/media-api.test.ts`, `apps/mobile/src/components/chat/swipe-to-reply.tsx`, `apps/mobile/src/components/chat/swipe-to-reply.test.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0448-mobile-media-forward-polish.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media-sheet media-api swipe-to-reply message-bubble
pnpm gate
```

### Acceptance
- The media grid shows only real image tiles, with unique keys, and drops invalid dates.
- Select mode does not swipe-to-reply, and Forward never opens an empty sheet.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review.

### What I did
- `media-sheet.tsx`: every grid/row key is now `${rowKey(item)}:${index}` (both maps take `(item, index)`). Added `isRemoteImage(item)`; the grid draws an `Image` tile only when `item.kind` is `image`/`gif` **and** `url` starts with `http://`/`https://` (case-insensitive). Every other media-tab item renders as a `FileRow`.
- `media-api.ts`: `parseMediaItem` now returns `null` when `Number.isNaN(Date.parse(at))` (checked after `isString(at)`, before building the item).
- `swipe-to-reply.tsx`: new optional `enabled?: boolean` prop (default `true`), forwarded to `Swipeable`.
- `message-bubble.tsx`: passes `enabled={selecting !== true}`.
- `[id].tsx`: `forwardSelected` computes the ordered list first, clears the selection, and only calls `setForwarding` when the list is non-empty.
- Tests: `media-sheet.test.tsx` (https image draws an `Image`; gradient url + file render no `Image`; two identical link rows render without a duplicate-key warning via a `console.error` spy on "same key"), `media-api.test.ts` (`at: "not-a-date"` dropped), new `swipe-to-reply.test.tsx` (mocks the `ReanimatedSwipeable` module and asserts `enabled: false` / default `true` reach `Swipeable`).

### Files changed
All inside the task's Allowed files:
- `apps/mobile/src/components/chat/media-sheet.tsx`
- `apps/mobile/src/components/chat/media-sheet.test.tsx`
- `apps/mobile/src/lib/media-api.ts`
- `apps/mobile/src/lib/media-api.test.ts`
- `apps/mobile/src/components/chat/swipe-to-reply.tsx`
- `apps/mobile/src/components/chat/swipe-to-reply.test.tsx` (new)
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `work/T-0448-mobile-media-forward-polish.md`

### Commands and results
- `pnpm install`: exit 0, "Done in 14.1s", 1170 packages added/reused.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media-sheet media-api swipe-to-reply message-bubble`: 6 test files passed, 32 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot swipe-to-reply` (after switching the new test to JSX): 1 file passed, 2 tests passed.
- `pnpm gate` (final): `GATE PASS`; lines:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - (`gate: 9 changed file(s) against main`)

### Deviations / notes
- Added a small `isRemoteImage(item)` helper in `media-sheet.tsx` rather than inlining the condition in the map.
- Because `isRemoteImage` does not narrow the type, the `Image` source uses `item.url ?? ''`; runtime value is always a non-empty http(s) string when that branch renders.
- The first `pnpm gate` run failed on `format` (two files) and the second on `typecheck`/`lint` in the new test; all were fixed inside the Allowed files (prettier `--write`, then JSX instead of the `children` prop). Final gate is green.

### Problems / open questions
- None. No other tests broke.

### Round (fix round, fresh session)
- **Finding 1 (should-fix) fixed.** The duplicate-key test now renders `MediaSheetContent` through the client reconciler (`react-dom/client` under jsdom), so React's duplicate-key warning can actually fire. Verified non-vacuous by temporarily reverting the `:index` key on `MediaRowList`'s `LinkRow`: the test then fails with `Encountered two children with the same key, m-1:https://example.test/a`; restoring the fix makes it pass.
  - Chose the finding's second option (client reconciler) over the first (assert both rows render): the first would still pass with duplicate keys, because the server renderer emits both children and never warns, so it would not guard the regression.
- **Finding 2 (nit) not touched.** The `enabled={selecting !== true}` wiring in `message-bubble.tsx` is left as is: no line of that file changes in this round, and the instructions say not to touch nits outside changed lines.
- Test file changed: `apps/mobile/src/components/chat/media-sheet.test.tsx` — added `// @vitest-environment jsdom`; load `react-dom/client` via `createRequire` (that module ships no types and mobile has no `@types/react-dom`, so an untyped import fails typecheck); set `IS_REACT_ACT_ENVIRONMENT`; mock `../ui/segmented-control` as a host element (the real control passes a React Native style array that `react-dom/client` rejects).
- Commands in this round:
  - `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media-sheet media-api swipe-to-reply message-bubble`: 6 files passed, 32 tests passed.
  - `pnpm gate` (repo root): `GATE PASS` — PASS install (frozen), format, lint, typecheck, tests @zilar/mobile; `scope: every changed file is inside the Allowed files`.

## Review (written by Claude)

Approved (lead, 2026-10-07) after an automatic round (the duplicate-key test now renders through the client reconciler, so it can fail). The media grid draws only http(s) image or gif tiles, keys carry the index, and invalid dates are dropped. SwipeToReply has an enabled prop that is off while selecting. Forward with an empty selection only clears it. The final pre-review is clean.
