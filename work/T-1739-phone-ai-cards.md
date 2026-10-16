---
id: T-1739
title: "Phone AI cards match the boards: the work card uses the bubble width with a full title and a one-line done row with a chevron, empty reply quotes are hidden (web too), and the waiting-for-you jump finds the question card by its archive id"
status: merged
milestone: M5
branch: task/T-1739-phone-ai-cards
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1739: AI cards on the phone, as drawn

## Spec (written by Claude, do not edit)

### Why
Julio tested on his phone on 2026-10-16: "in the design looks so nice and the flow feels good but in the app is ugly and doesnt make sense". The boards are the reference: open `docs/design/mockups/ai-work/Phone.dc.html` and `docs/design/mockups/routines/PhoneRoutineAsk.dc.html` in a browser, and read their READMEs. **Match them.** From his screenshots:
- the work card title shows "Looking u…";
- a finished card has a second "View steps" row;
- AI replies carry an empty red "Message" quote;
- tapping "Deepseek is waiting for you" scrolls up to nothing.

### Facts (the lead read them on 2026-10-16)
1. **The work card:**
   - `apps/mobile/src/components/chat/progress-card.tsx` (229 lines) sizes to its content with `min-w-[220px]` (`:146`);
   - its header row puts the state icon, the title (`numberOfLines={1}`, `:134-136`), the timer and a Stop key on one line (`:149-176`), so on a phone the title gets a few characters;
   - a finished card of the viewer's own AI adds a separate bordered "View steps" row with a chevron (`:203-216`), which opens `StepsSheet`.
   - **The board** draws a finished card as **one** line: the green check, the full title, the duration and a chevron. A working card is the title, the timer and Stop on one line, with the steps under it.
2. **Reply quotes:**
   - `replyQuoteContent` (`packages/chat-core/src/messages.ts:262-288`) falls back to the name "Message" with no text when the replied-to message isn't loaded and the wire quote carries no text;
   - it's rendered by `apps/mobile/src/components/chat/reply-quote.tsx:33` and `apps/web/src/components/ReplyQuote.tsx:26`;
   - AI follow-ups quote a synthetic id that exists in no chat (T-1738 stops that), and old messages keep it.
3. **The waiting jump:**
   - `apps/mobile/src/components/chat/ai-status-line.tsx:35-45` and `apps/mobile/src/components/chat/ais-here-sheet.tsx:135-140` call `openAtMessage(chat.id, questionId)`;
   - `openAtMessage` (`packages/client-core/src/store/history.ts:263-300`) pages backwards until `k.sameMessage(item.id, messageId)` matches, or history ends;
   - the server re-keys the question to the message's archive id (`apps/server/src/agents/gateway/question-answer.ts:35`, `rekeyQuestionMessage`). Live, the open question's `message_id` is `1792170770205830`, a numeric archive id;
   - if the phone's list keys that card by its origin or stanza id, no item ever matches, and the jump pages all the way up.

### Steps
1. **The work card** (`progress-card.tsx`):
   - the card takes the bubble's full width, not a 220 px minimum, so the title shows in full; it may wrap to two lines;
   - **a finished card** is one pressable line: the state icon, the title, the duration and a `ChevronRight` at the right. Pressing it opens `StepsSheet` for the viewer's own AI, and expands the steps otherwise. Remove the separate "View steps" row;
   - **a working card** keeps the title, the timer and Stop on one line, with the steps under it;
   - keep the kit's sizes and colours;
   - check against `docs/design/mockups/ai-work/Phone.dc.html` and `docs/design/mockups/routines/PhoneRoutineAsk.dc.html`.
2. **Hide empty quotes:**
   - `replyQuoteContent` returns `undefined` when there is no loaded target, no wire text and no name;
   - `reply-quote.tsx` and `ReplyQuote.tsx` render nothing then;
   - update the other callers the compiler finds.
3. **The waiting jump:**
   - find the id the phone list keys a question card by, and make `sameMessage` (or the jump) also match the message's archive id when the message carries one;
   - check it with the store tests nearest to `history.ts` (one test at most: `openAtMessage` finds a message by its archive id);
   - explain the cause in the Report.
