---
id: T-2039
title: "Reduce (web): three in-app copies become one each — LinkText's renderPlain/renderFormatted share one mention+link segment renderer, AttachmentBody's three 'send failed / upload failed / meta' footers become one component, and ChatListItem + TopicRow share one row-actions button+menu — same look and behaviour, fewer lines"
status: merged
milestone: M5
branch: task/T-2039-web-clone-cleanup
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2039: Web clone clean-up (reduce-scan clusters #7, #15 and #35)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code and share components. `docs/audit/reduce-scan.md` §1 found three blocks copied inside web. This is web UI, so there are no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18 at `f85ce3a1b`)
- **LinkText.** `apps/web/src/components/LinkText.tsx` (163 lines). `renderPlain` (`:60-103`) and `renderFormatted` (`:105-…`) are the same mention-and-link mapping:
  - a `mention-me` pill for your own mentions;
  - a `PersonLink` with a `mention-chip` for others;
  - an `<a target="_blank" rel="noopener noreferrer">` for links.

  They differ only in the plain-text leaf: `renderPlain` renders `<span>{text}</span>`, while `renderFormatted` maps `parseLightInline(text)` to `<strong>` and the other styles.
- **AttachmentBody.** `apps/web/src/components/message/AttachmentBody.tsx` (382 lines). The image block (`:169-…`) and the gif block (`:262-286`), plus one more (`:252-258`), repeat the same footer:
  - a `SendFailure` with `onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}` when `sendFailed`;
  - otherwise an "Upload failed" + "Retry" row when `failed`;
  - otherwise `imageOnly && <MediaMetaPill message={message} showTicks={own} />`.
- **The list rows.** `apps/web/src/components/ChatListItem.tsx:211-232` (233 lines) and `apps/web/src/components/TopicRow.tsx:202-223` (224 lines) end with the identical "Chat actions for …" `Button` (`MoreHorizontal`, the same classes, `isWide` right offset) and `{menuOpen && <ChatActionsMenu chat={chat} onClose=…/>}`.

### Steps
1. **LinkText.** Make one `renderSegments(text, mentions, meJid, keyPrefix, renderText: (text, key) => ReactNode)`. `renderPlain` and `renderFormatted` call it with their own leaf renderer. Keys and class names stay the same.
2. **AttachmentBody.** Make one local `AttachmentFooter({ sendFailed, failed, imageOnly, own, chat, message })` that renders the three-way branch. Use it in every place that repeats it; keep each place's wrapper `div` if its padding differs.
3. **The list rows.** Add `apps/web/src/components/chatList/RowActions.tsx` with `RowActions({ chat, isWide, menuOpen, setMenuOpen })`, which renders the button and `ChatActionsMenu`. `ChatListItem.tsx` and `TopicRow.tsx` use it. Check with `ls apps/web/src/components/chatList/` that the folder exists; if it doesn't, put the file next to `ChatListItem.tsx`.
4. **Same pixels and the same accessible names:** `aria-label`, `aria-haspopup` and `aria-expanded`.
5. **Size.** Report the before and after line counts of the four files plus the new one. The total must drop by **at least 60**. No tests (UI).

### Allowed files
- `apps/web/src/components/LinkText.tsx`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/chatList/RowActions.tsx`
- `apps/web/src/components/RowActions.tsx`
- `work/T-2039-web-clone-cleanup.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the total drops by at least 60 lines.
- **Lead Playwright check, web mock:**
  - mentions and links render in a message;
  - a failed upload shows Retry;
  - hovering a chat-list row and a topic row shows the actions button, and its menu opens.

---

## Report (written by the worker when done)

### What I did

- **LinkText** (`apps/web/src/components/LinkText.tsx`): `renderPlain` and `renderFormatted` are now one `renderSegments(text, mentions, meJid, keyPrefix, renderText)`. Both paths call it with their own leaf renderer: a plain `<span>` and `renderFormattedLeaf` (`parseLightInline` → `<strong>`/`<em>`/`<code>`/`<span>`). Mention pills, `PersonLink` chips, link `<a>`s, keys and class names are unchanged.
- **AttachmentBody** (`apps/web/src/components/message/AttachmentBody.tsx`): one local `AttachmentFooter` renders the three-way branch (not-sent `SendFailure`, "Upload failed" + Retry, or `MediaMetaPill`). It is used by the image, inline-video, file-card and gif blocks. The album branch was left alone (it puts the meta pill inside the clipped frame and has no legacy-failed row). The shared props are passed as one `footer` object so call sites stay one line.
- **Row actions** (`apps/web/src/components/chatList/RowActions.tsx`, new; the folder already existed): `RowActions({ chat, isWide, menuOpen, setMenuOpen })` holds the hover button and `ChatActionsMenu`. `ChatListItem.tsx` and `TopicRow.tsx` use it and dropped their now-unused imports. The `aria-label` (`Chat actions for …`), `aria-haspopup`, `aria-expanded`, classes and the wide/narrow right offset are byte-for-byte the same.

Line counts (before → after):

| File | Before | After |
| --- | --- | --- |
| `LinkText.tsx` | 163 | 127 |
| `message/AttachmentBody.tsx` | 382 | 358 |
| `ChatListItem.tsx` | 233 | 212 |
| `TopicRow.tsx` | 224 | 203 |
| `chatList/RowActions.tsx` (new) | – | 40 |
| **Total** | **1002** | **940** |

Total drop: **62 lines** (target ≥ 60).

### Checks run

- `pnpm gate` from the repo root (after `pnpm install`), last lines:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen) (6.4s)`
  - `PASS format (1.6s)`
  - `PASS lint (1.1s)`
  - `PASS typecheck (7.0s)`
  - `PASS effect (1.4s)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No tests were run separately: this is UI, the task says no tests, and the gate reports no nearby web test files.

### Notes for the lead

- **Deviations from the literal spec, all to keep behaviour identical:**
  - The meta prop is `showMeta`, not `imageOnly`. The inline-video block shows the pill when `!hasText`, and `imageOnly` is false for video attachments (`bubbleFlags.ts:89-94`), so passing `imageOnly` there would have dropped the video's meta pill. Image and gif calls still pass `imageOnly`; video passes `!hasText`.
  - The file card's `SendFailure` sits in a `px-3 py-1.5` parent, so the footer takes `sendFailurePadding` (default `px-3`, `px-0` for the file card) to avoid doubling the inset. That card also has no legacy "Upload failed" row (`FileMessage` renders its own retry), so `failed` is a separate prop defaulting to `false` and only the media blocks pass it.
  - `LinkText`'s plain path returns the segment array directly instead of wrapping it in a fragment (React 19 accepts `ReactNode` returns). Rendered DOM is the same: same elements, same keys.
- No dependency, route, migration or security surface was touched.
- I did not run Playwright; the lead's web-mock check still needs to confirm mentions/links, failed-upload Retry, and the row menus.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.**
  - `LinkText` renders mentions and links through one segment renderer.
  - `AttachmentBody` has one footer for send failed, upload failed and the meta pill.
  - `ChatListItem` and `TopicRow` share `chatList/RowActions.tsx`.
  - About −62 product lines.
- **Lead Playwright check** (web mock, branch served on :5189):
  - "Chat actions for Ana" has `aria-haspopup=menu` and toggles `aria-expanded`;
  - its menu shows Pin, Mute…, Archive chat, Mark as unread and Clear history;
  - 17 row action buttons, topic rows included;
  - in Viernes, the external link renders with `rel="noopener noreferrer"`;
  - no console errors.
- **Not checked:** the mock has no @mentions or failed uploads, so those paths were checked by reading the code.
