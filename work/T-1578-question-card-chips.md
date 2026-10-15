---
id: T-1578
title: "AI questions step 5 (plan docs/audit/handoff-questions-plan.md, twins): web and phone render a 'question' card (the AI's question + 2-4 reply chips) in place of its fallback text; a chip tap sends a normal reply (text = the option, replyTo = the question, @mention of the AI); mock seeds QA-1's question in the Checkout topic; web handoff line a11y fix"
status: merged
milestone: M5
branch: task/T-1578-question-card-chips
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1578: The question card with reply chips

## Spec (written by Claude, do not edit)

### Why
The approved AI work boards (`docs/design/mockups/ai-work/Main.dc.html`, `Phone.dc.html`) show QA-1's question with reply chips. Background:
- T-1576 made the `ask_people` tool post a `question` payload `{ id, ai, question, options[2-4] }` (`packages/protocol/src/question.ts`), whose fallback body is the question plus `n. option` lines;
- the lead's answers (`work/T-1566-audit-handoff-questions.md` › Review, item 4): a chip tap sends a **normal message**, a reply to the question that @mentions the asking AI. Closing the question server-side is step 6.

**D24:** no status words, and the chips are plain outline pills.

### Facts (the lead read them on main after T-1576, 2026-10-15)
- **Clients** store the payload as `message.card` (`packages/client-core/src/store/ledger-incoming.ts:191-203`).
- **Web:** `apps/web/src/components/message/AttachmentBody.tsx:245-255` draws only `progress` and `approval.request` cards, with the text shown separately.
- **Web handoff line:** `apps/web/src/components/message/HandoffLine.tsx` has `role="note"` on a `<button>` (T-1575 nit 1). It should be a plain button with `aria-expanded`.
- **The phone:**
  - `PayloadCard` in `apps/mobile/src/components/chat/payload-card.tsx` switches `progress` and `approval.request`;
  - `isRenderedCard` gates the card branch in `apps/mobile/src/components/chat/message-bubble-content.tsx:182` (T-1572).
- **Sending:**
  - both stores have `sendText(chatId, text, { replyTo?: ReplyRef, mentions?: UiMention[] })` (`apps/mobile/src/store/types.ts:148`; web via `storeApi.getState().sendText` in `apps/web/src/components/Composer.tsx:275`);
  - `UiMention` is `{ jid, name, begin, end }` (UTF-16 offsets) and `ReplyRef` is `{ id, senderName, … }` (`packages/chat-core/src/types.ts:38-66`).
- **The mock:**
  - the Checkout topic `t-devteam-bug@rooms.zilar.test` (seeded in `packages/mock-backend/src/domains/topics/seed.ts`) shows QA-1 "waiting";
  - message builders are in `packages/mock-backend/src/domains/messages/builders.ts` (`progressCard`, `approvalCard`, `handoffLine`);
  - the QA-1 JID is `JIDS.qa1` (`threads/shared.ts:38`);
  - find the thread file for that topic (the phone smoke showed "No messages yet" there; add a small thread if none exists).

### Steps
1. **Mock:**
   - `builders.ts` gains `questionCard(id, question, options)` (`ai: JIDS.qa1`);
   - the Checkout topic gets QA-1's message "Which iPhone should I test on?" with options `["iPhone 15", "iPhone 12", "Both"]`, its fallback text as the body, and the `question` payload.
2. **Web:** new `apps/web/src/components/message/QuestionCard.tsx`:
   - the question (14 px, foreground), then the chips in a wrapping row (outline pills, 13 px);
   - a chip click calls `sendText(chatId, '@<AI name> <option>', { replyTo: { id: message.id, senderName: <AI name> }, mentions: [{ jid: card.data.ai, name, begin: 0, end: name.length + 1 }] })`;
   - after one tap in this session, that card's chips are disabled; the server closes it in step 6;
   - `AttachmentBody.tsx` renders it for `card.type === 'question'` **in place of** the body text (the fallback).
3. **Web handoff line:** in `HandoffLine.tsx`, remove `role="note"`, keep the `aria-label`, and add `aria-expanded`.
4. **The phone:** new `apps/mobile/src/components/chat/question-card.tsx`, the same card. A chip is a `Pressable` with `accessibilityRole="button"`, and the press does the same send through the phone store.
   - `PayloadCard` gains the `question` case, and `isRenderedCard` includes `question`, so the bubble draws the card instead of the fallback text.
5. **Every file stays under 400 lines.**

### Not in scope
- the server;
- closing the question (step 6);
- the "AIs here" row (step 8).

### Tests
None (UI).

### Allowed files
- `packages/mock-backend/src/domains/messages/builders.ts`
- `packages/mock-backend/src/domains/messages/threads/dev-team.ts`
- `packages/mock-backend/src/domains/messages/threads/checkout.ts` (new, only if the topic has no thread file; register it the way the other threads are registered, and list any registry file you touch in the Report)
- `packages/mock-backend/src/domains/messages/threads/index.ts` (only to register a new thread)
- `apps/web/src/components/message/QuestionCard.tsx` (new)
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/MessageBubble.tsx` (added by the lead after the block: hide the question's fallback text; at most a few lines, the file is 367)
- `apps/web/src/components/message/HandoffLine.tsx`
- `apps/mobile/src/components/chat/question-card.tsx` (new)
- `apps/mobile/src/components/chat/payload-card.tsx`
- `work/T-1578-question-card-chips.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Web mock `/c/t-devteam-bug%40rooms.zilar.test?mock=1`:** QA-1's "Which iPhone should I test on?" with three chips.
- **Clicking "iPhone 15"** adds a reply "@QA-1 iPhone 15" quoting the question.
- **The phone mock `/chat/t-devteam-bug@rooms.zilar.test`** shows the card with chips.

