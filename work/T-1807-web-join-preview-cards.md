---
id: T-1807
title: "Web Join preview draws card rows (blocks, progress) as cards like the thread, and skips empty rows — twin of the phone's T-1798 fix"
status: merged
milestone: M5
branch: task/T-1807-web-join-preview-cards
model: auto
effort: default
depends_on: [T-1797]
estimate: 20 min
---

# T-1807: Cards in the web Join preview

## Spec (written by Claude, do not edit)

### Why
The web Join preview (T-1797) shows every preview row's `body` as text. A row can also carry the decoded `<agent>` payload. Many AI messages are cards whose body is only a fallback, or empty, so the preview shows blank or plain bubbles where members see cards. The phone fixed this in T-1798. This is the web twin.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/topic/TopicJoinView.tsx`** (119 lines) maps `preview.messages` at `:78-97`. Each row is a bubble with the `nick` (`:84-89`), `<span …>{message.body}</span>` (`:90`) and a `<time>` (`:91-96`).
- **A preview row** is `{ id, at, nick, body, payload? }` (`packages/api-contract/src/topics.ts:258-270`).
- **The phone twin** (`apps/mobile/src/components/chat/topic-join-view.tsx:111-138`) uses `isValid(PayloadSchema)(item.payload)` from `@zilar/protocol` (`packages/protocol/src/payload.ts:19`). It draws a drawable card with `PayloadCard` and skips rows with an empty body and no card.
- **How the web thread draws cards:** `apps/web/src/components/message/AttachmentBody.tsx:253-280`: `BlockCard` (`data`, plus a `footer` with the time) for `blocks`, and `ProgressCard` for `progress`. Other card types (approval, question) need their message context; in the preview, show their `body` instead.

### Steps
1. In `TopicJoinView.tsx`, for each row, decode `payload` with `isValid(PayloadSchema)`:
   - **`blocks`:** render `<BlockCard data={…} footer={<time …>} />` (read-only: no `respond` prop) under the sender name, without the bubble's text body.
   - **`progress`:** render `<ProgressCard progress={…} />` standing alone, with no time row, as in the thread.
   - **Anything else:** the current text bubble with `body`.
   - Skip a row whose `body` is empty and that has no drawn card.
2. **No tests** (UI). Keep the file at most 400 lines.

