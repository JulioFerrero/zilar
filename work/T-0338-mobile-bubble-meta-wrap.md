---
id: T-0338
title: "Mobile: the tick icon never wraps away from the time, and a markdown list item no longer leaves empty space under the bubble"
status: todo
milestone: M5
branch: task/T-0338-mobile-bubble-meta-wrap
model: auto
effort: high
depends_on: [T-0337]
estimate: 0.3 day
---

# T-0338: bubble meta wrap and list height

## Spec (written by Claude, do not edit)

### Why
QA run 23 (emulator, mock, main at 270bc7ee) found two follow-ups to T-0336 and T-0337. The lead saw both in `qa23/01.png`.

1. **The tick wraps alone.**
   - The outgoing bubble "Draft three taglines for the launch." shows "15:00" on the first line, and the double-tick icon alone on a second line at the bubble's left.
   - Cause: since T-0336, the time and the tick are separate inline pieces. The time ends its `Text`, then comes `<Text> </Text>` (a breakable space), then the inline tick `View`. So the line can break between the time and the tick.
   - Before T-0336, a glyph sat in the same `Text` as the time.
2. **Empty space under a list item.**
   - The incoming message "1) People and AIs, together. 2) …" now wraps correctly over three lines (T-0337), but the bubble is about two text lines taller than its content: there is empty space under "15:02".
   - This is very likely the `ListBlock` row measuring: `apps/mobile/src/components/chat/markdown-text.tsx:89-108`, a `flexDirection: 'row'` view with a 22 px marker `Text` and a `flexShrink: 1` body `Text`. The body text is measured at one width and laid out at another, so the row keeps the taller measured height.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/message-bubble.tsx`:**
  - markdown branch at about lines 524-553, plain-text branch at about lines 555-590;
  - each ends the bubble's text `Text` with a meta `Text` (`font-mono text-[10px]`, `color={metaColor}`, `opacity: 0` while generating) holding `'  '`, the optional `'edited '` and `formatTime(...)`;
  - after that meta `Text` come `{outgoing ? <Text> </Text> : null}` and an inline `View` of 14×11 with `transform: [{ translateY: 2 }]` holding `<Ticks status={message.status} color={metaColor} size={11} />`.
- **`apps/mobile/src/components/chat/markdown-text.tsx:89-108` (`ListBlock`):** each item is a row `View` holding a marker `RNText` (`width: 22, marginRight: 6, textAlign: 'right'`; `item.marker` or `'•'`) and the body `RNText` with `flexShrink: 1`.
- **Tests:** `apps/mobile/src/components/chat/markdown-text.test.tsx` (it includes T-0337's `flexShrink` and `flexGrow` tests), `message-bubble-ticks.test.tsx` and `message-bubble-layout.test.tsx`.

### What to build
1. **Ticks never separate from the time.**
   - Move the tick `View` inside the meta `Text`, right after `formatTime(...)`, joined by `' ⁠'` (a no-break space, then a word joiner, so there is no break opportunity before the inline view).
   - Remove the separate `<Text> </Text>`.
   - Keep the 14×11 size, `translateY: 2`, `metaColor` and the generating opacity.
   - Do this in both branches.
2. **The list item is one Text.** Rewrite `ListBlock` so each item is a single `RNText`: the marker (`item.marker` or `'•'`), a no-break space, then the inline nodes.
   - Keep a left indent with `paddingLeft` on the item (about 12 px), so lists still read as lists.
   - Wrapped lines then start under the marker instead of under the text. That is accepted.
   - With no row layout, the measuring mismatch is gone.
   - Keep the marker visible to screen readers as part of the text (that is fine).
3. **Tests:**
   - update the T-0337 list test to the new structure: one Text per item, no `flex: 1` and no row;
   - keep the `flexGrow: 0` code test;
   - in `message-bubble-ticks.test.tsx` or `message-bubble-layout.test.tsx`, assert that the tick view is a child of the same meta `Text` as the time, with ` ⁠` before it.
4. **Report:** say that the real wrap and height must be checked on the emulator. The lead runs QA after the merge.

### Read first
`AGENTS.md`, `work/T-0337-mobile-ai-bubble-layout.md` (Report and Review), `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:520-595`, and the three tests above.

### Allowed files
`apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/markdown-text.test.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`, `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `work/T-0338-mobile-bubble-meta-wrap.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble markdown-text
pnpm gate
```

### Acceptance
- The tick view sits inside the time's `Text` behind ` ⁠`.
- Each list item is one `Text` with an inline marker.
- Tests pass, and `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.
- The lead confirms on the emulator after the merge.

---

## Report (written by the worker when done)

## Review (written by Claude)