---

## Report (written by the worker when done)

### What I did

- **Mock** (`packages/mock-backend/src/domains/messages/`):
  - `builders.ts`: added `questionCard(id, question, options)` returning a `question` payload with `ai: JIDS.qa1`.
  - `threads/checkout.ts` (new): the Checkout topic `t-devteam-bug@rooms.zilar.test` gets a small thread — Dev-1 says "PR #42 is on staging." and hands the check to QA-1, then QA-1 posts "Which iPhone should I test on?" with options `["iPhone 15", "iPhone 12", "Both"]`, its T-1576 fallback text as the body, and the `questionCard` payload.
  - `threads/index.ts`: registered `'t-devteam-bug@rooms.zilar.test': checkoutMessages` (the one registry file I touched).
- **Web** (`apps/web/src/components/message/`):
  - `QuestionCard.tsx` (new): the question (14 px, foreground), then the chips as wrapping outline pills (13 px). A chip calls `sendText(chatId, '@<AI name> <option>', { replyTo: { id: messageId, senderName }, mentions: [{ jid: card.ai, name, begin: 0, end: name.length + 1 }] })`, and disables every chip on that card after the first tap this session.
  - `AttachmentBody.tsx`: renders `QuestionCard` for `card.type === 'question'` (aiName = `message.senderName`, chatId = `chat.id`, messageId = `message.id`).
  - `MessageBubble.tsx`: `bodyText = hasText && !hidesBodyText(message.card)` (the helper lives in `QuestionCard.tsx`), used only for the two body renderers, so a question card hides the fallback text while `canCopy={hasText}` and the message text (replies, search) are untouched.
  - `HandoffLine.tsx`: removed `role="note"`, kept the `aria-label`, added `aria-expanded`. The value is a local flag that flips on the same click as the row's open state, so both stay in step (it only feeds the attribute).
- **Phone** (`apps/mobile/src/components/chat/`):
  - `question-card.tsx` (new): the same card; each chip is a `Pressable` with `accessibilityRole="button"`, disabled after one tap.
  - `payload-card.tsx`: added the `question` case, and `isRenderedCard` now includes `'question'`, so the bubble draws the card instead of the fallback text.
- Every touched file is under 400 lines.

### Checks run

- `pnpm gate` from the repo root (final run, after the `MessageBubble.tsx` guard; an earlier run failed only on the format of the new `checkout.ts`, fixed with `pnpm exec prettier --write` on that one file):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (2.6s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.1s)
SKIP tests @zilar/mock-backend (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run: the change is UI + a mock seed, and the task says "Tests: None (UI)".
- Only the rendering hides the text: `MessageBubble` keeps `canCopy={hasText}` (copy reads `message.text`), the reply quote reads the replied-to message, and `message.text` is unchanged for search.

### Blocked / needs a decision (resolved)

The web fallback text was hidden with the lead's approval: `MessageBubble.tsx` now passes `bodyText` (false for a `question` card) to `AttachmentBody` and `MessageTextBody`, so the card draws in place of the fallback; the text stays on the message and `canCopy` keeps using `hasText`. The mock keeps the fallback `body` per the spec. No further decision is needed.

### Notes for the lead

- **Phone reply context:** `PayloadCard` is called as `<PayloadCard card={message.card} />` (`message-bubble-content.tsx:184`, not in the Allowed files), so the phone `QuestionCard` resolves its own message from the store (`activeChatId` + `messages`) to build `replyTo` (the message id) and the AI name. Passing the message down from `message-bubble-content.tsx` would be cleaner if you allow it.
- **Handoff `aria-expanded`:** the open state lives in `MessageListRow.tsx` (not in the Allowed files), so `HandoffLine` mirrors it locally; the two flip together on each click and mount/unmount together, so they stay in step.

## Review (written by Claude)

**Approved and merged.**

- **The block:** the worker blocked once because web drew the fallback text from `MessageBubble.tsx`. The lead added that file, and a question card now hides its fallback text.
- **Pre-review:** clean, with 1 nit and 1 follow-up.
- **Web, headless** (`/c/t-devteam-bug%40rooms.zilar.test?mock=1`, at 1280 and 390 px):
  - QA-1's "Which iPhone should I test on?" shows with three chips (iPhone 15, iPhone 12, Both), and no "1. …" fallback lines;
  - clicking "iPhone 15" sends "@QA-1 iPhone 15" as a reply quoting the question, and the chip is then disabled;
  - no sideways scroll, and 0 page errors.
- **Phone smoke** (`/chat/t-devteam-bug@rooms.zilar.test`): PASS. The card shows the question and the three chips.
- **Handoff line:** `role="note"` is gone and the line has `aria-expanded`.
- **Left as they are:**
  - the reply's quote shows the question's fallback text with its numbered options;
  - `aria-expanded` mirrors the row's open state locally;
  - chip keys would collide on a duplicate option.
