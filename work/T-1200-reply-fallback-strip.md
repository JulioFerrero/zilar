---
id: T-1200
title: "T-1194 follow-up: the XEP-0461 reply fallback line ('> quote') is removed from the decoded body in xmpp-core, so the AI's group context and every client see only the reply text, and push previews of a reply show the reply text, not the quote"
status: merged
milestone: M5
branch: task/T-1200-reply-fallback-strip
model: auto
effort: default
depends_on: [T-1194]
estimate: 0.2 day
---

# T-1200: Strip the reply fallback line for every reader

## Spec (written by Claude, do not edit)

### Why
T-1194 sends every reply with a XEP-0461 fallback: a `> quote` line at the head of the body, marked by `<fallback for="urn:xmpp:reply:0"><body start end/></fallback>`. Only the client store strips that line (`packages/client-core/src/store/ledger-signatures.ts:16-40`, `stripReplyQuote`). Its pre-review (follow-up 2) found the readers that don't:
- **The decoded body keeps the line:** `packages/xmpp-core/src/stanza/decode.ts:91` sets `message.body = body`, the raw wire body. `parseReply` (`packages/xmpp-core/src/stanza/parse-fields.ts:40-51`) lifts the quote text with `replyFallbackText` (`:57-68`), but doesn't touch the body.
- **So the AI's group context sees the quote line:** `apps/server/src/agents/gateway/group-ingest.ts:109` reads `message.body?.trim()`.
- **And so does a reply's push preview:** push takes the text from the archive `txt` column (`apps/server/src/push/candidates.ts:35`) and previews it as-is (`apps/server/src/push/payload.ts:61,106-112`). The row's raw `xml` is also there (`candidates.ts:36`).
- **Search snippets are out of scope:** PostgreSQL builds them over `txt`.

### What to build
1. **xmpp-core** (`parse-fields.ts` and `decode.ts`):
   - export a pure `stripReplyFallback(body, stanza)` that removes the fallback range (start and end are code points, bounds-checked as `replyFallbackText` does) from the body;
   - `decode.ts` sets `message.body` to the stripped body, and `reply.text` keeps the quote (without the leading `> ` and the trailing newline; check what `replyFallbackText` returns today and keep the stored quote the same as after T-1194);
   - if the stripped body is empty (a voice or sticker reply), leave `body` undefined, as for a message with no body.
2. **client-core:** with the body arriving stripped, `stripReplyQuote` must not strip a second time. A user's own text that starts with `> ` must survive.
   - Keep `signatureFor` matching the echo: the sender's queue key is the logical text, and the echo is now stripped too;
   - remove code that is now dead, and say what you removed.
3. **Push** (`candidates.ts`): when the row's `xml` has a reply fallback, remove the range from `text` before it becomes the preview.
   - Parse the XML with whatever parser the server already uses for archive rows (find it: `push/archive-scan.ts` or `search/`; cite it), or use the xmpp-core helper on a parsed element;
   - an XML parse failure keeps today's text.
4. **Tests** (the message pipeline), 2:
   - `packages/xmpp-core/src/stanza.test.ts`: a reply with a fallback decodes to the body without the `> ` line and keeps `reply.text`;
   - `apps/server/src/push/candidates.test.ts`: a reply row's push text has no quote line.

### Read first
`AGENTS.md`, `work/T-1194-reply-ids.md` (the Report and the Review), `packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts` (how the fallback is written), `packages/client-core/src/store/ledger-signatures.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `apps/server/src/push/candidates.ts` and `apps/server/src/push/payload.ts`.

### Allowed files
`packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/stanza.test.ts`, `packages/client-core/src/store/ledger-signatures.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/incoming.test.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/candidates.test.ts`, `work/T-1200-reply-fallback-strip.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm --filter @zilar/server exec vitest run src/push/candidates.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

