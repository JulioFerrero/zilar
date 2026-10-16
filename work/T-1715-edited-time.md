---
id: T-1715
title: "'edited' shows WHEN it was last edited: carry the latest correction's time (editedAt) from chat-core edits through the client-core ledger to UiMessage, and show 'edited 10:45' (edit time) instead of 'edited' + the original time on web and phone — Julio 2026-10-16 (routines edit one message each run)"
status: merged
milestone: M5
branch: task/T-1715-edited-time
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1715: "edited 10:45" shows the edit time

## Spec (written by Claude, do not edit)

### Why
A routine now edits one message on each run (`docs/design/mockups/routines/README.md`). Julio decided on 2026-10-16 that "edited" shows the time of the latest edit, on web and phone, for every edited message. Today the marker says "edited" followed by the **original** send time.

### Facts (the lead read them on 2026-10-16)
- **`packages/chat-core/src/edits.ts`** (274 lines):
  - `CorrectionEntry { text; order: number; mentions? }` (`:86-90`). `order` is the correction stanza's time in ms; the ledger passes `order: message.timestamp.getTime()` (`packages/client-core/src/store/ledger-edits.ts:77`);
  - `MessageEdits { edited; deleted; text?; mentions? }` (`:108-114`);
  - `editsFor(state, targetId)` (`:225-243`) builds `{ edited: true, deleted: false, text: correction.text }` at `:237`.
- **`packages/client-core/src/store/ledger-edits.ts`:** the edit apply (`:236-259`) returns early when `edited`, text and mentions are unchanged (`:240-246`), then builds `{ ...message, edited: true }` (`:247`).
- **`packages/chat-core/src/types.ts:102-103`:** `UiMessage.edited?: boolean` ("True when the message was corrected (XEP-0308) after it was sent.").
- **Web:** `apps/web/src/components/message/MessageMeta.tsx:23-35` renders `{edited && <span>edited</span>}{formatTime(message.createdAt)}`. The `edited` prop comes from `MessageTextBody.tsx:61,81`, `MediaMetaPill.tsx:26` and `BigEmoji.tsx:36`, and `StickerMessage.tsx:59` renders its own `edited`.
- **Phone:** `{message.edited === true ? 'edited ' : ''}{formatTime(message.createdAt)}` appears in:
  - `apps/mobile/src/components/chat/plain-bubble-body.tsx:85-86`;
  - `apps/mobile/src/components/chat/message-bubble-decor.tsx:157-158`;
  - `apps/mobile/src/components/chat/sticker-message.tsx:93`;
  - `apps/mobile/src/components/chat/attachment-body.tsx:157-159`.

### Steps
1. **chat-core:**
   - add `editedAt?: number` (ms) to `MessageEdits`, and set it to `correction.order` in `editsFor`;
   - add `editedAt?: Date` to `UiMessage`, next to `edited`, with a comment.
2. **client-core `ledger-edits.ts`:**
   - set `editedAt` (a `Date` from the ms) on the edited `StoreMessage`;
   - include it in the early-return comparison, so a newer correction with the same text still updates the time;
   - remove it wherever `edited` is removed (`delete … .edited` paths).
3. **Web:** `MessageMeta` shows `edited ${formatTime(message.editedAt)}` when the message is edited and `editedAt` is set, otherwise the same as today. Keep the `title` tooltip on the original full date. Apply the same rule in `StickerMessage.tsx:59`.
4. **Phone:** in the four places above, show `'edited ' + formatTime(message.editedAt)` instead of `'edited '` plus the original time, when edited and `editedAt` is set. Put the rule in one small shared helper in `apps/mobile/src/components/chat/` (for example `meta-time.ts`, `metaTimeText(message)`) so the four places don't each repeat it.
5. **No test:** this is UI. Run the existing chat-core and client-core edit tests to check nothing broke.

