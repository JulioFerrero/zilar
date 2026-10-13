---
id: T-1328
title: "Mobile rich-text bubbles like Telegram: the time sits bottom-right (today it drops to its own left-aligned line under every AI/markdown message, even one-liners), and Markdown tables render as a table instead of raw '| --- |' pipes (web already does)"
status: merged
milestone: M5
branch: task/T-1328-mobile-markdown-bubble
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1328: Mobile markdown bubble time and tables

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: find more places where the UI doesn't look like Telegram. The lead's audit of the Android mock build found two problems.
1. **Every Markdown-rendered message puts its time on a separate line at the left**, even a one-liner. In Dev AI, "Done. Pushed a commit." shows "08:43" on the line below, indented left; the same happens to "Tests pass. Merge?" and to Dev-1's messages in Dev team › General. Plain messages from people are fine ("Bring snacks? 02:33" sits inline at the right).
   The Markdown branch is `apps/mobile/src/components/chat/message-bubble-content.tsx:138-150`: `<MarkdownText>`, then a separate `<Text>` holding `BubbleInlineMeta`, so the meta always starts a new line at the left. Telegram puts the time at the bottom-right, inline with the last line when it fits, otherwise right-aligned on its own line.
2. **Markdown tables render as raw text** on mobile: "| Change | Risk | Notes | | --- | --- | --- | | Sticky footer | Low | …" in Dev AI's "Review summary". Web renders a real table. The renderer is `apps/mobile/src/components/chat/markdown-text.tsx` (194 lines; the decision is `markdown-decision.ts`).

### What to build
1. **The meta in the Markdown branch** is right-aligned at the bottom.
   - Simplest: put it inline at the end of the last text block when that block is a paragraph, else right-aligned on its own row, the way `PlainBubbleBody` (`plain-bubble-body.tsx`) places it for plain text.
   - Keep the generating caret and `GeneratingLabel` working.
   - It must look right for one-liners, lists and code-block endings.
2. **Tables:** render GFM tables in `markdown-text.tsx`:
   - a bordered grid, with a header row in semibold;
   - scrolls horizontally inside the bubble when wider than the bubble;
   - use the same colours as code blocks.
   Put it in a new file `apps/mobile/src/components/chat/markdown-table.tsx` if that keeps the files small.
3. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/markdown-decision.ts`, `apps/mobile/src/components/chat/plain-bubble-body.tsx`. The web table renderer, to match: search `apps/web/src/components/message/` for `table`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/markdown-table.tsx`, `apps/mobile/src/components/chat/markdown-decision.ts`, `apps/mobile/src/components/chat/plain-bubble-body.tsx`, `work/T-1328-mobile-markdown-bubble.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the Android mock build:**
  - in Dev AI, one-liners show the time inline at the right;
  - "Review summary" shows a table;
  - Dev team › General looks the same as before apart from the time.

---

## Report (written by the worker when done)

### What I did

1. **Bottom-right meta for Markdown bubbles.** `MarkdownText` now takes an optional
   `trailing` node. When the last rendered item is a paragraph the meta is appended
   inside that paragraph's `Text`, so it flows inline at the end of the last line and
   wraps with it (same as `PlainBubbleBody`). When the reply ends in any other block
   (list, code block, table, heading, quote, hr) the meta is rendered right-aligned on
   its own row (`alignItems: 'flex-end'`). Empty text with `generating` still shows the
   caret + time. `DraftCaret` moved into `trailing`, so the caret and `GeneratingLabel`
   keep working exactly as before.
   `message-bubble-content.tsx` builds that node with `useMemo` keyed on
   `[generating, message, outgoing, metaColor, reduceMotion]`, so a reveal frame that
   repeats the same text keeps `MarkdownText`'s memo (no re-parse).

2. **GFM tables.** The shared parser (`lib/markdown-blocks.ts`) has no table block and
   is outside the Allowed files, so the new `markdown-table.tsx` detects tables from the
   source lines and returns a mix of `markdown` runs and `table` data:
   - fence-aware, so pipes inside ``` / ~~~ code blocks are not tables;
   - a header line is a table only when the next line is a matching delimiter row
     (same cell count), so ordinary text with pipes stays text;
   - cells split on unescaped `|`, honouring `\|`; alignment read from the delimiter row.
   `MarkdownText` renders each table as a bordered, horizontally scrolling grid using the
   code-block colours (`well` background + `BORDER` lines, 13px body, semibold header),
   with per-column widths taken from the widest cell so columns line up. Cell text goes
   through the existing `renderInline(parseInline(...))`, so inline code/bold/links work.

3. Every touched file is under 400 lines (`markdown-table.tsx` 254, `markdown-text.tsx`
   284, `message-bubble-content.tsx` 257). No tests (UI-only), as the spec says.

