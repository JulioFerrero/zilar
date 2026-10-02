---
id: T-0043
title: Web — show AI reply drafts from /api/drafts/stream as a growing bubble, replaced seamlessly by the final XMPP message
status: merged
milestone: M2
branch: task/T-0043-web-reply-drafts
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0041, T-0042]
estimate: 1 day
---

# T-0043: Watch the AI write

## Spec (written by Claude, do not edit)

### Goal

Julio wants a reply from his AI to appear the way ChatGPT's does: the text grows in real time instead of "typing…" followed by a full message.

T-0041 (merged) built the server half: `GET /api/drafts/stream` is an SSE stream of the signed-in user's own AI drafts. This task renders those drafts in the web app. The final message still arrives through XMPP as today, and it must **replace** the draft without a flicker, jump or duplicate.

A quiet, polished result matters more than features. Julio has been bothered by UI that flashes or jumps. The draft bubble must look exactly like the AI's final message bubble, so the swap is invisible.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/drafts/events.ts`: **the contract, read it closely** (read only)
- `apps/server/src/drafts/routes.ts` and `hub.ts`: heartbeat, no replay, throttling (read only)
- `apps/web/src/store/store.ts` and `realStore.ts`: `RealStoreDeps`, `start`/`stop`/`signOut`, `handleMessage`, `typing`, and how `status` changes
- `apps/web/src/components/MessageList.tsx`, `MessageBubble.tsx`, `ChatListItem.tsx`, `TypingDots.tsx`
- `docs/design/ui-style.md`
- `docs/LEAD_PLAYBOOK.md` gotcha 19: why fakes must be slow and how the lead live-checks loading code

### The contract (from `drafts/events.ts`)
- `event: draft`, `data: {"type":"draft","chatJid","turnId","text"}`. `text` is **cumulative**: the whole reply so far, not a delta. Drafts can be dropped (150 ms throttle), and a client that connects mid-turn simply gets the next one.
- `event: end`, `data: {"type":"end","chatJid","turnId","outcome":"sent"|"failed"}`, published **after** the server sent the final XMPP message (or the failure text).
- `chatJid` is the AI's bare JID, which is the DM's chat id in the web store.
- Lines starting with `:` are heartbeats (every 25 s). `EventSource` ignores them.
- There is no history and no replay.

Known quirks you must handle (from the T-0041 review):
1. The draft text is **untrimmed**, while the final message is trimmed. Render the draft with `text.trim()`, so the last draft and the final message are identical.
2. If the model writes some text and then calls a tool, the cumulative text can **restart** (shrink) within the same turn. Simply render the latest text.
3. SSE and XMPP are two separate channels, so the final XMPP message can reach the browser **before or after** `end`, and even before the last `draft`.

### Allowed files
- `apps/web/src/store/**`: the store state and the stream wiring, plus tests
- `apps/web/src/lib/drafts.ts` (new): the SSE client and the zod schemas for the contract, plus `drafts.test.ts`
- `apps/web/src/components/MessageList.tsx`, `MessageBubble.tsx`, `ChatListItem.tsx`, and a new `components/DraftBubble*.tsx` if you need one, plus their tests
- `work/T-0043-web-reply-drafts.md`

**Not allowed:** `apps/server/**`, `apps/mobile/**`, `packages/**`, `docs/**`, and any other web file. If you truly need one, stop, set `status: blocked` and explain.

### Allowed dependencies
None. Use the browser's `EventSource`.

### What to build

**1. The client (`lib/drafts.ts`).**
- Opens `EventSource('/api/drafts/stream')`. Same origin; the session cookie is sent automatically.
- Parses each `draft`/`end` `data` with zod schemas that **mirror** the server contract. The web app can't import server code, so copy the shape and add a comment pointing to `apps/server/src/drafts/events.ts`.
- Drops anything that fails validation, silently and without throwing.
- Exposes a small `subscribe(onEvent) => close` style API. The store gets it through a new optional `RealStoreDeps` field (e.g. `openDrafts`), so tests inject a fake. There must be no `EventSource` in tests.
- `EventSource` reconnects by itself. Don't add your own retry loop. Do close it on `stop()` and `signOut()`.

