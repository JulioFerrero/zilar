---
id: T-1586
title: "AI questions step 8 (docs/audit/handoff-questions-plan.md): a waiting AI with an open question opens that question in the chat (web AisHereKey + AiStatusLine, phone ais-here-sheet + ai-status-line) via openAtMessage instead of /settings/approvals; a question card refreshes the topic list like progress and approval cards; questionId declared on the server's TopicActivityEntry; the mock's waiting QA-1 carries its question's message id"
status: merged
milestone: M5
branch: task/T-1586-ais-here-opens-question
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1586: "AIs here" opens the question

## Spec (written by Claude, do not edit)

### Why
This is step 8 of `docs/audit/handoff-questions-plan.md`.
- **What's merged:** an open question makes its AI "waiting", and the topic activity carries the question's message id as `questionId` (T-1577). The question card with chips is on web and phone (T-1578).
- **What's wrong today:** tapping a waiting AI goes to Approvals, even when what it waits for is a question in this chat.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **Web `apps/web/src/components/topic/AisHereKey.tsx` (141):** a `waiting` entry is a `Link to="/settings/approvals"` (`:123-132`).
- **Web `apps/web/src/components/topic/AiStatusLine.tsx` (60):** "is waiting for you" (`:15-18`). Check whether the line is clickable today.
- **Phone `apps/mobile/src/components/chat/ais-here-sheet.tsx` (137):** a waiting row's `onPress={onOpenApprovals}` (`:62-72`). `openApprovals` closes the sheet and pushes `/settings/approvals` (`:119-122`).
- **Phone `apps/mobile/src/components/chat/ai-status-line.tsx` (52).**
- **`openAtMessage(chatId, messageId)`:**
  - web store: `apps/web/src/store/store.ts:147`, used as `storeApi.getState().openAtMessage(...)` in `apps/web/src/components/MessageSearchResults.tsx:33`;
  - phone store: `apps/mobile/src/store/types.ts:135`, used in `apps/mobile/src/components/chat/search-jump.ts:41`.
- **`packages/client-core/src/store/activity-refresh.ts` (62):** `:31-40` refreshes the chat list for a `progress` payload and an `approval.request`, but not for `question`.
- **`apps/server/src/topics/types.ts` (80):** `TopicActivityEntry` (`:38-45`) lacks `questionId?`, though T-1577 sends it.
- **The mock:**
  - `packages/mock-backend/src/domains/topics/seed.ts:55-58` has QA-1 `waiting` in the Checkout topic, with no `questionId`;
  - the question message is `msg('bug-3', …)` with `questionCard('q-bug-1', …)` in `packages/mock-backend/src/domains/messages/threads/checkout.ts:24-27`. Read `msg()` for the message id that clients see.

### Steps
1. **Web and phone, the "AIs here" list and the status line:** a waiting entry **with** `questionId` opens the question.
   - **Web:** `openAtMessage(chatId, questionId)`; close the popover first.
   - **Phone:** close the sheet, then `openAtMessage`, the way `search-jump.ts` jumps.
   - **A waiting entry without `questionId`** keeps going to Approvals, as today.
   - **The status line:** if it is not clickable today, make the waiting name open the question the same way. Keep the text unchanged.
2. **`activity-refresh.ts`:** a `question` payload without a correction also refreshes, like `approval.request`. Add one case to the existing test file next to it.
3. **`apps/server/src/topics/types.ts`:** add `questionId?: string` on `TopicActivityEntry`, with a one-line comment (T-1577).
4. **The mock:** QA-1's waiting entry in `topics/seed.ts` gets the `questionId` the clients see for `bug-3`.
5. **Sizes:** every file stays under 400 lines.

### Tests
One case in the `activity-refresh` test, as in step 2.