### Allowed files
- `packages/chat-core/src/edits.ts`
- `packages/chat-core/src/edits.test.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/ledger-edits.ts`
- `apps/web/src/components/message/MessageMeta.tsx`
- `apps/web/src/components/StickerMessage.tsx`
- `apps/mobile/src/components/chat/meta-time.ts`
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `apps/mobile/src/components/chat/sticker-message.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `work/T-1715-edited-time.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot src/edits
pnpm gate
```

### Acceptance
- **An edited message reads "edited HH:MM"** with the latest correction's time, on web and phone.
- **A message that was never edited** shows its send time as today.

---

## Report (written by the worker when done)

### What I did
Implemented steps 1–4 of the spec. All edited files are inside the Allowed files.

- **chat-core**
  - `src/edits.ts`: added `editedAt?: number` (ms) to `MessageEdits`, and `editsFor` now sets it to `correction.order`.
  - `src/types.ts`: added `editedAt?: Date` to `UiMessage`, next to `edited`, with a comment.
- **client-core** `src/store/ledger-edits.ts`
  - The edit apply builds `editedAt` (a `Date` from `state.editedAt` ms) on the edited `StoreMessage`.
  - Included `message.editedAt?.getTime() === state.editedAt` in the early-return comparison, so a newer correction with the same text still updates the time.
  - Removed `editedAt` wherever `edited` is removed (the plain-restore branch and the deleted branch, plus the deleted branch's no-op guard).
- **web**
  - `src/components/message/MessageMeta.tsx`: when `edited` and `message.editedAt` is set, renders `edited {formatTime(message.editedAt)}` and drops the original time; otherwise the exact previous output (`edited` + original time). The `title` tooltip still shows the original full date.
  - `src/components/StickerMessage.tsx`: same rule on its own `edited`/time pill.
- **phone**
  - New `src/components/chat/meta-time.ts` with `metaTimeText(message)`: returns `edited HH:MM` using `editedAt` when edited and set, else `edited ` + the original send time, else just the send time.
  - Used it in `plain-bubble-body.tsx` (`BubbleInlineMeta`), `message-bubble-decor.tsx` (`BigEmoji`), `sticker-message.tsx`, and `attachment-body.tsx` (the two-text `edited` + time became one `Text` via the helper).

Files changed (10 code/config + task file): `packages/chat-core/src/edits.ts`, `packages/chat-core/src/types.ts`, `packages/client-core/src/store/ledger-edits.ts`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/StickerMessage.tsx`, `apps/mobile/src/components/chat/meta-time.ts` (new), `apps/mobile/src/components/chat/plain-bubble-body.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/sticker-message.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `work/T-1715-edited-time.md`.

### Checks run
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/edits` → **3 failed | 20 passed (23)** (first run, before the lead allowed the test change). The three failures were exact-shape `toEqual` assertions in `packages/chat-core/src/edits.test.ts` (lines 36, 55, 144) that expected `{ edited: true, deleted: false, text: 'fixed' }` with **no** `editedAt`.
- `pnpm --filter @zilar/chat-core exec vitest run --reporter=dot src/edits` (after the fix) → **23 passed (1 file)**.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts src/store/actions.test.ts` → **25 passed (2 files)**.
- `pnpm exec prettier --write` on the two files the first gate run flagged (`message-bubble-decor.tsx`, `sticker-message.tsx`) — formatting only.
- `pnpm gate` (from the repo root, final run) summary lines:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.5s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/client-core  (4.6s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Blocked / needs a decision
**Resolved by the lead.** The lead allowed changing `packages/chat-core/src/edits.test.ts`; I added that path to the Allowed files and updated the three expectation objects (lines 36, 55, 144) to include `editedAt: 1` (the correction's `order`), changing nothing else in the test file. `pnpm gate` now ends `GATE PASS`, and `scope:` reports every changed file inside the Allowed files.

_Original blocker (for the record):_ the spec's step 1 unavoidably adds `editedAt` to the object `editsFor` returns, and `edits.test.ts` asserted that object with `toEqual`, so the three expectations failed and the file was outside the Allowed files.

### Notes for the lead
- Lead approved 2026-10-16: `packages/chat-core/src/edits.test.ts` was added to the Allowed files and its three `editsFor` expectations (lines 36, 55, 144) updated with `editedAt: 1`; nothing else in the test file changed. Final `pnpm gate` ends `GATE PASS`.
- Implementation of every spec step is done and the final `pnpm gate` is green for install, format, lint, typecheck, effect, the chat-core / client-core / mobile tests, scope, migrations, images and size.
- The spec said "Run the existing chat-core and client-core edit tests to check nothing broke" — the client-core ones never broke; the chat-core `edits.test.ts` ones needed the new `editedAt` field in their expected shape.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit, accepted. The "latest correction wins" test checks only the text, not `editedAt`.
- **The change:**
  - `editedAt` flows from the correction's stanza time (`order`) through `editsFor` and the ledger, which also compares it so a newer same-text edit still updates;
  - web `MessageMeta` and `StickerMessage` show "edited HH:MM" (the edit time);
  - the phone's four meta places share `meta-time.ts` (`metaTimeText`);
  - a message that was never edited shows its send time as before.
- **Context:** this is Julio's decision 1 for routines (2026-10-16).

