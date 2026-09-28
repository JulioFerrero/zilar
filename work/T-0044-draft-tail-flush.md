---
id: T-0044
title: Server — publish the complete reply as a draft before sending the final XMPP message (no more tail arriving in one chunk)
status: merged
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

### What I did

**1. Flush on the turn publisher — `apps/server/src/drafts/hub.ts`**
- `DraftTurnPublisher` gains `flush(text: string): void`. It records `text` as the latest text, cancels any pending throttle timer, and publishes it now — unless it equals the last published text or exceeds `DRAFT_MAX_CHARS` (both skip silently), or the turn already ended (no-op). The inner timer callback was renamed `flushLatest` so the method can reuse it without recursing.
- `end` is unchanged and never re-publishes: after `flush` with the final text, `latest === latestSent`, so `end` publishes only the outcome.

**2. Flush before the final send — `apps/server/src/agents/reply.ts`, `gateway.ts`**
- `DmTurnDeps` gains optional `beforeFinalSend?: (text: string) => void`.
- `sendReply` (the single choke point both `runDmTurn`'s plain path and `runToolTurn`'s success path go through) calls it with the exact final text immediately before `sendMessage`. Failure paths send via `deps.sendMessage` directly, so the hook never fires for failure texts; notices are only ever appended to the final text, so the hook fires once with the full text including any notice. The call sits before the send's `try`, so a hook failure reads as a turn failure (honest failure text), not a send failure.
- The gateway wires `beforeFinalSend: (text) => turnDrafts.flush(text)` in `runSessionTurn`, next to the existing `onDelta: push` wiring, and the surrounding comment now describes the flush-then-send-then-end ordering.

**3. Tail measurement — attempted live, completed analytically (see table below)**
- The dev LiteLLM proxy is alive (`/health/liveliness` → 200 `"I'm alive!"`), but a `/chat/completions` streaming call needs a real key: with a fake key it 401s (`Authentication Error, Invalid proxy server token`). `LITELLM_MASTER_KEY` is absent from my environment and `infra/.env` is off-limits per `AGENTS.md` safety rules, so I could not run the gated integration path or a keyed script. No script was committed; no key material appears in any output (the proxy even redacts the fake key as `sk-...-key`).

### Tail analysis (no live delta log available)

What the code + the T-0043 live-check numbers establish:

| Observation | Interpretation |
|---|---|
| Drafts grew 1 → 762 chars in ~1 s (updates every 100–200 ms), then ~700 ms of silence, then the final message with 1231 chars | The last ~469 chars (38%) sat in the 150 ms throttle or arrived late, and were flushed by `turnDrafts.end(...)` **after** `runDmTurn` had already sent the XMPP message — when the web client (T-0043 rule (a)) already swapped the draft for the message and ignores late drafts |
| `gateway.ts` (before this task): `turnDrafts.end(...)` ran after `await runDmTurn(...)` resolved, i.e. strictly after the final `sendMessage` | Structural cause confirmed by inspection; it alone fully explains the missing tail — no provider-burst hypothesis is needed |
| The ~700 ms pause itself | Consistent with either (a) the provider delivering the tail in one late burst, or (b) normal end-of-turn latency (stop-token / finish processing) with steady deltas that the throttle swallowed. Indistinguishable without a keyed live run |

After this fix, the complete text is flushed as a `draft` synchronously before the XMPP send regardless of which hypothesis holds. Suggested lead re-check: repeat the T-0043 long-answer live check — if drafts now grow smoothly to the full ~1231 chars, there was no burst; if a pause remains but the draft catches up to the full text just before the message lands, the provider does burst the tail (and the fix still covers it).

### Files changed (only Allowed files; `drafts/events.ts` untouched)
- `apps/server/src/drafts/hub.ts` — `flush` on the interface + implementation
- `apps/server/src/agents/reply.ts` — `beforeFinalSend` on `DmTurnDeps`, called in `sendReply`
- `apps/server/src/agents/gateway.ts` — wires `beforeFinalSend` to `turnDrafts.flush`
- `apps/server/src/drafts/hub.test.ts`, `apps/server/src/agents/reply.test.ts`, `apps/server/src/agents/gateway.test.ts` — new/updated tests
- `work/T-0044-draft-tail-flush.md` — this report + status

### Tests added
- **Hub (2):** `flush` publishes immediately inside the throttle window, cancels the pending timer (fake timers), and `end` afterwards publishes only `end`; `flush` skips identical and over-cap text and is a no-op after `end`.
- **`runDmTurn` (3):** hook receives the exact final text strictly before its `sendMessage` (order asserted); not called for failure texts; tool turn calls it exactly once with the full text + notice, before the send, never with the notice alone.
- **Gateway (1 new, 1 updated):** fake stream with all deltas in one burst — subscribers see a `draft` with the complete text before the final XMPP send, then `end:'sent'` (interleaved order log asserted). Updated the existing burst test: the last draft is now the trimmed reply (`full.trim()`), equal to the DM text — this is the intended behavior change.

### Commands (real results)
```bash
pnpm install                                        # Done in 6.9s, exit 0
pnpm --filter @galena/server exec vitest run src/drafts/hub.test.ts src/agents/reply.test.ts
                                                    # Test Files 2 passed (2); Tests 36 passed (36)
pnpm --filter @galena/server exec vitest run src/agents/gateway.test.ts
                                                    # Test Files 1 passed (1); Tests 38 passed (38)
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/server
                                                    # Test Files 37 passed (37), 5 skipped (42); Tests 412 passed, 7 skipped (419)
pnpm build                                          # Tasks: 2 successful, 2 total
git status                                          # only the 6 Allowed files + this task file
```

### Problems / deviations
- **My own test bug, fixed:** the tool-turn hook test initially expected `` `vale\n\n${notice}` ``, but `formatPersonaUpdatedLine` already starts with `\n\n` — the real text is `'vale' + notice`. Fixed the expectation; production code was correct.
- **Existing burst test updated** (`gateway.test.ts`): last draft `full` → `full.trim()`, as designed — the flush publishes the exact trimmed reply. No other existing test needed changes.
- **Hook placement:** `beforeFinalSend?.(text)` runs before `sendReply`'s `try`, so a (should-never-happen) hook throw becomes an honest turn failure rather than a silent send failure.
- **Spec item 3 partially unfulfilled:** no live delta-timing table — live measurement needs a LiteLLM key I am not allowed to read (see above). Everything else in the spec is done. No new dependencies.

### Open questions
- None blocking. One suggestion for the lead: the live re-check described above to settle the burst question.

## Review (written by Claude)

**Approved and merged.** Muse pre-review: approve. The `flush` hook runs before the final send only (not notices, not failures), with the call order asserted in tests. The gateway publishes the complete trimmed reply as a draft before the XMPP message.

- **Lead fix:** an over-cap `flush` now returns before cancelling the throttle timer, so a pending in-cap draft still goes out (new hub test).
- **Waived: the live tail-timing table.** The worker couldn't reach LiteLLM without the real key (honestly reported, with an analytical table instead). The T-0045 live check settles it: if drafts now reach the full text before the message lands, the structural cause was the whole story.