**Status:** review. All checks pass; `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### What I changed

1. **xmpp-core (`parse-fields.ts`, `decode.ts`):** factored the fallback-range read out of `replyFallbackText` into `replyFallbackRange` (same bounds checks), and exported a pure `stripReplyFallback(body, stanza)` that drops the quote line — the `[0, end)` code-point prefix plus one trailing newline — from the body. `decode.ts` now sets `message.body` to the stripped body (`parseReply`/`replyFallbackText` unchanged, so `reply.text` keeps the quote without the leading `> ` and trailing newline, same as after T-1194); a stripped-to-empty body (voice/sticker reply) leaves `body` undefined. XEP-0372 mention offsets are parsed against the wire body, then shifted past the stripped prefix in `decode.ts` (`shiftMentionsPastReply`); a mention that pointed into the quote keeps its JID and loses its offsets.
2. **client-core (`ledger-signatures.ts`, `ledger-incoming.ts`):** the body arrives stripped, so the store no longer strips. Removed dead code: `withoutReplyQuote` (private), `stripReplyQuote` (exported, only caller was `ledger-incoming.ts`), and the mention-offset shift block in `mentionsFor`. `signatureFor` is now the identity over the body — the sender queues the typed text and the echo arrives stripped, so they agree, and a hand-typed leading `> ` line survives on both sides.
3. **Push (`candidates.ts`):** `resolveCandidate` strips the fallback range from the archived `txt` before it becomes the preview. Archive-row XML parsing: neither `push/archive-scan.ts` (raw SQL strings) nor `search/` has an XML parser — `search/snippet.ts` reads archive XML defensively with regexes (`stanzaFrom`, `correctionTarget`), cited in the helper comment — so `textWithoutReplyFallback` does the same: regex out the `<fallback for="urn:xmpp:reply:0"><body start end/></fallback>` range, bounds-check it, slice in code points. Unparseable XML keeps today's text.
4. **Tests:** `stanza.test.ts` (+47): a `buildMessage` reply round-trips to body `my reply` with `replyTo.text` kept; a quote-only (voice) reply decodes to `body` undefined with payload and quote kept; a hand-typed `> ` line without fallback survives. `candidates.test.ts` (+48): a DM reply row previews as `my reply`; a row with a broken fallback range keeps its text. `incoming.test.ts` (+7 net, file exactly 400 lines): the fallback test now feeds the decoder-stripped body; plus a hand-typed `> ` survival test.

### Commands (real results)

- `pnpm install --frozen-lockfile` → Done in 9.5s.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts` → 80 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` → 22 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts` (nearest suite, not in Checks) → 9 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts` → first run 1 failed / 6 passed (my `end`-attribute regex used backreference `\2` instead of `\1`, so the range never parsed); fixed to `\1`, re-ran → 7 passed.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/client-core
  PASS  tests @zilar/server
  PASS  tests @zilar/xmpp-core
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First gate run failed on `format` for 3 files; ran `prettier --write` on those 3 only and re-ran green.)

### Deviations / notes

- **Mention shift site:** T-1194's store-side shift (`mentionsFor` in `ledger-incoming.ts`) assumed wire-coordinate offsets in `message.mentions`. Since decode now stores stripped-coordinate offsets, the shift moved into `decode.ts` and the store block was removed as dead (spec item 2). Verified: `ledger.test.ts` untouched and green.
- **`stripReplyFallback` vs the range:** it removes the whole quote *line* (`[0, end)` plus the trailing newline), not just the `[start, end)` slice — removing only the slice would leave `> \n` in the body and fail the "body without the `> ` line" acceptance.
- **Line cap:** every touched file is ≤400 lines except `packages/xmpp-core/src/stanza.test.ts` (1389 lines, was 1342 before this task; the spec-required test adds 47). The gate still reports `GATE PASS`.
- Security checklist: no secrets/text in logs (ids only in push payloads, unchanged); no deletes/updates touched; no new routes; the regex readers never throw (all matches optional-chained, numeric parses validated, slices bounds-checked); nothing here changes permissions or caps.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **xmpp-core decode** strips the XEP-0461 fallback range from `message.body`, keeps the quote in `reply.text`, and leaves an empty body undefined. That covers the AI group ingest and both apps.
- **client-core:** the second strip is removed, so a user's own `> ` text survives. The echo signature still matches.
- **Push:** `candidates.ts` removes the marked range from the archive text, read with regexes the way `search/snippet.ts` does. Anything unexpected keeps today's text and can't throw.
- **Tests,** run by the lead: xmpp-core stanza 80 of 80, client-core incoming and send 40 of 40, server push candidates 7 of 7. The test file is over 400 lines, which is allowed for tests.
- **Still to do after deploy:** `/health` ok. The next reply push should show only the reply text, on Julio's phone.