### Allowed files
- `apps/web/src/components/topic/AisHereKey.tsx`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/mobile/src/components/chat/ais-here-sheet.tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx`
- `packages/client-core/src/store/activity-refresh.ts`
- `packages/client-core/src/store/activity-refresh.test.ts`
- `apps/server/src/topics/types.ts`
- `packages/mock-backend/src/domains/topics/seed.ts`
- `packages/mock-backend/src/domains/topics/tables.ts` (added by the lead after the block: `questionId?` on `MockTopicActivity`)
- `packages/mock-backend/src/domains/topics/view.ts` (added by the lead after the block: `buildTopicView` passes `questionId` through)
- `work/T-1586-ais-here-opens-question.md`

### Checks
```bash
cd packages/client-core && pnpm exec vitest run src/store/activity-refresh.test.ts --reporter=dot
pnpm gate
```

### Acceptance
**Web mock, Checkout topic** (`/c/t-devteam-bug%40rooms.zilar.test?mock=1`): open "AIs here" and click QA-1 → the chat scrolls to QA-1's question card, and the URL stays on the topic.

---

## Report (written by the worker when done)

### What I did

Steps 1–5 are done.

- **Web `apps/web/src/components/topic/AisHereKey.tsx`:** a `waiting` row that carries
  `questionId` now closes the popover (`onNavigate`) and runs
  `store.getState().openAtMessage(chatId, questionId)`, then `scrollToMessage(questionId)` on the
  next frame — the same jump a search hit makes (`MessageSearchResults.tsx`). A `waiting` row
  without `questionId` keeps the `/settings/approvals` link.
- **Web `apps/web/src/components/topic/AiStatusLine.tsx`:** the waiting AI's name is now a
  `<button>` that jumps to its question the same way; the sentence text is unchanged. Non-waiting
  names stay a plain `<span>`.
- **Phone `apps/mobile/src/components/chat/ais-here-sheet.tsx`:** a `waiting` row with
  `questionId` closes the sheet and calls the store's `openAtMessage(chat.id, questionId)` (which
  sets `jumpTarget`, so the message list scrolls); without `questionId` it still goes to Approvals.
- **Phone `apps/mobile/src/components/chat/ai-status-line.tsx`:** the waiting AI's name is tappable
  and jumps via `openAtMessage`; text unchanged. The jump is a best-effort Effect
  (`Effect.tryPromise(...).pipe(Effect.ignore)`), like `_layout.tsx`'s `bestEffort`.
- **`packages/client-core/src/store/activity-refresh.ts`:** a `question` payload with no correction
  now counts as AI activity (the `approval.request` branch), so a question card refreshes the topic
  list. Doc comment updated.
- **`packages/client-core/src/store/activity-refresh.test.ts`:** added one case, "accepts a question
  card" (7 tests now).
- **`apps/server/src/topics/types.ts`:** added `questionId?: string` to `TopicActivityEntry`
  (T-1577) with a one-line comment.
- **Mock:** `MockTopicActivity` gained `questionId?` (`topics/tables.ts`), `buildTopicView` passes
  it through only when set (`topics/view.ts`), and QA-1's waiting entry in `topics/seed.ts` carries
  `questionId: 'bug-3'` — the message id clients see for its question card.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/activity-refresh.test.ts`
  → **7 passed (1 file)**.
