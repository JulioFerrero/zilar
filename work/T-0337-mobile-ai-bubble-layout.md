---
id: T-0337
title: "Mobile: long incoming AI messages collapse to a narrow column and the markdown reply renders as a huge empty block; tick icon sits a little high"
status: merged
milestone: M5
branch: task/T-0337-mobile-ai-bubble-layout
model: auto
effort: high
depends_on: [T-0336]
estimate: 0.5 day
---

# T-0337: mobile AI bubble layout

## Spec (written by Claude, do not edit)

### Why
QA run 22 (emulator, mock mode, main at f3bbd362) found two layout bugs in the Marketing AI chat. The lead saw both in `qa22/07.png`.

1. **Narrow column.** The incoming message `marketing-ai-02` (`apps/mobile/src/mock/messages.ts:187-189`, a 112-character plain text) renders as a column only a few characters wide. The text wraps one to three letters per line ("of / y / o / ur / br / ai / n."), with the time under it. Short incoming messages in the same chat render normally, for example `marketing-ai-04` ("I scheduled the post for Monday at 9:00.").
2. **Markdown block.** The markdown reply `marketing-ai-06` (lines 196-215: heading, bold and italic, a bullet list, a ts code block, a quote, and a link line) renders as a large square grey block. It has no rounded corners, it runs about 60% of the screen tall, and its only visible content at the top is "Full brief: https://zilar.test/launch 09:30". The heading, list, code and quote are not visible, and the rest of the block is empty.

T-0336 (the inline tick icons) changed only outgoing bubbles, so it is unlikely to be the cause. It is not known when these bugs started; QA had not opened this chat before.

Also from QA run 22 (`qa22/z1.png`, seen by the lead): the new inline tick icon after the time in outgoing bubbles sits a little high, by about a third of the digit height.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/message-bubble.tsx`:**
  - the bubble column is `<View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>` (line 395), inside a `flex-row px-2` row (lines 381-387);
  - the text bubble is a `Pressable` with `className="rounded-[14px] px-3 py-2"` and `style={bubbleStyle(outgoing ? 'outgoing' : everLive ? 'generating' : 'incoming', isLastInGroup)}` (lines 437-444);
  - `everLive = !outgoing && (draft || revealTurnId !== undefined)` (line 296); when it is true, an `Animated.View` with `StyleSheet.absoluteFill` overlays the bubble (lines 446-455);
  - markdown goes through `MarkdownText` (`apps/mobile/src/components/chat/markdown-text.tsx`) when `showMarkdown` is true;
  - the outgoing inline ticks are at about lines 536-548 and 571-583: a `View` of 14×11 holding `Ticks size={11}`.
- **Tests:** `apps/mobile/src/components/chat/markdown-text.test.tsx`, `message-bubble-stickers.test.tsx` and `message-bubble-ticks.test.tsx`.

### What to build
1. **Find the cause of both layout bugs by reading the code.** Look at the bubble width chain (`max-w-[80%] shrink` on a flex child of a row, `items-start`, any `absoluteFill` overlay or `revealTurnId` path that AI messages take) and at `MarkdownText`. Write the cause in the Report with `file:line`.
2. **Fix it** so that:
   - a long incoming message wraps at the bubble's max width (80% of the row), like the outgoing ones do;
   - a markdown reply renders all its blocks inside a normal rounded bubble that is only as tall as its content.

   Keep the fix minimal. If the cause is in `MarkdownText`, fix it there.
3. **Tick height:** in both inline tick wrappers, nudge the icon down so it sits on the time's baseline. Use a small `transform: [{ translateY: 2 }]` or `marginBottom: -2` on the 14×11 wrapper; 2 px is a starting value. Note in the Report that the lead verifies it on the emulator.
4. **Tests:** add a regression test that pins the layout fix as far as a node test can.
   - For example, assert the class or style that guarantees the width: no `shrink` without a width basis, or the markdown container style.
   - Name it in the Report and say what it cannot prove (real layout needs the emulator).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/message-bubble.tsx` (all of it), `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/mock/messages.ts:180-216`, and the three tests above.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/markdown-text.test.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`, `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `work/T-0337-mobile-ai-bubble-layout.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble markdown-text
pnpm gate
```

### Acceptance
- The Report names the cause with `file:line`.
- The fix and the tick nudge are in place, and the regression test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.
- The lead confirms on the emulator after the merge.

