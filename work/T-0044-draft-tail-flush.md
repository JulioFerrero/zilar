---
id: T-0044
title: Server — publish the complete reply as a draft before sending the final XMPP message (no more tail arriving in one chunk)
status: planned
milestone: M2
branch: task/T-0044-draft-tail-flush
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0041]
estimate: 0.5 day
---

# T-0044: The draft reaches the end before the message does

## Spec (written by Claude, do not edit)

### Goal

In the T-0043 live check, a reply's drafts grew smoothly to 762 characters. Then nothing came for ~700 ms, and the final message arrived with 1231 characters. The last ~40% of the text appeared in one chunk.

The lead's first look found the structural cause. The gateway publishes the latest text only in `turnDrafts.end(...)`, which runs **after** `runDmTurn` has sent the final XMPP message. By then the web client has already swapped the draft for the message (T-0043 rule (a)) and ignores the late draft. So whatever text was still sitting in the 150 ms throttle, or arrived in a burst at the end, is never seen as a draft.

Fix: the complete reply text is published as a draft (immediately, not throttled) **before** the final XMPP message is sent.

Also measure whether the provider bursts the tail. Report what you find; don't change provider or LiteLLM settings.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/drafts/hub.ts` (`publishTurn`, `push`, `end`, the throttle) and `drafts/events.ts` (the contract, which must not change)
- `apps/server/src/agents/reply.ts` (`runDmTurn`, `runToolTurn`: every place that sends the final reply or notices) and `agents/stream.ts`
- `apps/server/src/agents/gateway.ts` (where `turnDrafts` is created and ended)
- `work/T-0043-web-reply-drafts.md`, the Review section (the live-check numbers)

### Allowed files
- `apps/server/src/drafts/hub.ts`, `hub.test.ts`
- `apps/server/src/agents/reply.ts`, `reply.test.ts`, `gateway.ts`, `gateway.test.ts`, `stream.ts`, `stream.test.ts`
- `work/T-0044-draft-tail-flush.md`

Everything else is off-limits, and `drafts/events.ts` must not change.

### Allowed dependencies
None.

### What to build
1. **A flush on the turn publisher.** `DraftTurnPublisher` gets `flush(text: string): void`. It records `text` as the latest text and publishes it **now**, cancelling any pending throttle timer, unless it equals the last published text or exceeds `DRAFT_MAX_CHARS`. It does nothing after `end`. Keep `end`'s behavior; it must not re-publish the same text.
2. **Flush before the final send.** `DmTurnDeps` gets an optional hook, e.g. `beforeFinalSend?: (text: string) => void`. `runDmTurn` and `runToolTurn` call it with the exact (trimmed) reply text right before the `sendMessage` of the **final reply**. Don't call it for notices, and don't call it for failure texts (a failed turn ends with `end:'failed'` as today). The gateway wires it to `turnDrafts.flush(text)`.
3. **Measure the tail.** Using the gated integration path or a one-off local script against the live LiteLLM (see the live-stack rules you were given), log the arrival times and sizes of the stream deltas of one longer reply. Put a short table in the Report: time, characters. Say whether the tail arrives in a burst. Don't commit the script or any output that contains keys.

### Tests (Vitest, no network)
- **Hub:** `flush` publishes immediately even inside the throttle window and cancels the pending timer (fake timers). It skips identical text and text over the cap, and does nothing after `end`. `end` after `flush` with the same text publishes only `end`.
- **`runDmTurn` / `runToolTurn`:**
  - the hook receives the exact final text **before** `sendMessage` of that text (assert the call order);
  - it's not called for notices or failure texts.
- **Gateway:** with a fake stream whose last deltas arrive within one throttle window, subscribers see a `draft` with the **complete** text before the final XMPP send, then `end:'sent'`.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The last `draft` of every successful turn carries the complete final text and is published before the final XMPP message.
- [ ] The contract (`drafts/events.ts`) is unchanged.
- [ ] The Report has the tail-timing table.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Any web change (T-0045 does the client side in parallel).
- Changing the throttle interval.

## Report (written by the worker when done)

## Review (written by Claude)