- `pnpm --filter @zilar/mock-backend typecheck` → clean (the seed's `questionId` now types).
- **Web acceptance (mock, headless Chromium via Playwright)** — `/c/t-devteam-bug%40rooms.zilar.test?mock=1`:
  the "AIs here" menu row read **"QA-1 | is waiting for you"**; clicking it left the URL on the topic
  (`urlStaysOnTopic: true`) and scrolled the question card `[data-message-id="bug-3"]` into view
  (`cardInViewport: true`; its text: "Which iPhone should I test on?" with iPhone 15 / iPhone 12 /
  Both). **0 page/console errors.** (A throwaway script under the temp dir, modeled on
  `scripts/screenshots.ts`; the Vite dev server was its child and was stopped with it. Deleted
  after the run.)
- `pnpm gate` → **GATE PASS**. Summary lines:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (1.3s)
  PASS  tests @zilar/mobile  (0.9s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (6.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- An earlier gate run failed on the `effect` ratchet (`ai-status-line.tsx needs Effect (W4)`); fixed
  by using the Effect best-effort pattern, and the runs since are green.

### Resolved after the block

The lead added `packages/mock-backend/src/domains/topics/tables.ts` and `view.ts` to the Allowed
files, so the mock now carries `questionId` end to end — (a) `MockTopicActivity.questionId?`,
(b) `buildTopicView` passes it through only when set, (c) QA-1 seeded with `questionId: 'bug-3'` —
and the Checkout acceptance above passes.

### Notes for the lead

- The mock now emits `questionId` on QA-1's Checkout row through both `/api/chats` and
  `/groups/:id/topics` (`buildTopicView` maps it only when set).
- Web: the "AIs here" key and the status line only render inside a topic, so the jump needs no route
  change and the URL stays on the topic, as the acceptance asks.
- Phone: the sheet is mounted inside the chat screen, so the jump only sets the store's `jumpTarget`
  (the message list's existing jump effect, `use-message-list-scroll.ts`) instead of pushing the
  route again.
- `ais-here-sheet.tsx` already imports `effect` (for `useQuery`), so its new raw-promise `.catch`
  passes the effect ratchet; `ai-status-line.tsx` uses the Effect best-effort pattern the ratchet
  requires.

### Round (fix round 1)

- **Finding 1 (should-fix) fixed** — `apps/web/src/components/topic/AisHereKey.tsx`: the
  `openQuestion` action moved out of `AisHereRow` and into `AisHereKey`, which stays mounted while
  the popover closes. The row now calls the parent's action via a new `openQuestion` prop, so
  `onNavigate()` (which unmounts the row) can no longer dispose the row's atom mid-jump and
  interrupt the running `openAtMessage` on a slow history fetch. No other behaviour changed.
- **Findings 2 and 3 (nits) left untouched**, as instructed: neither sits in a line this round
  changed.
- **Tests added: none.** The fix is web UI code; AGENTS.md ("Tests") says UI code gets no tests
  (the lead's phone smoke and Julio's live checks cover it), the task's Tests section names only the
  `activity-refresh` case, and finding 1 names no test.
- **Single tests:** none applicable — the round touched no file with a nearby test
  (`tests @zilar/web` SKIPs in the gate).
- **`pnpm gate`** → **GATE PASS** (11 changed files against main):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/client-core  (1.4s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (6.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Disagreements

None.

## Review (written by Claude)

**Approved and merged after one block and one autofix round.**

- **The block:** the mock's `MockTopicActivity` type and its topic view dropped `questionId`. The lead added both files.
- **Pre-review:** clean after the autofix round (the popover race), with 2 nits.
- **Web, headless** (`/c/t-devteam-bug%40rooms.zilar.test?mock=1`):
  - the key reads "AIs here: Dev-1 is working, QA-1 is waiting for you";
  - clicking "QA-1 is waiting for you" closes the popover and keeps the URL on the topic, with the question card visible;
  - the status line's "QA-1" does the same;
  - 0 page errors.
- **The phone, read in code:** `ais-here-sheet.tsx` sends a waiting row with `questionId` to `openQuestion`: close the sheet, then `openAtMessage(chat.id, id)`, the way a search hit jumps. A row without one still goes to Approvals. `ai-status-line.tsx` matches.
- **Tests:** the lead ran `activity-refresh.test.ts` on the branch (7 passed); the new case is the `question` refresh.
- **Server:** `questionId?` is now declared on `TopicActivityEntry`.
- **Left as they are:**
  - a failed jump is silent;
  - the module comment in `activity-refresh.ts:1-7` doesn't mention questions yet.