**2. The store.**
- New state: `drafts: Record<chatId, { turnId: string; text: string }>`. Add it to the `ChatStore` interface (the mock store returns `{}`).
- Open the stream once the user is known (after boot), and close it in `stop()` and `signOut()`. A `stop()` then `start()` must not leave two streams open.
- On `draft`: set `drafts[chatJid] = { turnId, text }`, **unless** that `turnId` is already finished (see below).
- **Finishing a turn.** The draft disappears when the final message is there, never earlier, so there is no gap:
  - (a) When an incoming message from the AI arrives in that DM while a draft is shown (in `handleMessage`), remove the draft in the **same** `set` that adds the message. Mark its `turnId` as finished, and ignore any later `draft` for that `turnId`.
  - (b) On `end`, if the draft is still there, keep it until the message arrives (rule a), with a fallback timeout of **5 s** after which it is removed anyway (e.g. XMPP is down). Mark the `turnId` finished.
  - Keep the finished-turn set small; for example, forget ids after a minute or keep only the last 50.
- While a chat has a draft, the typing state for that chat should not add a second indicator in the message list. The header and the chat list may keep showing "typing…".

**3. The UI.**
- `MessageList` renders the chat's draft as the **last** item, using the **same bubble component and styles** as an incoming AI message. It's the same renderer for text and links, with no ticks and no timestamp. You can add one subtle "still writing" cue, such as a soft blinking caret at the end of the text or the existing `TypingDots` inline. Follow `ui-style.md`.
- When the final message replaces the draft, nothing may move: same position, same width for the same text, no fade-in of a "new" message. Write a test that renders a draft, then the store swaps it for the final message with the same trimmed text, and checks that the list has exactly one bubble with that text before and after.
- **Scrolling:** if the user is at the bottom, a growing draft keeps the view pinned to the bottom, the same way a new message does today. If the user has scrolled up to read, a growing draft must **not** pull them down.
- `ChatListItem`: while a draft is shown, the preview line may keep the current typing label. Don't show the draft text in the list; it changes too fast.

**4. No regressions.**
- Typing indicators still work for people and for AIs when no drafts arrive (older server, stream down).
- A stream that fails or returns 401 does nothing visible, apart from the normal behavior without drafts.
- The `?mock=1` store is unaffected.

### Tests (Vitest and Testing Library, no network, no real `EventSource`)
- **`lib/drafts.test.ts`:** valid events pass through; invalid JSON and wrong shapes are dropped; `close` closes the source. Use a fake `EventSource`-like object.
- **Store:**
  - a draft appears and grows;
  - the final message **before** `end` replaces the draft in one update, and a late `draft` for the same turn is ignored;
  - the final message **after** `end` replaces the draft, which stays in between;
  - with `end` and no message, the draft disappears after 5 s (fake timers);
  - a shrinking text within a turn renders the latest;
  - `stop()` closes the stream, and a stop/start doesn't open two;
  - `signOut()` closes it.
- **UI:**
  - the draft renders as the last bubble with trimmed text;
  - swapping to the final message keeps exactly one bubble with the same text;
  - there's no second typing indicator in the list while a draft is shown;
  - when scrolled up, a growing draft doesn't change the scroll position. Mock the scroll container's properties as the existing MessageList tests do; if that isn't testable in jsdom, say so in the Report.

