---
id: T-1194
title: "UI-F1 (UI-1, UI-6): a reply names the quoted message by an id both sides share (the same wire id reactions use), the receiver resolves the quote alias-aware, and the reply carries a XEP-0461 fallback quote so a reply to a message not loaded still shows its text"
status: merged
milestone: M5
branch: task/T-1194-reply-ids
model: auto
effort: default
depends_on: [T-1153]
estimate: 0.4 day
---

# T-1194: Reply quotes show on every device

## Spec (written by Claude, do not edit)

### Why
`docs/audit/features-ui-audit.md` UI-1 (P1, confirmed) and UI-6, fix **F1**. In a DM, B replies to A's message, and on A's screen (and on A's second device) the reply bubble shows an **empty quote**.
- **The quote names the bubble id:** it is built from `message.id` (`packages/chat-core/src/chat-labels.ts:66-73`), and that id goes on the wire unchanged: `replyTo: { id: replyTo.id }` in `packages/client-core/src/store/send/text.ts:48`, `attachment.ts:74`, `sticker.ts:34` and `voice.ts` (find the line). `packages/xmpp-core/src/stanza/build-outgoing.ts:76-84` sends only `<reply id/>`.
- **That id is local to one archive:** an incoming DM message's id is the stanza-id of the **receiver's** archive (`packages/xmpp-core/src/stanza/resolve-sender.ts:123-132`), while the sender knows it under its own archive's id, or `local-N`. Only the alias root (the origin id) is common.
- **Reactions already solve this:** `wireTargetFor` (`packages/client-core/src/store/ledger-ids.ts:142-152`) computes the shared wire id for reactions.
- **The receiver matches by exact id only** (`packages/client-core/src/store/ledger-incoming.ts:107-117`, `item.id === message.replyTo?.id`). `withReplyQuote` (`ledger-edits.ts:199-219`) is alias-aware, but runs only when the chat has edits.
- **Related:** T-1176 made the group AI wake on a reply by matching the room stanza-id and the origin id. Keep both ids working for it.

### What to build
1. **Sending (`text.ts`, `attachment.ts`, `sticker.ts`, `voice.ts`):** put `ctx.k.wireTargetFor(replyTo.id)`, or whatever exposes `wireTargetFor` (find and cite it), on the wire, falling back to `replyTo.id` when it is undefined.
   - **First verify** what `wireTargetFor` returns for a DM message and for a group message, and that the value is one **both** sides know: in DMs the origin id; in groups the room stanza-id. Write that in the Report, with the lines.
   - Key the echo signature (`signatureFor`) on the same id the wire carries, so the echo still matches.
2. **Receiving (`ledger-incoming.ts:107-117`):** resolve the quote **alias-aware**, using the same `sameMessage` or alias logic as `withReplyQuote`, so a quote by origin id finds a message stored under its archive id, and the other way round.
3. **The XEP-0461 fallback** (`build-outgoing.ts` and `packages/xmpp-core/src/stanza/parse-fields.ts`):
   - on send, add a fallback quote: the `> quoted text` first line in the body, plus `<fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0"><body start=… end=…/></fallback>`, when the quoted text is known;
   - on parse, strip the fallback range from the body and keep it as the quote text, used only when the quoted message isn't loaded (UI-6).
   - Our clients must never show the `> …` line twice.
4. **Test** (the message pipeline), 1, in `packages/client-core/src/store/incoming.test.ts`: a reply that names the quoted message by its origin id resolves to the message stored under a different archive id, with a non-empty quote.

### Read first
`AGENTS.md`, `docs/audit/features-ui-audit.md` (UI-1, UI-6, F1), `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger-edits.ts:190-235`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/ledger-signatures.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts:60-100` and `packages/xmpp-core/src/stanza/parse-fields.ts:30-60`.

### Allowed files
`packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send/attachment.ts`, `packages/client-core/src/store/send/sticker.ts`, `packages/client-core/src/store/send/voice.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/ledger-ids.ts`, `packages/client-core/src/store/ledger-signatures.ts`, `packages/client-core/src/store/incoming.test.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/types.ts`, `work/T-1194-reply-ids.md`.

`packages/xmpp-core/src/types.ts` is 397 lines: add at most 3 lines there, or none.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web:** a reply in a DM shows its quote on the other side.

---

## Report (written by the worker when done)

**Status:** review. All checks pass; `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### What `wireTargetFor` returns (verified before wiring it in)

`wireTargetFor` is `packages/client-core/src/store/ledger-ids.ts:145-152` (returned from `createLedgerIds`, reached in the send code as `ctx.k.wireTargetFor`). It resolves the alias root of a message id, returns the linked server id when there is one, and otherwise the root itself (undefined only for a still-unacked `local-*`).

- **DM (peer message):** the message is stored under this side's archive stanza-id and aliased to the sender's origin id (`linkMessageIds(message.originId, message.id)`, `ledger-incoming.ts:105`; only incoming archive ids differ per side — `resolve-sender.ts:116-132`, `archiveBy = kind === 'groupchat' ? chatJid : me` at line 124). `messageServerIds` holds no entry for it, so `wireTargetFor` returns the **origin id** — the id both sides know (the sender generated it, `origin-id`/stanza `id`).
- **Group:** `message.id` is already the room stanza-id (`archiveBy = chatJid`, `resolve-sender.ts:124`), so the root *is* the room stanza-id and it is returned directly; for my own group message `messageServerIds` holds that same room stanza-id (`linkAckToServer`). The room stanza-id is identical on every side.

So in both cases `wireTargetFor(replyTo.id) ?? replyTo.id` is an id the peer can resolve.

### What I changed

1. **Wire id on send** (`send/text.ts`, `send/attachment.ts`, `send/sticker.ts`, `send/voice.ts`): each send computes `wireReply = { ...replyTo, id: ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id }`, puts `wireReply.id` in `<reply/>` on the wire and keys `signatureFor`/`stickerSignatureFor` on it. `sendText`'s three `outboxFailed(..., replyToId, ...)` calls now pass `wireReply?.id`. The optimistic bubble keeps the local `replyTo` (already carrying `senderName`/`text` from `chat-labels.ts:71-78`), so the sender's own bubble is unchanged.
2. **Alias-aware receive** (`ledger-incoming.ts:130-142`): `toUiMessage` finds the quote target with `sameMessage(item.id, replyTo.id)` instead of `item.id === replyTo.id`, and falls back to the parsed quote text when nothing matched.
3. **XEP-0461 fallback** (`build-outgoing.ts`, `parse-fields.ts`): `buildMessage` writes `> <first line of the quote>\n<text>` and a `<fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:reply:0"><body start="2" end="…"/></fallback>` when `replyTo.text` is known; mention offsets are shifted by the prefix so references still point at the right slice. `parseReply` lifts the marked range back out as `replyTo.text`. `SignMessageOptions`/`ChatMessage.replyTo` gained an optional `text` (`types.ts`, edited in place, line count unchanged at 397).
4. **Never shown twice** (`ledger-signatures.ts`, `ledger-incoming.ts`): `stripReplyQuote` drops the `> …` line from the visible `ui.text` (and `mentionsFor` shifts the mention offsets back by the prefix length). The reply bar renders the quote from `replyTo`.
5. **Echo still matches** (`ledger-signatures.ts:13-23`): `signatureFor` keys the body on the logical text (`withoutReplyQuote`), so the sender's queued signature and the echo agree whether or not the fallback line was written.
6. **Tests** (`incoming.test.ts`, +26 lines, file now 393): a reply naming the quoted message by its **origin id** resolves to the message stored under a different archive id with a non-empty quote; plus a UI-6 case where the target is unloaded and the quote text comes from the fallback, with the `> …` line stripped from the body.

### Commands (real results)

- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts` → 77 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` → 21 passed.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/client-core
  PASS  tests @zilar/xmpp-core
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The first `pnpm gate` run failed on `format` for two files; I ran `prettier --write` on those two and re-ran to the green result above. No file outside the Allowed files was touched.)

