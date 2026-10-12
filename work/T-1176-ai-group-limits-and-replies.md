---
id: T-1176
title: "AI-7 + AI-8: in groups, a turn dropped by the room rate limit or the round budget tells the asker once per window instead of going silent; replying to the AI's own message (without an @mention) wakes it, like Telegram"
status: merged
milestone: M5
branch: task/T-1176-ai-group-limits-and-replies
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1176: The AI in groups answers replies and says when it's rate-limited

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md` AI-7 and AI-8 (P1, confirmed by code).
- **AI-7, dropped turns are silent:**
  - the limits are six turns per AI per room per 10 min (`GROUP_TURNS_PER_WINDOW`, `GROUP_RATE_WINDOW_MS`) and `ROUND_MAX_AI_TURNS` per human message (`apps/server/src/agents/gateway/contracts.ts`);
  - past either limit, the turn is dropped with only a log line (`apps/server/src/agents/gateway/group-turn.ts:239-265`);
  - the asker sees nothing.
- **AI-8, replying to the AI doesn't wake it:**
  - only an XEP-0372 mention wakes the AI (`apps/server/src/agents/gateway/group-ingest.ts:98-110`);
  - `ChatMessage.replyTo.to` carries the original sender (`packages/xmpp-core/src/types.ts:68`) but is never checked.
- **Size:** `gateway/group-turn.ts` is **571 lines**, already over the 400-line rule. This task must not make it longer: move the two limit checks out of it.

### What to build
1. **A new `apps/server/src/agents/gateway/room-limits.ts`.** Move the two limit checks there (rate window and round budget, `group-turn.ts:236-265`) as one function, for example `checkRoomLimits(...)`, that returns `'ok' | 'rate' | 'round'` and keeps the same bookkeeping: the `roomTurns` stamps, and the refund on a round drop.
   - `group-turn.ts` calls it, and must end **shorter** than 571 lines.
2. **The notice:** when the result is `'rate'` (only), send **one** short message per AI per room per window through the live session's send path, the same one the turn uses for its reply: `"@<asker nick> I've answered a lot here in the last few minutes. Please try again shortly."` Track "notice sent" per room, for example a timestamp in `session`; add the field to `contracts.ts` if needed.
   - No notice for `'round'`: AIs answering each other is expected.
   - Keep the warn logs and the `failDelegationQuietly` calls.
3. **AI-8:** in `group-ingest.ts:99-101`, `mentioned` is also true when `normBareJid(message.replyTo?.to ?? '') === aiBare`. Check what `replyTo.to` holds in a room: the occupant JID or the real JID. Compare in the matching form (the AI's room occupant JID or its bare JID), and cite what you found.
4. **Tests:** none required. If `apps/server/src/agents/gateway.test-harness.ts` makes it a few lines, add one test that a reply to the AI's message wakes it.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (AI-7, AI-8), `apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/contracts.ts`, `apps/server/src/agents/gateway/live.ts` and `packages/xmpp-core/src/types.ts:60-75`.

### Allowed files
`apps/server/src/agents/gateway/room-limits.ts`, `apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/contracts.ts`, `apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway-group.test.ts`, `work/T-1176-ai-group-limits-and-replies.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `group-turn.ts` is shorter than 571 lines, and every other touched file stays at most 400.

---

## Report (written by the worker when done)

**Status:** review — all checks pass.

### What I did

- **AI-7 — the limits move.** New `apps/server/src/agents/gateway/room-limits.ts` holds `checkRoomLimits(...)`, returning
  `'ok' | 'rate' | 'round'`, with the exact bookkeeping the inline checks had: the `session.roomTurns` stamps, the sliding
  `GROUP_RATE_WINDOW_MS` filter, the `ROUND_MAX_AI_TURNS` round budget, and the refund of the rate stamp on a round drop.
  `group-turn.ts` now calls it once and is **566 lines (was 571)**.
- **AI-7 — the notice.** On a `'rate'` result only, `sendRoomRateNotice(...)` posts one message per AI per room per window
  through the same `liveSendMessage` path the reply uses: `@<asker nick> I've answered a lot here in the last few minutes.
  Please try again shortly.` (asker name via `displayNameOf`). The window stamp is `session.roomRateNotices`, a new field on
  `AiSession` (`contracts.ts`), initialised in `sessions.ts` and cleared with the other per-room state when the AI leaves a
  room. A `'round'` drop sends no notice. Both `logger.warn` lines and both `failDelegationQuietly` calls are unchanged.
- **AI-8 — replies wake the AI.** `group-ingest.ts` now also treats a message as a mention when it replies to the AI, via the
  exported predicate `replyTargetsAi(...)` at the old `mentioned` site.

### AI-8: what `replyTo.to` holds (the spec asked me to check and cite)

Zilar's own clients **never set `to` on a reply**. Every send path builds the wire reply as `replyTo: { id: replyTo.id }`
only — `packages/client-core/src/store/send/text.ts:48`, `send/voice.ts:77`, `send/attachment.ts:74`, `send/sticker.ts:34` —
and the UI `ReplyRef` (`packages/chat-core/src/types.ts:31`) has no `to` field. So on a room message from our own clients
`replyTo.to` is `undefined`; only `replyTo.id` is present. The `to` attribute (XEP-0461) is written by the sending client;
the only code that reads or writes it is `packages/xmpp-core` (`stanza/build-outgoing.ts:76-85`, `stanza/parse-fields.ts:39-45`)
and its tests, so no server-side or ejabberd step fills it in.

