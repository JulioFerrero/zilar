---
id: T-1326
title: "Group sender names and reply quotes like Telegram on web and mobile: one shared per-sender colour, the quote shows the replied-to sender's name (it is empty today), a coloured left bar, and 'Photo' / 'Voice message' / file name for media"
status: merged
milestone: M5
branch: task/T-1326-sender-colors-reply-quotes
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1326: Sender colours and reply quotes

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: find more places where the UI doesn't look like Telegram, WhatsApp or Discord. The lead's audit (web mock and Android mock build) found:

1. **Reply quotes show no sender name** on web and on mobile. The name line is empty:
   - web: `apps/web/src/components/ReplyQuote.tsx:14` renders `quote.senderName`, and the screenshots show it blank;
   - mobile: `apps/mobile/src/components/chat/reply-quote.tsx` (used at `message-bubble-content.tsx:76,198`) shows an empty top line, then the text.

   Data path read by the lead:
   - the wire reply is `{ id, to?, text? }` (`packages/xmpp-core/src/types.ts:92`, parsed in `packages/xmpp-core/src/stanza/parse-fields.ts:40`), with no name;
   - `ReplyRef` needs `senderName` (`packages/chat-core/src/types.ts:38-42`);
   - the mock seeds replies as `{ id }` only (`packages/mock-backend/src/domains/messages/threads/ana.ts:48-49`, `viernes.ts:16,19,48`, `dev-team.ts:30,34`).

   **First find where `senderName` should be filled** (from `to`, or from the replied-to message in history) and whether the real path fills it or only the mock leaves it empty, and say which in the Report. Fix every place that leaves it empty, including the mock seed.
2. **A quote of a photo shows an empty text line** (viernes "Who took that?" quotes a photo). Telegram shows "Photo" (or "Voice message", the file name, "Sticker", "GIF").
3. **The quote bar is grey** (`ReplyQuote.tsx:12` `bg-[#333333]`; mobile is the same idea). Telegram colours the bar and the name with the replied-to sender's colour.
4. **Group sender names all have the same colour** (web `apps/web/src/components/message/MessageMeta.tsx:50`, mobile `apps/mobile/src/components/chat/message-bubble-content.tsx:72,194`). Telegram gives each sender one of about 7 colours, the same everywhere.

### What to build
1. **A shared colour helper** in `packages/chat-core/src/sender-color.ts`:
   - `senderColor(id: string): string` picks from a fixed palette of 7 colours readable on the dark incoming bubble, picked stably from a hash of the bare JID;
   - own messages need no colour;
   - export it from `index.ts`;
   - **one small test** (same id gives the same colour; the result is in the palette).
2. **Sender names** in group bubbles use `senderColor(message.senderId)` on web and mobile.
3. **Reply quote on both platforms:**
   - the left bar and the name are in `senderColor` of the replied-to sender ("You" for your own messages keeps the accent);
   - the name is never empty (point 1);
   - a media quote shows a label: "Photo", "Video", "Voice message", "Sticker", "GIF", or the file name. Use the replied-to message from the loaded history when it's there; put the label logic in chat-core next to `previewText` (`packages/chat-core/src/messages.ts:212`) if it fits, and cite it.
4. Every file stays at most 400 lines. `apps/mobile/src/components/chat/message-bubble.tsx` is **400** and `apps/web/src/components/MessageBubble.tsx` is 394, so don't grow them: put new code in `reply-quote.tsx`, `ReplyQuote.tsx`, `MessageMeta.tsx`, `message-bubble-content.tsx` (248) or new files.

### Read first
`AGENTS.md`, the files above, and `packages/chat-core/src/messages.ts`.