### Deviations / notes

- **Where the fallback line is stripped.** The spec puts the strip in `parse-fields.ts`. `ChatMessage.body` is computed in `packages/xmpp-core/src/stanza/decode.ts:53-57`, which is **not** in the Allowed files and reads the body before `parseReply` runs, so it cannot be stripped there. `parse-fields.ts` still lifts the quote text from the `<fallback>` range; the actual removal from the visible text happens in the allowed store files (`stripReplyQuote` in `ledger-signatures.ts`, called from `ledger-incoming.ts`), which is also where "used only when the quoted message isn't loaded" lives. Same behaviour, different call site.
- **Echo signature normalization.** Because `decode.ts` isn't in scope, the echoed body still carries the `> …` line; `signatureFor` normalizes it away so the optimistic bubble still reconciles instead of duplicating. Two messages in one chat whose bodies differ only by a leading `> …` line and that name the same reply target would collide in the pending-echo queue — a vanishingly rare case, and both sides normalize identically so each message still matches its own echo.
- **Outbox resend.** `outbox.ts` is not in the Allowed files, so a reply that fails and is resent re-sends the `<reply id>` (the shared wire id, passed through `outboxFailed`) but not the quote `text`; only the UI-6 fallback text is lost on that path, never the id resolution.
- `packages/xmpp-core/src/types.ts` was edited in place (two lines), so it stays at 397 lines, within the "at most 3 added lines" and the 400-line cap.
- The `wireTargetFor` value was also confirmed end-to-end for the fallback body: `buildMessage({ replyTo: { id: 'origin-1', text: 'the original' } })` emits `body="> the original\nmy reply"` and `<body start="2" end="14"/>`, and decoding it back yields `replyTo = { id: 'origin-1', text: 'the original' }` (checked with a throwaway `tsx` script, since `stanza.test.ts` is not in the Allowed files).

### Open questions

None.


## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 2 follow-ups.**
- **The wire id:** a reply names `wireTargetFor(replyTo.id) ?? replyTo.id`, on text, attachment, sticker and voice. That's the origin id in DMs and the room stanza-id in groups, both known to every side. The echo signature is keyed the same way. T-1176's wake matching is unchanged.
- **Receiving:** the quote is resolved alias-aware (`ledger-incoming.ts`, chat-scoped).
- **The XEP-0461 fallback:** a `> quote` line plus `<fallback>` on send. The store strips it, keeps the quote text for a message that isn't loaded, and shifts mention offsets back.
- **Tests:** client-core incoming and send 39 of 39, xmpp-core stanza 77 of 77, run by the lead.
- **Follow-ups:**
  - (1) the outbox resend drops the quote text. Added to T-1197, which owns `outbox.ts`;
  - (2) the raw `ChatMessage.body` keeps the fallback line for direct readers (server pushes, AI context, search). That's a new task: strip it at decode.
- **The nit, accepted:** a `> ` line typed by hand is normalised in the echo signature.
- **Still to do:** the live web check, a DM reply showing its quote on the other side.