---

## Report (written by the worker when done)

**Status:** review. No deviations from the spec.

### Cause

Both layout bugs are in `MarkdownText`, not in the bubble width chain, so I fixed them there (the spec allows this).

1. **Narrow column (message `marketing-ai-02`).** The list item body was a `flex: 1` text (`apps/mobile/src/components/chat/markdown-text.tsx:101` before the fix), i.e. `flexBasis: 0`, inside a `flexDirection: 'row'` view (`:94`) whose width is content-driven (the bubble shrink-wraps up to `max-w-[80%]`). With a zero basis and no definite parent width the row collapses to the marker column and the text wraps a few characters per line. Message 02 is the only long incoming message affected because it starts with `1) `, so `parseMarkdown` (`apps/mobile/src/lib/markdown.ts:389`, `LIST_ITEM` at `:42`) turns the whole 112-character line into a one-item ordered list and `ListBlock` renders it. `marketing-ai-04` is a paragraph, so it wrapped normally.
2. **Tall grey markdown block (message `marketing-ai-06`).** The horizontal `ScrollView` in `CodeBlock` (`apps/mobile/src/components/chat/markdown-text.tsx:111` before the fix) had no `flexGrow: 0`. React Native's horizontal ScrollView grows to fill the free height; the repo already documents this exact pitfall in `apps/mobile/src/components/chat/folder-tabs.tsx:38` and `apps/mobile/src/components/chat/emoji-tab.tsx:78`. That stretched the code `well` into the large square grey block.

### Changes

- `apps/mobile/src/components/chat/markdown-text.tsx`
  - `ListBlock`: `flex: 1` -> `flexShrink: 1`, with a comment (the auto basis lets the row size to its content, then shrink to the bubble's max width).
  - `CodeBlock`: `style={{ flexGrow: 0 }}` on the horizontal `ScrollView`, with a comment.
- `apps/mobile/src/components/chat/message-bubble.tsx`
  - Both inline 14x11 tick wrappers (the markdown and plain branches, after the time) got `transform: [{ translateY: 2 }]`.
- `apps/mobile/src/components/chat/markdown-text.test.tsx`
  - `sizes list item text from its content instead of a zero flex basis`: the item body has `flexShrink: 1` and no `flex: 1`.
  - `keeps the horizontal code ScrollView from growing to fill the bubble`: the code `ScrollView` has `flexGrow: 0`.
- `apps/mobile/src/components/chat/message-bubble-layout.test.tsx` (new)
  - `nudges the inline ticks down onto the time baseline`: renders an outgoing text bubble and asserts the tick slot's `data-style` contains `translateY: 2`.

### Commands

- `pnpm install` — exit 0.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble markdown-text` — `Test Files 4 passed (4)`, `Tests 22 passed (22)`.
- `pnpm exec prettier --check <the 4 changed source/test files>` — `All matched files use Prettier code style!`.
- `pnpm gate` — `GATE PASS`:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.9s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Tests: what they cannot prove

The node tests pin the style values that caused the bugs (list item `flexShrink` with no zero basis; code `ScrollView` `flexGrow: 0`; tick `translateY: 2`) but cannot exercise real Yoga flex layout or pixel rendering. The width wrap and the bubble height must be confirmed on the emulator.

### Notes for the lead

- The tick nudge is a starting 2 px `translateY`; per the spec, the lead verifies it on the emulator.
- No security-relevant surface (pure UI styles).
- No new dependencies, no `any`, no suppressed checks.

## Review (written by Claude)

**Approved** (pre-review clean, 2 nits accepted: the tick-nudge test reaches only the plain-text branch, and the Report cites `parseMarkdown` at :389 when it is at :342). Both causes are in `MarkdownText`, and the lead checked the reasoning:
- **Narrow column:** "1) …" parses as a one-item ordered list. The list item text was `flex: 1` (basis 0) inside a content-sized row, which collapsed it to a sliver. It is now `flexShrink: 1`.
- **Grey block:** the code block's horizontal `ScrollView` grew to fill the free height. It now has `flexGrow: 0`, the same pitfall already noted in `folder-tabs.tsx` and `emoji-tab.tsx`.
- **Ticks:** both inline tick wrappers get `translateY: 2`.

Emulator confirmation: QA run 23 after the merge.