### Allowed files
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `work/T-1807-web-join-preview-cards.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On web, the Join preview shows AI cards as cards and never shows an empty bubble.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Read `work/T-1807-web-join-preview-cards.md` and `AGENTS.md`, then set the task to `in-progress`.
- `apps/web/src/components/topic/TopicJoinView.tsx`: extracted the preview row into a `PreviewRow` component that:
  - decodes each row's opaque `payload` with `isValid(PayloadSchema)`;
  - for `blocks`, renders `<BlockCard data={…} footer={<time …>} />` under the sender name, with no bubble text body;
  - for `progress`, renders `<ProgressCard progress={…} />` alone with no time row;
  - for every other payload or none, keeps the existing text bubble with `body` and the time;
  - returns `null` for a row whose body is empty and whose payload has no drawn card.
- Card rows keep the row's max width but no longer draw any bubble surface: `bubble-in`, the rounded corners and the `px-3 py-2` padding are all inside the `asText` branch now, since `BlockCard` and `ProgressCard` already draw their own box. The sender name over a card uses the thread's standalone classes (`px-3 pt-2` plus `flex items-center gap-1.5 text-[14px] leading-5 font-semibold` with a `truncate` name).
- No tests added: UI-only change and the Spec says no tests. File is 154 lines, under the 400-line limit.

### Checks run
- `pnpm install` (repo root): "Done in 22.1s".
- `pnpm exec prettier --write apps/web/src/components/topic/TopicJoinView.tsx`: formatted the one changed file.
- `pnpm gate` (repo root), summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.8s)
  PASS  lint  (1.6s)
  PASS  typecheck  (5.7s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No single test file was run: gate reports no nearby test files for `@zilar/web` for this change.

### Notes for the lead
- The preview renders the thread's real `ProgressCard`, so it keeps that card's live elapsed timer and its Stop / steps behaviour when the card's AI belongs to the viewer. The Spec said "as in the thread"; I did not add a read-only variant.
- `blocks` time is passed as `BlockCard`'s `footer`, which is how the thread shows it; `progress` gets no time, also matching the thread.
- No deviations from the Spec.

### Round 2 (prereview fixes)
- **Finding 1 (should-fix, fixed):** `bubble-in` moved into the `asText` branch, so card rows no longer keep the outer bubble surface (gradient, 1px border, shadow) around `BlockCard` / `ProgressCard`. The row keeps its max width and the sender name; the card's own box is the only surface, as in `MessageBubble.tsx` for `standaloneCard`.
- **Findings 2 and 3 (nits, not fixed):** neither sits on a line this round changed, and the task says to leave nits alone. Their behaviour (live `ProgressCard`, `body === ''` skip check) is unchanged and still matches the phone twin.
- **Tests:** none added. The finding names no test and the Spec says "No tests (UI)"; `pnpm gate` reports no nearby test files for `@zilar/web`.
- **Gate (repo root), after the fix:**
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No disagreements with the prereview.

### Round 3 (verification after a session restart)
- Resumed in a fresh session after a service quota error. Read `AGENTS.md`, this
  task file and `PREREVIEW.md`, then checked the branch: `git log --oneline main..HEAD`
  shows the spec, the implementation, the finding 1 fix and the Round 2 report;
  `git diff --stat main...HEAD` shows only the two Allowed files. No work was lost.
- Re-checked the code against the Spec and the prereview: finding 1 is fixed
  (`bubble-in` is inside the `asText` branch), card rows draw `BlockCard` with the
  time footer and no `respond` prop, `progress` rows draw `ProgressCard` alone with
  no time, every other row keeps the text bubble, and a row with an empty body and
  no drawn card returns `null`. No further must-fix or should-fix finding remained,
  so no code changed in this round.
- **Gate (repo root), re-run on the restarted session:**
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.9s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Tests: none added or run; the Spec says "No tests (UI)" and the gate reports no
  nearby test files for `@zilar/web`.
- Status stays `review`. No disagreements, no blocked items.

### Lead fix round (item 1)
- **Bubble surface:** `bubble-in` (and the rounded corners) live only in the
  `asText` branch, so a `blocks` or `progress` row has no outer bubble: the card's
  own box is the only surface, as in `MessageBubble.tsx`'s `standaloneCard`.
- **Sender over a card:** the sender name for a card row now uses the thread's
  standalone classes: the wrapper `flex items-center gap-1.5 px-3 pt-2 text-[14px]
  leading-5 font-semibold` with the name in a `truncate` span, coloured with
  `senderColor(message.nick)`. Text rows keep the smaller sender line. The outer
  `gap-0.5` moved into the `asText` branch too, so the card row matches the
  thread's spacing between sender and card.
- **Report correction:** the earlier "drop the bubble padding/background" line in
  "What I did" now states exactly what the code does (no `bubble-in`, corners or
  padding on card rows; sender uses the thread's classes).
- **Gate (repo root), after this change:**
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Tests: none added or run; the Spec says "No tests (UI)".
- Status stays `review`.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `2665b9067`, after 2 autopilot rounds and one lead round.
- **`PreviewRow`:**
  - decodes `payload` with `isValid(PayloadSchema)`;
  - draws `BlockCard` (read-only, time as footer) or `ProgressCard`, without a bubble surface (`bubble-in` only on text rows);
  - skips empty rows.
- **Follow-up:** a live `ProgressCard` in the preview keeps its Stop button and ticker. It goes into the same web follow-up as the Join flash seen live (a member briefly sees "Join <topic>" while the page loads).

