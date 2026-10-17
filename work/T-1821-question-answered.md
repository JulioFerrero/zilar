---
id: T-1821
title: "An AI question card stays answered after a reload: web and phone find the first reply that quotes the question in the loaded messages and show the chips disabled, the picked option filled and '{name} answered'"
status: merged
milestone: M5
branch: task/T-1821-question-answered
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1821: The question card stays answered

## Spec (written by Claude, do not edit)

### Why
**Live check on 2026-10-17 in "ai test › cards test":** an AI question card (the `ask_people` tool) was answered "Sushi", then the page was reloaded. The chips were tappable again.
- **Why:** both apps keep "answered" only in component state (web `QuestionCard.tsx:40`, phone `question-card.tsx:28`).
- **Why the history is enough:** a chip tap sends a normal reply that quotes the question (`replyTo.id` = the question message id), and the server closes the question on the first reply (`apps/server/src/agents/gateway/question-answer.ts:51-87`). A reply is always newer than the question, so when the question is loaded, its reply is too.

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/message/QuestionCard.tsx` (75 lines).
  - `QuestionCard({question, aiName, chatId, messageId})`, with `useState(false)` for `answered` (`:40`).
  - The chips are at `:56-71`. It is mounted from `apps/web/src/components/message/AttachmentBody.tsx:301-308`.
  - The store hook is `useChatSelector(selector)` (`apps/web/src/store/ChatStoreProvider.tsx:112`). Selectors must return stable values: an existing message object or `undefined` is fine, a new array or object is not.
  - `state.messages(chatId)` is oldest first (`apps/web/src/components/Composer.tsx:230` reverses it to find the last).
- **Phone:** `apps/mobile/src/components/chat/question-card.tsx` (66 lines).
  - It finds its own message with `useChatStore((state) => state.messages(chatId).find(...))` (`:18-27`), and keeps `useState(false)` for `answered` (`:28`).
- **The message type:** `UiMessage` in `packages/chat-core/src/types.ts:68-100` has `id`, `senderId`, `senderName`, `text?` and `replyTo?: ReplyRef` (`{ id, senderName, … }`, `:38`).
- **`packages/chat-core/src/index.ts`** (57 lines) re-exports each module with `export * from './x'`.

### Steps
1. **New file `packages/chat-core/src/question-answer.ts`**, exported from `index.ts`. It holds two pure helpers:
   - `isQuestionAnswer(message: UiMessage, question: UiMessage): boolean`: true when `message.replyTo?.id === question.id` and `message.senderId !== question.senderId`.
   - `answeredOption(text: string | undefined, aiName: string, options: readonly string[]): string | undefined`: trims, drops a leading `@{aiName}`, trims again, and returns the option equal to the rest (case-insensitive), or `undefined`.
2. **Web `QuestionCard`:** select the reply with `useChatSelector((state) => state.messages(chatId).find(...))`, where the predicate uses `isQuestionAnswer` against the question message. Select the question message itself the same way, by `messageId`; the selector returns the found object or `undefined`.
   - **When a reply exists or the local tap happened:** every chip is disabled, and the chip equal to `answeredOption(reply.text, aiName, options)` gets a filled look (`bg-white/10 border-transparent`, no `opacity-50`).
   - **Under the chips,** one line `text-[12px] text-muted-foreground`: "{reply.senderName} answered". Before the reply has arrived after a local tap, show nothing new.
3. **Phone `QuestionCard`:** the same, using the message it already resolves at `:18-27`. The filled chip uses `bg-surface-raised border-transparent`, and the line is `text-[13px] text-muted-foreground`.
4. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/question-answer.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/QuestionCard.tsx`
- `apps/mobile/src/components/chat/question-card.tsx`
- `work/T-1821-question-answered.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- After a reload, a question card that has a reply in the loaded messages shows disabled chips, the picked one filled, and "{name} answered", on both apps.
- An unanswered card is unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/question-answer.ts` (new):** two pure helpers. `isQuestionAnswer(message, question)` is true when the message's `replyTo.id` equals the question's id and the sender differs; `answeredOption(text, aiName, options)` trims, drops a leading `@{aiName}`, trims again and returns the option equal to the rest case-insensitively (else `undefined`).
- **`packages/chat-core/src/index.ts`:** re-exported the new module.
- **Web `apps/web/src/components/message/QuestionCard.tsx`:** selects the question message by `messageId` and the first reply that quotes it (two `useChatSelector` calls, each returning an existing message object or `undefined`). When a reply exists or a local tap happened, all chips are disabled; the chip matching `answeredOption(reply.text, aiName, options)` gets `bg-white/10 border-transparent` and no `opacity-50`, the others keep `opacity-50`. Under the chips, `{reply.senderName} answered` in `text-[12px] text-muted-foreground`, shown only once the reply is in the loaded messages (a local tap alone shows nothing new).
- **Phone `apps/mobile/src/components/chat/question-card.tsx`:** same logic, reusing the message it already resolves and searching its `chatId` for the quoting reply. The picked chip uses `bg-surface-raised border-transparent`; the line is `text-[13px] text-muted-foreground`.
- No tests, per spec step 4, and no file exceeds 400 lines.

### Checks run

- `pnpm install` — `Done in 13.2s using pnpm v10.32.1` (after the quota interruption).
- No standalone test run: no test file is near the change (`packages/chat-core` has no test for the new module and the spec says no tests; the web/mobile changes are UI).
- `pnpm gate` — from the repo root:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.1s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (1.8s)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Behavior depends on the reply being newer than the question and therefore loaded with it, as the spec states; a reply outside the loaded page shows the card unanswered until that page loads. No extra fetching was added.
- I did not run a live browser/phone check, so the visual result (filled chip, `{name} answered` line) is verified by typecheck/lint only; it needs the lead's smoke test.
- `answeredOption` matches options case-insensitively but drops the mention only for an exact `@{aiName}` prefix, as specified.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `882ff6dd2`.
- **chat-core `question-answer.ts`:** `isQuestionAnswer` and `answeredOption`.
- **Web and phone cards:** each finds the question and its first quoting reply with selectors that return existing message objects. While a reply exists or after a local tap, the chips are disabled, the picked chip is filled, and "{name} answered" shows.
- **The lead checks it live** after the deploy, on the "Sushi" question in "cards test".