Comparison forms, therefore:

- A spec-compliant third-party client puts the quoted author's JID in `to`; in a MUC that is the occupant JID
  (`room@muc.domain/nick`), though a client may put the real bare JID. I match both: `normBareJid(to) === aiBare` and
  `to === \`${roomJid}/${room.nick}\``.
- Because our own clients send no `to`, the `to` check alone would not wake the AI for Zilar users. `replyTargetsAi` also wakes
  when the quoted `replyTo.id` is one of the ids this AI recently sent in that room. Those ids are recorded by the group turn's
  own send callback (`rememberRoomSentId` in `contracts.ts`, bounded to the newest `ROOM_SENT_ID_LIMIT = 40` per room in
  `session.roomSentIds`). This is the path our clients use.

If the lead prefers the cleaner XEP-0461 route (our clients write `to` on a reply, so the server only needs the `to` check),
that is a client-side change in files outside this task's Allowed files; I did not touch them.

### Files changed

- `apps/server/src/agents/gateway/room-limits.ts` — new, 88 lines.
- `apps/server/src/agents/gateway/group-turn.ts` — 571 → 566.
- `apps/server/src/agents/gateway/group-ingest.ts` — 198 → 228.
- `apps/server/src/agents/gateway/contracts.ts` — 310 → 335.
- `apps/server/src/agents/gateway/sessions.ts` — 346 → 350.
- `apps/server/src/agents/gateway-group.test.ts` — new, 180 lines.
- `work/T-1176-ai-group-limits-and-replies.md` — this report.

### Commands and results

- `pnpm install`: ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts`: **10 passed** (1 file).
- `pnpm gate` (repo root):
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.6s)
PASS  typecheck  (2.5s)
PASS  effect  (0.5s)
PASS  tests @zilar/server  (3.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Tests added

`apps/server/src/agents/gateway-group.test.ts`:

- `checkRoomLimits`: accepts under both limits and stamps the window; drops past the rate window without spending the round;
  drops past the round budget and refunds the rate stamp.
- `shouldSendRateNotice`: one notice per window per room.
- `replyTargetsAi`: wakes on the AI's sent id, on a bare JID in `to`, and on the MUC occupant JID in `to`; ignores a reply to
  someone else and a message with no reply.
- One integration test with the gateway harness (`seedGroup` + the harness `seedAi`): the AI answers a mention, then answers a
  follow-up that quotes the AI's reply id **with no mention**.

### Fix round (lead review)

The sent id the gateway records (`group-turn.ts`, `rememberRoomSentId(session, roomJid, sent.id)`) is the id the gateway
generated, but a client stores a room message under its **archive stanza-id** (`packages/xmpp-core/src/types.ts:44`) and quotes
that in `replyTo.id`, so the match would usually miss for our own clients.

Fixed in `apps/server/src/agents/gateway/group-ingest.ts`: the AI's own reflection is the message the ingest already skips as
`outgoing` — `group-ingest.ts`'s `if (message.outgoing) { return; }`; xmpp-core marks it in
`packages/xmpp-core/src/stanza/resolve-sender.ts:82-87` (own nick) and `:65,77` (own real JID via the room roster), covered by
`packages/xmpp-core/src/stanza.test.ts:255-265`. That branch now, when the room is one the session holds, calls
`rememberRoomSentId(session, roomJid, message.id)` and, when `message.originId` is set, `rememberRoomSentId(session, roomJid,
message.originId)`. The `sent.id` record from the turn's send callback is kept; duplicates are harmless. The integration test
now also injects that reflection and proves a reply quoting the stanza-id (`replyTo.id: 'stanza-1'`) wakes the AI.

### Deviations / open questions

- The spec's literal AI-8 check (`normBareJid(replyTo.to) === aiBare`) is implemented, but as shown above it never fires for
  Zilar clients; I added the sent-id path so the feature works. This is the one deviation from the spec's suggested mechanism.
  Prefer a client-side `to` instead? Say so and I will drop the sent-id state.
- The rate notice is suppressed by a per-room timestamp compared with `GROUP_RATE_WINDOW_MS`. The stamp is set before the send,
  so a failed send is not retried inside that window (chosen to honour "one message per window").

## Review (written by Claude)

**Lead, 2026-10-12: approved, after the lead's fix round. The pre-review is clean, with 2 nits.**
- **AI-7:**
  - the limit checks moved to `room-limits.ts`, and `group-turn.ts` went from 571 to 566 lines;
  - a `'rate'` drop sends one notice per AI per room per window;
  - `'round'` stays silent.
- **AI-8:** a reply to the AI's message wakes it.
  - It matches `replyTo.to`, the bare or occupant JID.
  - It also matches the AI's recent ids. After the lead's round those include the **archive stanza-id** of the AI's own reflection, plus its origin id, which is what our clients quote.
- **Tests:** `gateway-group.test.ts`, 10 of 10 in the branch, run by the lead.