Files changed:
- `apps/mobile/src/components/chat/markdown-text.tsx` — `trailing` prop on `Body`/`BlockView`/`MarkdownText`; table split + render; updated doc comment.
- `apps/mobile/src/components/chat/message-bubble-content.tsx` — Markdown branch passes `trailingMeta`; no more separate left-aligned meta `Text`.
- `apps/mobile/src/components/chat/markdown-table.tsx` — new: table detection + grid.
- `work/T-1328-mobile-markdown-bubble.md` — this report + status.

### Commands and results

- `pnpm install` — done, ok (existing peer-dep warnings unchanged).
- `pnpm gate` (1st run) — `FAIL format` on my two new/edited files, everything else PASS.
  Fixed with `pnpm exec prettier --write` on those two files only.
- `pnpm gate` (2nd run):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I ran no test file individually: the change is UI-only and the spec says "No tests (UI)".
  To sanity-check the pure table split I replicated the algorithm in a throwaway `node -e`
  (not a repo file): a table with `:---` / `---:` / `:---:` delimiters parsed to the right
  header, alignments and rows, and the same pipes inside a fenced block stayed Markdown.

### Not verified / notes

- I could not run the Android mock build or look at a device, so the acceptance
  ("time inline at the right", "Review summary shows a table", "General otherwise
  unchanged") is not visually confirmed by me; the gate is green and the code paths are
  reasoned, not smoke-tested on hardware.
- Deviation from the spec's "simplest": I kept the inline-vs-own-row decision inside
  `MarkdownText` (via `trailing`) rather than composing it in `message-bubble-content`,
  because only `MarkdownText` knows the last block. `markdown-decision.ts` and
  `plain-bubble-body.tsx` were in the Allowed files but needed no change.

### Lead fix round (2026-10-13)

Two follow-ups from the lead's Android mock build. One commit per item.

**1. A wrapped time is now right-aligned** (`message-bubble-content.tsx`,
`plain-bubble-body.tsx`, `markdown-text.tsx` comment).
The meta is drawn by a new `META_OVERLAY` (`position:'absolute'; right:0; bottom:0`)
inside a relative wrapper around the body, and a `hidden` copy of `BubbleInlineMeta`
(`opacity:0`, excluded from the accessibility tree) sits at the end of the last line to
reserve the meta's exact width. A short last line keeps the visible meta inline at the
right; a full last line wraps the invisible copy to its own line and the visible meta
lands at the bottom-right instead of the left. Both the markdown branch and both plain
paths (with and without code blocks) use it; the link-preview card stays below the
wrapper so the meta still sits at the text's bottom-right. `DraftCaret`/`GeneratingLabel`
unchanged. `useMemo` deps drop `message`/`outgoing`/`metaColor` because the meta moved
out of `MarkdownText`; deps are now `[generating, message, outgoing, metaColor,
reduceMotion]` for the reserved copy, so the memo still holds across reveal frames.

**2. Table columns no longer break words mid-word** (`markdown-table.tsx`).
`columnWidths` now floors each column at its longest word (and keeps the widest-cell
width), with the char estimate raised from 7 to 8 px, cell padding 16 and the minimum
column width raised 56 → 72. "Medium" gets 72 px and stays whole; the grid still scrolls
horizontally when it is wider than the bubble.

Gate (final, after both fixes):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
Each fix's first gate run failed on `format`; I ran `pnpm exec prettier --write` on only
the touched files and re-ran to `GATE PASS`. Still not visually confirmed on a device:
I could not run the Android mock build, so the "wrapped time at the right" and "Medium
stays whole" outcomes rest on the gate and the code, not on a phone.

### Lead fix round 2 (2026-10-13)

`BubbleInlineMeta`'s `hidden` spacer drew twice: a parent `opacity: 0` does not hide an
inline `Text`'s children on Android, so the reserved meta showed through. The spacer now
paints nothing while keeping its width: the outer text and the nested "Not sent" text use
`color: 'transparent'`, the tick view keeps its own `opacity: 0`, and the
`accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"` flags
stay so screen readers do not read the time twice. The spacer reuses the same component,
class (`font-mono text-[11px]`), spaces and tick width as the visible meta, so the reserved
width matches exactly. (The visible copy while `generating` still uses `opacity: 0`, which
already worked because it is a standalone `Text`, not inline inside another one.)

Reasoned through the three cases:
- **one-liner** — transparent spacer fits on the same line, so the bubble width is
  text + meta width and the one visible meta sits at the right edge: one time, inline.
- **long last line** — the spacer wraps to its own (invisible) line, reserving the row;
  the one visible meta is drawn bottom-right on that row.
- **edited** — the spacer carries `edited HH:MM` transparent, the visible meta carries it
  once at the bottom-right.

Gate (final):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.0s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
Still not visually confirmed on a device (no Android mock build access); `format` again
needed a `prettier --write` first.

### Pre-review fix round 3 (2026-10-13)

PREREVIEW findings: finding 1 (should-fix) fixed; finding 2 (nit) left as is.

**Finding 1 — a pipe inside an inline code span shifted table columns (should-fix).**
`splitRow` (`markdown-table.tsx`) now tracks the opening backtick run and treats `|` as
literal while inside a code span, matching GFM (code spans are parsed before cells). So
`` | `pnpm build | tail` | ok | `` keeps `` `pnpm build | tail` `` as one cell and `ok` is
no longer dropped; an escaped `\|` outside a code span still splits as before.

Test added: `apps/mobile/src/components/chat/markdown-table.test.ts`, 2 cases —
- keeps a pipe inside an inline code span in one cell (the exact failure from finding 1);
- still splits on an escaped pipe outside a code span.

**Finding 2 (nit) not touched.** It is a comment/width-estimate nit in `columnWidths`,
not on a line this round changes, and the round fixes only must-fix/should-fix.

**Note on scope.** The spec says "No tests (UI)" and the test file is not in the Allowed
files, so the gate reports it under `scope: 1 file(s) outside the Allowed files`. I added
it because this round's instruction requires a test for each behaviour fix and finding 1
is a real logic bug in a pure function (`splitRow`); the file is the exact test for that
fix. Flagging it so the lead can drop it if the Allowed-files rule is strict.

Commands:
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/chat/markdown-table.test.ts` — 2 passed.
- `pnpm gate`:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: 1 file(s) outside the Allowed files:
    apps/mobile/src/components/chat/markdown-table.test.ts
  migration: every added migration continues from the base
  GATE PASS
  ```
`status` stays `review`.

### Pre-review fix round 4 (2026-10-13)

PREREVIEW findings: finding 1 (should-fix) fixed; finding 2 (nit) left as is.

**Finding 1 — the round-3 test file was outside the Allowed files (should-fix).**
`apps/mobile/src/components/chat/markdown-table.test.ts` is not in the Allowed files,
and the spec says "No tests (UI)", so the gate reported
`scope: 1 file(s) outside the Allowed files`, which `AGENTS.md` forbids ("GATE PASS and
no files outside scope"). The finding offered two remedies: keep-and-waive (a lead
decision) or delete the test file. The worker cannot waive scope, so it deleted the file
(`git rm`); the round-3 code fix itself — the code-span-aware `splitRow` in
`markdown-table.tsx` that no longer splits a cell on a `|` inside backticks — is
untouched and stays in place. Only its test was removed.

**Finding 2 (nit) not touched.** The `columnWidths` floor comment/estimate nit is not on
a line this round changes (this round changes only the test file's existence), and the
round fixes only must-fix/should-fix findings.

Tests added: none. Finding 1 is a scope fix, not a behaviour change; the file deleted was
itself the only test, and the spec's "No tests (UI)" applies.

Commands:
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test run this round: there is no test file left and no behaviour changed.

`status` stays `review`.

### Lead fix round 3 (2026-10-13)

**Problem.** The lead's emulator smoke of head `c5976c65` (fresh bundle) showed the
hidden width-reserving meta still painted: times appeared twice — the visible one at the
bottom-right ("edited 10:27", "09:52") and the hidden one at the left ("10:27", "09:52")
— and one-line times looked bold/smudged because both copies drew on top of each other.

**Cause.** On Android `'transparent'` becomes the int `0x00000000`; React Native treats
a colour of 0 on a **nested** `Text` span as "unset", so the span inherited its parent's
visible colour and painted. A parent `opacity: 0` does not hide an inline `Text`'s
children either.

**Fix.** Added one named constant in `plain-bubble-body.tsx`:

```ts
const HIDDEN_TEXT_COLOR = 'rgba(0,0,0,0.004)';
```

with a comment explaining it is not `'transparent'` (non-zero alpha rounds the alpha
byte to 1: invisible, but not the "unset" 0). `BubbleInlineMeta` now uses it for the
hidden meta text and for the hidden "Not sent" span (both were `'transparent'`). The tick
`View` keeps its own `opacity: 0`, which worked. `grep -rn "'transparent'"` over
`apps/mobile/src/components/chat` leaves only this comment and an unrelated
`backgroundColor` in `attach/gallery-tab.tsx`; no other hidden meta used `'transparent'`.
No other file changed.

Commands:
- `pnpm gate`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test run: the change is UI-only and the spec says "No tests (UI)". The
  outcome (times no longer double, no bold/smudge) rests on the code path, not on a
  device — I have no Android mock build in this session.

`status` stays `review`.

## Review (written by Claude)

**Lead, 2026-10-13: approved after 3 lead rounds and 2 auto rounds; the packet is current for `56aa44fb`.**
- **Lead rounds:**
  1. wrapped time must be right-aligned, and table columns floor to their longest word;
  2. the reserved spacer painted, so every time showed twice;
  3. the root cause: on Android, `'transparent'` is colour 0, which a nested `Text` span treats as unset and inherits the parent's colour. The fix is `HIDDEN_TEXT_COLOR = 'rgba(0,0,0,0.004)'`.
- **Lead's emulator check** (Android mock build of `56aa44fb`):
  - Viernes: every time shows once, inline at the right, and "edited 10:33" is on its own right-aligned row;
  - Dev AI: one-liners are inline at the right, "PR #42 …" has "09:58" right-aligned on its own row, and "Review summary" shows a table with whole words.