### Allowed files
`packages/chat-core/src/sender-color.ts`, `packages/chat-core/src/sender-color.test.ts`, `packages/chat-core/src/messages.ts`, `packages/chat-core/src/index.ts`, `packages/chat-core/src/types.ts`, `apps/web/src/components/ReplyQuote.tsx`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/mobile/src/components/chat/reply-quote.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/web/src/store/**/*.ts`, `apps/mobile/src/store/**/*.ts`, `packages/mock-backend/src/domains/messages/**/*.ts`, `work/T-1326-sender-colors-reply-quotes.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/sender-color.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check** on the web mock and the Android mock build (Viernes and Ana):
  - quotes show a coloured name and bar;
  - the photo quote says "Photo";
  - group names are coloured.

---

## Report (written by the worker when done)

### What I did

1. **Shared colour helper** — new `packages/chat-core/src/sender-color.ts` with `senderColor(id)` (FNV-1a hash of the bare JID, stable) and an exported 7-colour palette `SENDER_COLORS` (`#e17076`, `#faa774`, `#a695e7`, `#7bc862`, `#6ec9cb`, `#65aadd`, `#ee7aae`; all ≥ 4.5:1 on the `#161616` incoming bubble, per `ui-style.md` §7). Exported from `packages/chat-core/src/index.ts`. One test in `sender-color.test.ts` (same id → same colour; every result is in the palette; senders do not all collapse to one colour).
2. **Group sender names use the shared colour** — web `apps/web/src/components/message/MessageMeta.tsx` now imports `senderColor` from `@zilar/chat-core` (removed its private 4-grey copy). Mobile `apps/mobile/src/components/chat/message-bubble-content.tsx` imports the shared `senderColor` from `@zilar/chat-core` instead of `@/lib/depth` for both the text and sticker sender headers.
3. **Reply quotes on both platforms** — the bar and the name are now the replied-to sender's `senderColor`, or the accent (`#ededed`; web uses `var(--accent)`) when the reply is to one of our own messages; the name is never empty; a media quote shows a label. The label logic lives in `packages/chat-core/src/messages.ts` next to `previewText` (line 212): `replyQuoteLabel` returns "Photo", "Video", "Voice message", "Sticker", "GIF" (the `gif-` + video-mime convention from T-0122) or the file name, in `previewBody`'s priority. `replyQuoteContent(quote, referenced, currentUserId)` resolves the name ("You" for our own), the colour id, and the excerpt line (referenced text → wire text → media label).

### The `senderName` data-path finding (spec point 1)

- The wire reply is `{ id, to?, text? }` (`packages/xmpp-core/src/types.ts:92`, parsed in `parse-fields.ts:40`); it carries **no name**.
- The real path fills `senderName` in `packages/client-core/src/store/ledger-incoming.ts:116-131` (`toUiMessage`), but **only from a replied-to message already in `messagesByChat`**; otherwise it is `''`. `history.ts` maps a whole page with `toUiMessage` **before** `ctx.set` inserts it (`history.ts:149-169`, `274-289`), so a reply to a message in the **same page** (the normal case, and every seeded mock reply) resolves to `''`. `withReplyQuote` (`ledger-edits.ts:199-219`) only rewrites the excerpt text, not the name, and runs only when the chat has edits.
- So the real path and the mock are the **same code**: the name is empty whenever the target is not loaded yet — which is exactly the first/newest history page and the mock. The clean fix (resolve within a page in `client-core/store/history.ts`) is **outside the Allowed files**, so I fixed it at the render layer instead: `ReplyQuote` (web and mobile) resolves the replied-to message from the loaded `messagesByChat` and reads the name and media label from it. With no loaded target, the wire excerpt is used and the name falls back to the fixed "Message" so the line is never empty.
- **Mock seed: no functional change was needed.** The seeds' `replyTo: { id }` are correct for the wire (which has no name field); they already point at messages that load in the same thread, so the render-layer resolution shows the real name and label. Adding a name to the seed is impossible on the wire, and adding a fallback `text` to the photo reply would have hidden the "Photo" label. I left `packages/mock-backend/...` untouched for that reason.

### Files changed (all inside Allowed files)

`packages/chat-core/src/sender-color.ts` (new), `packages/chat-core/src/sender-color.test.ts` (new), `packages/chat-core/src/messages.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/components/ReplyQuote.tsx`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/mobile/src/components/chat/reply-quote.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `work/T-1326-sender-colors-reply-quotes.md`.