### Live check (the lead does it, with Julio's permission)
Give exact steps in the Report:
- open an AI DM and ask a question that needs a longer answer: the text grows smoothly, and the final message replaces it with no jump or duplicate;
- reload the page mid-answer: the draft continues from the next event;
- stop the server: no error UI, and the normal typing behavior comes back after a restart.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] The draft looks identical to the final message and is replaced without flicker, gap or duplicate, whichever of `end` and the XMPP message arrives first.
- [ ] No `any`, no `@ts-ignore`, and no `EventSource` in tests.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/web
pnpm build
```

### Out of scope
- Mobile drafts (a later task).
- Drafts in groups (the server only streams DM turns).
- A "stop generating" button.

## Report (written by the worker when done)

### What I did

**1. SSE client — `apps/web/src/lib/drafts.ts` (+ `drafts.test.ts`)**
- `subscribeToDrafts(onEvent, createSource?) => close`. Opens `new EventSource('/api/drafts/stream')` (same origin, cookie sent by the browser), registers `addEventListener('draft'|'end')`, and returns `close` that calls `source.close()`. No retry loop (EventSource reconnects itself); a missing/undefined `EventSource` is caught and becomes a no-op.
- Zod schemas mirror `apps/server/src/drafts/events.ts` exactly (`type`, `chatJid`, `turnId: uuid`, `text`; `end` adds `outcome`). Invalid JSON and wrong shapes are dropped silently. Heartbeats (`:`) never reach a listener.
- Injected into the store through the new optional `RealStoreDeps.openDrafts`; tests pass a fake object, so no real `EventSource` is created in tests.

**2. Store — `store.ts` / `realStore.ts`**
- New state `drafts: Record<chatId, { turnId; text }>` on `ChatStore`; the mock store returns `{}`.
- The stream opens in `boot()` right after `me` is set, guarded by `generation` and by "already open". `stop()` closes it, clears the fallback timers and the finished-turn set, and empties `drafts`; `signOut()` calls `stop()`. A `stop()` then `start()` opens exactly one new stream (tested).
- `draft` sets `drafts[chatJid] = { turnId, text }` unless the turn is already finished. Text can shrink (tool call); the latest text always wins.
- Finishing: (a) an incoming XMPP message in that DM removes the draft in the **same** `set` that adds the message and marks the turn finished, so no gap and no duplicate; (b) `end` marks the turn finished, keeps the draft and schedules a 5 s fallback (`DRAFT_END_FALLBACK_MS`) that removes it only if the same turn is still shown. Finished turn ids are capped at the last 50.
- A new turn's draft cancels a previous turn's fallback and is never removed by it (tested with fake timers).

**3. UI — `MessageList.tsx` / `MessageBubble.tsx`**
- `MessageList` appends a synthetic draft message to the chat's messages and runs the existing `groupMessages`, so grouping flags (margin, tail) match the real final message. It is rendered with the same `MessageBubble`.
- `MessageBubble` gained an optional `draft` prop: no actions button/menu, no ticks; the time is rendered `invisible` (visibility:hidden) to **reserve the exact width** the final message's time will take (it uses `tabular-nums`, so `HH:mm` width is constant), and a zero-layout-width blinking caret is added at the end of the text. This keeps the swap from moving or resizing the bubble.
- Scrolling: a growing draft pins the view to the bottom only when `atBottom`; when the user scrolled up it never changes `scrollTop` (tested by mocking the scroll container in jsdom).
- `ChatListItem` was left unchanged: it never showed draft text and keeps its normal typing label.

### Files changed
- `apps/web/src/lib/drafts.ts` (new), `apps/web/src/lib/drafts.test.ts` (new)
- `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.ts`
- `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageList.test.tsx`
- `work/T-0043-web-reply-drafts.md`

No other files touched (`git status` confirms). No new dependencies.

### Tests added
- `lib/drafts.test.ts`: valid draft/end pass through; invalid JSON/shapes dropped; `close` closes the source; a throwing source factory is a no-op.
- `realStore.test.ts` (8): stream opens after boot and grows; message **before** `end` replaces the draft in one update (no gap/no duplicate) and a late same-turn draft is ignored; message **after** `end` replaces a draft that stays in between; 5 s fallback with fake timers; shrinking text renders the latest; next turn replaces a finished draft and isn't removed by the stale fallback; `stop()` closes and a start-after-stop opens only one; `signOut()` closes.
- `MessageList.test.tsx` (4): draft renders as the last bubble with trimmed text; swapping to the final message keeps exactly one bubble with the same text (before and after); no second typing indicator in the list while a draft is shown; a growing draft does not change `scrollTop` while scrolled up.

### Commands (real results)
```bash
pnpm install                                        # Already up to date (910 packages on the first run)
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/web   # Test Files 31 passed (31); Tests 178 passed (178)
pnpm build                                          # Tasks: 2 successful, 2 total; web built in 419ms
```

### Problems / notes
- **Pre-existing flaky test.** `NewChatButton.test.tsx > creates a group from the dialog and opens it` uses `findByText` with the default 1 s timeout and is timing-sensitive. It failed intermittently (2/5 runs) **with my changes and also 2/5 runs with my changes stashed**, so it is not caused by T-0043. The required `turbo test --force` command passed (178/178) on the recorded run. Left untouched (out of scope, not an Allowed file).
- **"No second typing indicator in the message list".** The message list never rendered a typing indicator before this task; typing lives in the chat list and the header. The draft bubble is therefore the only in-list cue and there is nothing to suppress; the test asserts the list contains the draft text and no `typing` text while both states are set.
- **Invisible timestamp.** The draft's time is `visibility:hidden`, not absent from the DOM, so the bubble width already equals the final message's. It is visually absent (no ticks, no time). If a truly absent node is required, the no-jump guarantee needs a different spacer.
- **Empty draft text.** A draft whose trimmed text is empty renders nothing (no empty bubble); the header/chat list still show `typing…`.
- **Open question / risk.** Rule (a) now applies only to an incoming message from the AI's own JID (see Review fixes). If the runner ever sends a mid-turn card (progress/approval) from the AI's JID as an XMPP message before the final reply, the draft would still end early. The spec states rule (a) for "an incoming message from the AI", so this is implemented as written; flagging in case the lead wants it limited to text messages.

### Review fixes (on top of 17e1960)
1. **Only the AI's message finishes a draft** (`realStore.ts`, `handleMessage`): compute `const fromAi = message.fromJid === chatId && !isOwnSender(message.fromJid)` and only mark the turn finished / clear the draft when true. A message from my own JID (second device) and any other sender now leave the draft running and later drafts of the turn still apply. New test `keeps the draft when my own JID sends a message during the turn` asserts the draft survives an own-JID message and a later same-turn draft still applies.
2. **Fixtures aligned with production** so the "nothing moves" path is real:
   - `realStore.test.ts`: the AI messages in the draft tests now use `fromJid: CHAT` (the DM's own/AI JID) instead of a separate `ai@zilar.test`, matching the draft's sender.
   - `MessageList.test.tsx`: `hello()` now has `senderId: 'c-ana'` (the chat id the draft uses for the AI), and the swap test records the bubble's `className` before and after and asserts they are equal, in addition to "one bubble with the same text before and after".
3. **Idle drafts expire** (`realStore.ts`): new exported `DRAFT_IDLE_MS = 60_000`, next to `DRAFT_END_FALLBACK_MS`. Every `draft` (re)arms one removal timer per chat through a new `armDraftRemoval(chatJid, turnId, delay)` helper, which reuses the existing `draftTimeouts` map and only removes the draft when that same turn is still shown (then marks the turn finished). `end` replaces the idle timer with the 5 s fallback via the same helper; a final message and `stop()` clear it as before. This covers a dead turn after a server restart mid-turn (SSE reconnects without replay) so the bubble cannot stick forever. New tests (fake timers): a draft with no further event disappears after 60 s and a late same-turn draft does not revive it; a draft refreshed at 50 s is still there at 100 s and gone 60 s after the refresh; the existing test still verifies the 5 s `end` fallback.

Re-run results after the fixes:
```bash
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/web   # Test Files 31 passed (31); Tests 181 passed (181)
pnpm build                                          # Tasks: 2 successful, 2 total
pnpm format:check                                   # All matched files use Prettier code style!
```

`pnpm format:check` is fully green now: the only earlier warning was the pre-reviewer's untracked `PREREVIEW.md`, which is no longer in the worktree; every file I changed was clean throughout.


### Live check (for the lead, with Julio's permission)
1. Open an AI DM and ask a question that needs a longer answer. The reply text should grow smoothly in an incoming bubble; when the final message arrives it must replace the draft with no jump, resize, gap or duplicate (same position, same bubble). Check both orderings happen naturally across a few turns.
2. Reload the page mid-answer. The draft should reappear from the next cumulative event (no history is replayed) and the final message should still replace it cleanly.
3. Stop the server (or the draft route). No error UI appears; the message list keeps working, and after a restart the normal typing indicator (list/header) and drafts come back together.
4. Note `AGENTS.md` gotcha 19: reload the live app inside a chat with real history before merging, since this touches store/loading code.

## Review (written by Claude)

**Approved and merged** (17e1960, 8fc9875, 78b4382 + lead fixes f9f5f63 and the gap test). Four Muse pre-review rounds.

- Round 1: only an incoming message from the AI's JID may finish a draft (not an own-device message); fixtures aligned with production senders. Fixed by the worker.
- Round 2: a draft with no further event stuck forever (server restart mid-turn). The worker added `DRAFT_IDLE_MS` (60 s).
- Round 3: my instruction was wrong. The idle expiry marked the turn finished, so a turn resuming after a slow (>60 s) tool call would lose its drafts. **Lead fix f9f5f63:** idle expiry removes the bubble without finishing the turn. Note: the Report's line saying "a late same-turn draft does not revive it" describes 78b4382, not the final code, where a resumed turn shows again. The swap test now also rejects a gap (exactly one of draft or message in every update).
- Accepted: the 60 s idle expiry can hide a draft during a very long tool call (it reappears when the turn resumes). A notice message from the AI just before the final reply ends the draft one message early, and nothing is lost.

**Live check** (lead, in Julio's Helium, branch served on localhost:5174, one question to "deep test" with Julio's OK): the draft appeared about 1.2 s after sending and grew from 1 to 762 characters in about 1 s, updating every 100–200 ms. The final message replaced it with no duplicate (12 bubbles before and after), and the bubble's bottom edge stayed at the same pixel throughout (pinned, no jump). Observed: the last ~40% of the text (762 → 1231 characters) arrived together with the final message after a ~700 ms pause with no drafts. That's filed as a follow-up to investigate on the server side (the tail of the stream vs the throttle and the final send). Not live-checked: reload mid-answer (covered by tests; cumulative text).