4. **No other UI changes.** Each file stays under 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/progress-card.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx` (fix round 2, added by the lead)
- `apps/mobile/src/components/chat/reply-quote.tsx`
- `apps/web/src/components/ReplyQuote.tsx`
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/sender-color.test.ts` (added by the lead: it calls `replyQuoteContent`)
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/history.test.ts`
- `packages/client-core/src/store/ledger-ids.ts` (`sameMessage` lives at `:129`)
- `packages/client-core/src/store/ledger-ids.test.ts`
- `apps/mobile/src/components/chat/ai-status-line.tsx`
- `apps/mobile/src/components/chat/ais-here-sheet.tsx`
- `work/T-1739-phone-ai-cards.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The work card** shows full titles. A finished card is one line with a chevron, as on the board.
- **No empty "Message" quote** renders on web or phone.
- **Tapping "waiting for you"** lands on the question card.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

The whole Spec is implemented.

1. **The work card** (`apps/mobile/src/components/chat/progress-card.tsx`):
   - the root dropped `min-w-[220px]` and is now `w-full`, and the title is `numberOfLines={2}`, so
     the full title shows (the board's full-width card);
   - **a finished card** is now **one pressable line**: the state icon, the title, the duration and a
     `ChevronRight` at the right. Pressing it opens `StepsSheet` for the viewer's own AI, and toggles
     the steps inline otherwise. The separate bordered "View steps" row is gone;
   - **a working card** keeps the title, the timer and Stop on one line, with the steps drawn under
     it (always, as the board draws a working card), and the old `stage`/`detail` fallback when it
     has no steps;
   - kit sizes and colours unchanged (`ACCENT`, `DANGER`, `MUTED_FOREGROUND`, lucide icons).

2. **Hide empty quotes:**
   - `packages/chat-core/src/messages.ts`: `replyQuoteContent` now returns
     `ReplyQuoteContent | undefined`, and returns `undefined` when there is no loaded target, no wire
     text and no name (instead of the empty red "Message" line);
   - `apps/mobile/src/components/chat/reply-quote.tsx` and `apps/web/src/components/ReplyQuote.tsx`
     return `null` when `replyQuoteContent` is `undefined`;
   - `packages/chat-core/src/sender-color.test.ts` (added to the Allowed files by the lead): the two
     `replyQuoteContent` cases gained optional-chain guards (`content?.own`,
     `content?.senderName`); no other change.

3. **The waiting jump** (`packages/client-core/src/store/history.ts`): `openAtMessage`'s internal
   `find` now also matches a row whose `archiveId` (`UiMessage.archiveId`) equals the requested id,
   so the jump can land on a card the list keys by another id. One test added in
   `packages/client-core/src/store/history.test.ts`: "finds a loaded message by its archive id".
   *(Superseded in fix round 3, below: `messagesByChat` rows never carry `archiveId`; the jump now
   resolves the archive id through the chat preview instead.)*

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts`
  → **22 passed (1 file)**.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts src/sender-color.test.ts`
  → **32 passed (2 files)**, and after the guard edit
  `... src/sender-color.test.ts` → **5 passed (1 file)**.
- `pnpm gate` → **GATE PASS**. Summary lines:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (0.6s)
  PASS  tests @zilar/client-core  (1.6s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Blocked / needs a decision

None. (An earlier gate run failed on `typecheck` in `packages/chat-core/src/sender-color.test.ts`,
which was outside the Allowed files. The lead added it; the guards were applied and the gate is now
green.)

### Round (fix round 2)

Layout risk in the work card fixed, as the lead asked:

- `apps/mobile/src/components/chat/progress-card.tsx`: the title is now `min-w-0 shrink` (flexBasis
  auto, so its full text width counts towards the row's intrinsic width) and a `flex-1` spacer `View`
  sits right after it to push the timer, chevron and Stop to the right; the live row no longer wraps
  the header in a `flex-1` (basis 0) `View`, so the header contributes its own width there too. The
  card roots use `self-stretch` instead of `w-full` (which resolved against an auto-width parent).
- `apps/mobile/src/components/chat/payload-card.tsx`: `ProgressCardSurface` gained `min-w-[240px]`,
  so a short title still gives a comfortable card about the board's done-line width.

### Round (fix round 3)

**Finding 1 (should-fix) fixed** — the waiting-jump change compared `item.archiveId`, a field no
writer ever sets on a `messagesByChat` row, so it was dead code against real state. The archive id
the server re-keys the question card to reaches the client only on the chat preview, as the chat's
`lastMessage.archiveId` (`previewMessageOf` → `ui.archiveId`, `row-helpers.ts:87-96`) beside the
origin id the stored row is linked to. `openAtMessage` now resolves the requested id through that
preview first, then matches the row by the ledger's aliases:

- `packages/client-core/src/store/history.ts`: `find` reads the chat's `lastMessage`; when its
  `archiveId` equals the requested id, it matches the row by the preview's `id` (the origin id the
  stanza was linked to) as well as by the requested id. No other behaviour changed.
- `packages/client-core/src/store/history.test.ts`: the old "finds a loaded message by its archive
  id" test (which hand-injected `archiveId` onto a list row) is replaced by "finds a loaded message
  by the archive id its chat preview carries". It builds the row through the real writer
  (`ctx.k.toUiMessage` on a stanza with `id: 'stanza-7'`, `originId: 'origin-1'`) and the chat
  preview through `previewMessageOf` with the archive id, then jumps by the archive id. Verified it
  fails on the base `history.ts` (1 failed / 21 passed) and passes with the fix (22 passed).

**Findings 2, 3 and 4 (nits) left untouched**, as instructed: none sits in a line this round
changed (`progress-card.tsx` `accessibilityState`, the `replyQuoteContent` doc comment, and the
missing hide-case unit test).

- **Single tests:** `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot
  src/store/history.test.ts` → **22 passed (1 file)**. No whole-suite runs.
- **`pnpm gate`** → **GATE PASS** (`gate: 9 changed file(s) against main`):
  ```
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.9s)
  PASS  effect  (2.2s)
  PASS  tests @zilar/chat-core  (1.7s)
  PASS  tests @zilar/client-core  (3.2s)
  PASS  tests @zilar/mobile  (1.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Disagreements

None. Finding 1 is correct: the previous fix was unreachable against real store state, and its test
built a row shape no writer produces.

### Notes for the lead

- **Cause of the waiting jump** (Spec step 3, corrected): the server re-keys an AI's open question
  from the origin id to the message's archive id (`rekeyQuestionMessage`, `question-answer.ts:35`),
  and the topic activity carries that archive id as `questionId` (T-1577/T-1586). The client's
  question card is a normal `messagesByChat` row, keyed by the id the stanza carried (its
  XEP-0359 archive stanza-id, else the message id) and linked through the ledger to its origin id;
  a `messagesByChat` row never carries an `archiveId` field (`toUiMessage`, `ledger-incoming.ts`,
  builds no such field — `archiveId` is a chat-preview only field, `row-helpers.ts`). The server's
  archive id therefore never matched `sameMessage(row.id, questionId)`, and `openAtMessage` paged
  all the way up. The jump now resolves that archive id through the chat preview's
  `lastMessage.archiveId` to the id the row is reachable by.
- I ran the single test file above only; no whole-suite runs.
- The work-card layout is a UI change with no tests (AGENTS.md "Tests"); the phone smoke covers it.

## Review (written by Claude)

- **Accepted at `cc6f6af71`.** It's clean after the lead's rounds and one automatic round (4 nits), and the packet is current. The lead ran `history.test.ts`: 22 passed.
- **The work card:**
  - a finished card is one pressable line (icon, full title, duration, chevron), opening `StepsSheet` for the viewer's own AI and expanding otherwise; the "View steps" row is gone;
  - lead round 2 sized it by the full title: the title is `shrink` (basis auto) with a `flex-1` spacer, the root `self-stretch`, and a 240 px minimum on the surface.
  - It can't be rendered without the emulator while Julio is at the PC, so it gets checked on his phone with the next APK.
- **Empty reply quotes** (no target, no text, no name) render nothing, on web and phone.
- **The waiting jump is partly fixed:**
  - it resolves the question's archive id through the chat preview, so it works when the question card is the chat's last message;
  - a card received live, with later messages after it, still can't be found, because the client never records the archive id of a live message. That's the follow-up task: record the live `stanza-id` as a ledger alias.
  - T-1738 already clears "waiting" once someone answers by typing.