Line limits respected: `MessageBubble.tsx` stays 394 and `message-bubble.tsx` stays 400 (the `ReplyQuote` call sites stay one line — the component takes the whole `message` so `chatId` need not be added there); new code is in `reply-quote.tsx`, `ReplyQuote.tsx`, `MessageMeta.tsx`, `message-bubble-content.tsx` and chat-core.

### Commands run (real results)

- `pnpm install` → done in 13.1s (one pre-existing peer warning `@types/react` in mobile).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/sender-color.test.ts` → **3 passed (1 file)**.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts` → **25 passed (1 file)**.
- `pnpm gate` (run once, from the repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (0.9s)
  PASS  tests @zilar/mobile  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  The first gate run failed format only on `ReplyQuote.tsx`; I ran `pnpm exec prettier --write` on that one file and re-ran the gate, which then passed.

### Deviations / notes

- `apps/mobile/src/lib/depth.ts` still exports its old private `senderColor`/`SENDER_COLORS`; nothing imports them now, but the file is not in the Allowed files, so I left it. A later task should delete them.
- **Alias limitation:** the render-layer lookup matches the reply id to a message id exactly. The mock uses the same id for both, so it works there; on the real server a reply whose wire `replyTo.id` is an origin id while the stored message is under its archive id would still fall back to "Message". The proper fix is the `client-core` history-page resolution above (alias-aware, like `withReplyQuote`), out of scope here.
- Media labels emitted: "Photo" (image/album), "Video" (other `video/*`), "Voice message", "Sticker", "GIF" (`gif-` + mp4/webm), the file name for other files. Non-sticker cards and plain text messages get no label.
- Security checklist: no new routes, no deletes/updates, no secrets or tokens touched; the change is presentational plus a pure chat-core helper.

### Round 2 (fix round)

**Findings fixed:** finding 1 (should-fix) — own-reply detection without a loaded target. `replyQuoteContent` (`packages/chat-core/src/messages.ts`) now treats `quote.senderName === 'You'` (the value `replyRef` writes for our own messages) as `own` when the replied-to message is not in the loaded history, so a reply to one of our own messages shows "You" with the accent bar/name instead of the fallback "Message" in a stranger's colour.

**Not fixed (deliberate):** findings 2–4 and 7 are nits and sit on lines this round does not change; findings 5–6 are follow-ups in files outside the Allowed files (`apps/mobile/src/lib/depth.ts`, `packages/client-core/src/store/*`). No disagreements.

**Tests added:** two cases in `packages/chat-core/src/sender-color.test.ts` (the only chat-core test file the Allowed files permit): a wire reply to our own message with no loaded target resolves to `own: true` and name "You"; an unknown sender with no loaded target still falls back to "Message".

**Commands run (real results):**
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/sender-color.test.ts` → **5 passed (1 file)**.
- `pnpm gate` (from the repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/chat-core  (1.3s)
  PASS  tests @zilar/mobile  (1.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 follow-ups); the packet is current for `23038981` after the rebase.**
- **Root cause, from the worker:** the empty quote name is a **real-path** bug. `toUiMessage` (`client-core/store/ledger-incoming.ts:116-131`) only finds the name when the target is already in `messagesByChat`, and history maps a page before inserting it. It's fixed where the quote is drawn (it reads the loaded target; the fallback is "Message").
- **Lead's checks:**
  - web mock (headless): Luis/Marta names coloured, quotes show "Marta / Viernes.png" and "Luis / Who took that?" with coloured bars, and "You" in white;
  - Android mock build: the same in Viernes and Ana.
- **Follow-ups:**
  - resolve the reply name within a history page in `client-core/store/history.ts`, so the data is right too;
  - use the reply's `to` JID for the colour when the target isn't loaded;
  - delete the unused `senderColor` in `apps/mobile/src/lib/depth.ts`.
