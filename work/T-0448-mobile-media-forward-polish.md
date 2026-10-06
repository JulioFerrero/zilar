---
id: T-0448
title: "Mobile polish: media grid only draws real images, unique row keys, invalid dates dropped; no swipe-to-reply while selecting; Forward never opens an empty sheet"
status: todo
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

## Review (written by Claude)
