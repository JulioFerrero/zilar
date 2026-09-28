---
id: T-0043
title: Web — show AI reply drafts from /api/drafts/stream as a growing bubble, replaced seamlessly by the final XMPP message
status: planned
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
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Mobile drafts (a later task).
- Drafts in groups (the server only streams DM turns).
- A "stop generating" button.

## Report (written by the worker when done)

## Review (written by Claude)
