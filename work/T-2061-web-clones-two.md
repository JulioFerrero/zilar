---
id: T-2061
title: "Reduce (web, batch 2): one response reader in lib/api/http.ts, one field wrapper in ui/text-input.tsx, one Pinned/Media menu pair in ChatHeader, and one preview line + unread badge shared by ChatListItem and TopicRow — same UI"
status: merged
milestone: M5
branch: task/T-2061-web-clones-two
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2061: Web clones, batch 2

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd run (2026-10-18) found four more web blocks written twice.

### Facts (read by the lead on 2026-10-18 at `7f39c3adf`)
1. **`apps/web/src/lib/api/http.ts`** (114 lines). Two request functions end the same way (`:51-64` and `:101-114`):
   - read the JSON body, or null;
   - a non-OK status throws `apiErrorFromBody(response.status, raw)`;
   - then `decodeResponse(schema, raw)`, where a failure throws `ApiError(status, 'invalid_response', 'The server sent an unexpected response')`;
   - then return `parsed.value`.
2. **`apps/web/src/components/ui/text-input.tsx`** (201 lines). Two inputs end the same way (`:97-115` and `:185-201`): return the bare field when there is no label, hint or counter; otherwise wrap it in `<Field>` with the `length/max` counter line.
3. **`apps/web/src/components/ChatHeader.tsx`** (391 lines). The menu items "Pinned messages" (`Bookmark`, `setPinsPanel(chat.id)`) and "Media, files and links" (`Images`, `onOpenMedia?.()`), each closing the menu first, are written twice (`:249-266` and `:306-323`).
4. **The chat rows.** `apps/web/src/components/ChatListItem.tsx:166-188` (208 lines) and `apps/web/src/components/TopicRow.tsx:172-189` (203 lines) render the same preview line: the kind icon, the coloured prefix and the truncated body, then `<Badge count={chat.unread} muted={chat.muted} labelSuffix="unread" className="ml-auto shrink-0" />` when unread.

### Steps
1. **`http.ts`.** Add a local `readResponse(response, schema)`, used by both functions.
2. **`text-input.tsx`.** Add a local `withField(field, { fieldId, label, hint, invalid, counter, length })`, used by both inputs.
3. **`ChatHeader.tsx`.** Add a local `PinsAndMediaItems({ chatId, onOpenMedia, close })`, or a fragment helper, used in both menus. Order and labels stay the same.
4. **The preview line.** Create `apps/web/src/components/chatList/PreviewLine.tsx`, exporting `PreviewLine({ KindIcon, prefix, body })`. Use it in both rows, and keep each row's own typing line and trailing parts (the unread mark dot, own ticks) as they are.
5. **No tests** (UI). Report the line counts; product lines must drop by at least 40. Each file stays at or under 400 lines.

### Allowed files
- `apps/web/src/lib/api/http.ts`
- `apps/web/src/components/ui/text-input.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/chatList/PreviewLine.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `work/T-2061-web-clones-two.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines are at least 40 lower.
- **Lead check, web mock:**
  - the chat list and topic rows look the same;
  - the header menu shows Pinned messages and "Media, files and links";
  - a form with a counter (Edit profile bio) shows the counter.

---

## Report (written by the worker when done)

### What I did

- **`lib/api/http.ts`:** added a local `readResponse(response, schema)` (JSON body or null, `apiErrorFromBody` on a non-OK status, `decodeResponse`, `ApiError('invalid_response')`); `request` and `uploadBytes` now end with `return readResponse(response, schema)`. The fixed sentence lives in one `INVALID_RESPONSE` constant.
- **`ui/text-input.tsx`:** added a local `withField(field, { fieldId, label, hint, invalid, counter, length })` (bare field when there is no label, hint or counter; otherwise `<Field>` plus the `length/max` line). `TextInput` and `TextArea` both use it.
- **`ChatHeader.tsx`:** added the local `PinsAndMediaItems({ chatId, onOpenMedia, close })` (`Pinned messages` with `Bookmark`, `Media, files and links` with `Images`, both closing the menu first). I also flattened the topic/non-topic menu ternary into one item list with `isTopic &&` slots: the shared tail (pins/media, Chat background, `ChatPrefMenuItems`) was written twice, and the pair extraction alone saved almost nothing in lines. Order, labels and actions are the same; the only merge of the two `onDone` callbacks is `!failed && closeMenu()`, which is what both did.
- **Rows:** new `chatList/PreviewLine.tsx` exporting `PreviewLine({ KindIcon, prefix, body })`; `ChatListItem` and `TopicRow` use it, and each keeps its own typing line and trailing parts (unread badge, mark dot, own ticks).

**Line counts** (product files):

| file | before | after |
| --- | --- | --- |
| `lib/api/http.ts` | 114 | 104 |
| `ui/text-input.tsx` | 201 | 196 |
| `ChatHeader.tsx` | 391 | 364 |
| `ChatListItem.tsx` | 208 | 201 |
| `TopicRow.tsx` | 203 | 196 |
| `chatList/PreviewLine.tsx` | — | 16 |

Total 1117 → 1077, net **−40** (`git diff --numstat` against `main`: +138 / −178). Every file is under 400 lines; `ChatHeader.tsx` is 364.

### Checks run

Single test file (the API code near `http.ts`):

```
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api/sessionGone.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

`pnpm gate` from the repo root:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (10.7s)
PASS  format  (6.1s)
PASS  lint  (2.3s)
PASS  typecheck  (8.4s)
PASS  effect  (3.2s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/web  (16.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation, on purpose:** the spec's step 3 asked only for `PinsAndMediaItems` used in both menus. I did that, then merged the two menu fragments (topic and non-topic) so the shared tail exists once, because the pair extraction by itself left the file at 389 lines (−2). No item was added, removed or reordered: group info, Topic info (topics only), Pinned messages, Media, Search (topics only), Chat background, chat preferences / archive.
- `http.ts` keeps the same message text, now through one constant; error mapping and statuses are unchanged.
- Not verified in a browser: the web mock check (chat rows, header menu, Edit profile bio counter) is your check, as the spec says.
- No tests added (UI), no new dependencies.

## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.** `readResponse` in `http.ts`, `withField` in `text-input`, `PinsAndMediaItems` in `ChatHeader`, and one `PreviewLine` for chat and topic rows.
- **Size.** −40 product lines.
- **Lead Playwright check** (web mock, :5198):
  - the chat list and topic rows look the same;
  - Ana's menu reads Pinned messages, "Media, files and links", Chat background, and so on;
  - General's menu reads Group info, Topic info, Pinned messages, Media, Search, and so on;
  - no console errors.
- The `TextInput` counter appears only in Cosmos fixtures, so there is no product screen to check.
