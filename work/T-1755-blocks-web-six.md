---
id: T-1755
title: "Blocks B4 (web): the blocks card shell and the first six blocks (01 figures, 02 big number, 08 checklist read-only, 12 status, 19 link, 25 callout), drawn exactly like the approved boards"
status: merged
milestone: M5
branch: task/T-1755-blocks-web-six
model: auto
effort: default
depends_on: [T-1749, T-1752]
estimate: 45 min
---

# T-1755: Web draws message blocks (the first six)

## Spec (written by Claude, do not edit)

### Why
AIs and saved tools will send small native layouts inside a message: the `blocks` payload. Julio approved the boards in `docs/design/mockups/blocks/` ("OH i love it…"). The plan is `docs/plan/message-blocks.md` (§3, task B4). This task draws the card and six blocks on web. The phone twin runs at the same time.

**Julio's standing complaint is "design looks nice, app is ugly"**, so match the boards' exact values (colours, sizes, gaps, fonts). The lead compares a screenshot with the board before merging.

### Facts (read by the lead on 2026-10-16)
- **The payload** (`@zilar/protocol`): `{ v: 0, type: 'blocks', data: BlocksData }`.
  - `BlocksData` is `{ title?, icon?, meta?, fallback, blocks: Block[] }` (`packages/protocol/src/blocks.ts:80-98`).
  - The block types and fields are in `packages/protocol/src/blocks-numbers.ts` (`FigureBlock`, `NumberBlock`, `Change`, `BlockIcon`), `blocks-progress.ts` (`ChecklistBlock`, `StatusBlock`) and `blocks-content.ts` (`LinkBlock`, `CalloutBlock`).
  - The client gets it as `message.card` (`packages/chat-core/src/types.ts:86`, `card?: Payload`).
- **Shared helpers** (`@zilar/chat-core`, `packages/chat-core/src/blocks.ts`): `changeTone`, `statusTone`, `calloutTone`, `sparklinePath(points, w, h, pad?)`, `checklistCount` and `linkHost`. Use them; don't re-implement them.
- **The boards** (read each one; these are exact values):
  - the shared look is in `docs/design/mockups/blocks/README.md` ("The shared look"), and the CSS classes are in `Main.dc.html:12-29`;
    - `.card`: `#141414`, a 1 px `#232323` border, 16 px radius, padding 12/14/8/14, gap 10;
    - `.head`: 13/500 `#a1a1a1`, a 14 px icon;
    - `.time`: mono 10 `#8a8a8a`, at the bottom right;
    - `.num`: Geist Mono, tabular, right-aligned;
    - `.up` is `#4ade80` and `.down` is `#f87171`;
    - `.rule`: 1 px `#232323`;
    - `.box-on` and `.box-off` are the checkbox recipes.
  - **The card in a chat:** `Main.dc.html:52-71` ("Prices"). It's a standalone card next to the AI's avatar, **not** inside a bubble. Several blocks in one card are split by `.rule` (`Main.dc.html:74-130`, "Morning briefing").
  - **01 figures:** `WebNumbers.dc.html:38-52`.
  - **02 big number** with change and sparkline: `WebNumbers.dc.html:53-67`.
  - **08 checklist:** `WebProgress.dc.html:43-63`. It's read-only in this task: ticks show, and nothing can be tapped.
  - **12 status list:** `WebProgress.dc.html:132-150`. A dot with a soft ring plus a value, never a word; the dot has `role="img"` and an `aria-label`.
  - **19 link card:** `WebContent.dc.html:37-53`. It opens in a new tab with `rel="noopener noreferrer"`.
  - **25 callout:** `WebContent.dc.html:103-122` (success and warning).
- **Where a card is drawn on web:**
  - `apps/web/src/components/message/AttachmentBody.tsx` (305 lines). The card switch is at `:246-264`; a `progress` card skips the padding box at `:248`. The meta row below a card without text is at `:266-279` (`message.card.type !== 'progress'`).
  - `hidesBodyText` is in `apps/web/src/components/message/QuestionCard.tsx:12-16`. It hides the fallback text for card types that draw themselves.
  - `apps/web/src/components/MessageBubble.tsx` (388 lines): `standaloneCard = message.card?.type === 'progress'` at `:132` drops the bubble surface (`:275`, `:286`).
- **Web Cosmos fixtures** exist (for example `apps/web/src/components/ui/card.fixture.tsx`); the app runs `cosmos` (`apps/web/package.json:9`). Icons come from `lucide-react` (`apps/web/package.json:32`); never use emoji.

### Steps
1. **Create `apps/web/src/components/message/blocks/`**, one file per part, each under about 150 lines:
   - `blockIcons.ts`: a map from every `BlockIcon` name (`blocks-numbers.ts`) to a lucide-react component. Where the names differ, pick the closest: `chart` to `ChartColumn`, `sliders` to `SlidersHorizontal` and `warning` to `TriangleAlert`.
   - `BlockCard.tsx`: the `.card` shell.
     - It draws the optional header row (icon, title, and the mono `meta` on the right).
     - Then each block, through a small switch, with a `.rule` between blocks.
     - Then a footer slot at the bottom right for the time.
     - Width: `min-w-[280px] max-w-[380px] w-full`.
     - A kind with no renderer yet (19 of the 25) is skipped. If nothing renders, show `data.fallback` as plain 14/20 text inside the card.
   - `FigureBlock.tsx`, `NumberBlock.tsx` (the sparkline is an inline `<svg>` with `sparklinePath`; the stroke and fill are as on the board), `ChecklistBlock.tsx` (read-only, with the `checklistCount` fraction as on the board), `StatusBlock.tsx`, `LinkBlock.tsx` (the host is `linkHost(url)` unless `site` is set) and `CalloutBlock.tsx`.
2. **Wire it:**
   - **`AttachmentBody.tsx`:** add `message.card.type === 'blocks'` to the switch, rendering `<BlockCard data={message.card.data} footer={<MessageMeta …/>} />` (reuse `MessageMeta` for the time, styled like the board's `.time`).
   - **The padding box:** give `blocks` no padding box, like `progress`.
   - **The meta row:** leave `blocks` out of the meta row at `:266-279`, since the card shows its own time.
   - **`QuestionCard.tsx`:** `hidesBodyText` also returns true for `'blocks'`.
   - **`MessageBubble.tsx:132`:** `standaloneCard` is also true for `'blocks'`. Keep the file at most 400 lines.
3. **Fixture:** a new `apps/web/src/components/message/blocks/BlockCard.fixture.tsx`. It renders one card per board example with the boards' sample data:
   - Prices (01);
   - Bitcoin (02, with points);
   - Groceries (08);
   - Services (12);
   - the link (19);
   - both callouts (25);
   - and the two-block "Morning briefing" shape (figures, a rule, then a checklist).
   - Show them on a `#0a0a0a` page so the lead can screenshot it next to the boards.
4. **No tests** (UI).

### Allowed files
- `apps/web/src/components/message/blocks/blockIcons.ts`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/FigureBlock.tsx`
- `apps/web/src/components/message/blocks/NumberBlock.tsx`
- `apps/web/src/components/message/blocks/ChecklistBlock.tsx`
- `apps/web/src/components/message/blocks/StatusBlock.tsx`
- `apps/web/src/components/message/blocks/LinkBlock.tsx`
- `apps/web/src/components/message/blocks/CalloutBlock.tsx`
- `apps/web/src/components/message/blocks/BlockCard.fixture.tsx`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/QuestionCard.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-1755-blocks-web-six.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A message whose card is `blocks` draws the standalone card with the six blocks, matching the boards' values, and hides its fallback text.
- Other block kinds are skipped, and the card falls back to the fallback text when nothing renders.
- The fixture shows every board example. The gate passes.

---

## Report (written by the worker when done)

### What I did

Drew the blocks card and the first six block kinds on web, matching the boards' values.

New files in `apps/web/src/components/message/blocks/`:

- `blockIcons.ts` — every `BlockIcon` name to a lucide component (`chart`→`ChartColumn`, `sliders`→`SlidersHorizontal`, `warning`→`TriangleAlert`).
- `BlockCard.tsx` — the `.card` shell (`#141414`, 1 px `#232323`, 16 px radius, padding 12/14/8/14, gap 10, `min-w-[280px] max-w-[380px] w-full`), the optional header row (icon 14, title 13/500 `#a1a1a1`, mono `meta` `#8a8a8a`), a `.rule` (`#232323`) between blocks, the footer slot, the block switch, and the `fallback` as plain text when nothing renders.
- `FigureBlock.tsx` — label/value rows, 3 columns with a change, 2 without; change coloured and arrowed from `changeTone`.
- `NumberBlock.tsx` — label head + optional `code`, the 30/36 value, the change 13, and an inline `<svg>` sparkline from `sparklinePath` (stroke the change colour, `fill="none"`).
- `ChecklistBlock.tsx` — read-only ticks (the boards' `.box-on`/`.box-off` recipes) and the `checklistCount` fraction.
- `StatusBlock.tsx` — head + rows of dot (tone ring) + label + value; the dot has `role="img"` and an `aria-label`.
- `LinkBlock.tsx` — the `#101010`/`#1f1f1f` inner card, host from `linkHost(url)` unless `site` is set, opening in a new tab with `rel="noopener noreferrer"`.
- `CalloutBlock.tsx` — the tinted circle + glyph from `calloutTone`, then the line of text.
- `BlockCard.fixture.tsx` — all board examples on one `#0a0a0a` page (Cosmos entry `All examples`).

Wiring (unchanged behaviour for other cards):

- `AttachmentBody.tsx`: added the `blocks` case rendering `<BlockCard … footer={<MessageMeta …/>} />`, gave `blocks` no padding box (like `progress`), and left `blocks` out of the meta row.
- `QuestionCard.tsx`: `hidesBodyText` returns true for `'blocks'`.
- `MessageBubble.tsx`: `standaloneCard` is true for `'blocks'` (file stays 388 lines).

### Checks run

`pnpm gate` (from the repo root), real result:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.6s)
PASS  lint  (0.6s)
PASS  typecheck  (4.9s)
PASS  effect  (1.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No unit tests were run: the spec says "No tests (UI)", and the gate found no nearby test files for `@zilar/web`.

### Notes for the lead

- **Block-level heads vs the card head.** The boards draw a head per block (02 "Bitcoin/BTC", 08 "Groceries/2 of 5", 12 "Services"), so the block renderers draw their own head and `BlockCard` draws the `data`-level head (Prices "Prices/daily 09:00", Morning briefing "Morning briefing/Fri 17 Oct"). The one place this shows an extra head vs a board is the Morning briefing: the two-block shape's checklist carries its own title, so it renders its head too; the board's briefing checklist has no head. Say the word if you want block heads suppressed inside multi-block cards.
- **Callout time.** The board shows a lone callout's time inline in its row; the spec puts the time in `BlockCard`'s footer slot, so a callout card's time sits on the line under the callout. Kept the spec's footer approach.
- **Ticks.** The card time reuses `MessageMeta` styled `#8a8a8a`, with `showTicks={own}` (the boards are incoming AI cards, so no ticks there; own messages keep their ticks).
- I added one extra fixture example ("Unknown kind · fallback") using a `progress` block, to make the acceptance "falls back when nothing renders" visible next to the boards. It is not one of the seven board examples.

### Round 1 (fixes for PREREVIEW)

Findings fixed (one commit each, both inside Allowed files):

- **Finding 1 (should-fix), `fd3be585`** — the read-only checklist tick was a real checkbox inside a `<label>`, so tapping the row toggled it (`readOnly` has no effect on checkboxes). `ChecklistBlock.tsx` now uses a `div` wrapper, so nothing forwards a click to the checkbox, and the `sr-only` input carries `tabIndex={-1}` to stay out of the tab order. Added `aria-label={item.label}` so the hidden checkbox keeps its accessible name now that the `<label>` is gone.
- **Finding 2 (should-fix), `cd9d075`** — `BLOCK_ICONS[name]` had no fallback, so an unknown `icon` name (a newer server under expand/contract) made `Icon` `undefined` and React threw. `BlockCard.tsx` now looks the name up as `Partial<Record<BlockIcon, LucideIcon>>` and falls back to a neutral `Info` glyph, matching how unknown block kinds already degrade to `null`.

Nits 3 and 4: not changed (rule: don't touch nits outside lines already changed). For the record, `MessageBubble.tsx` is now 389 lines (nit 3), still within the 400 cap.

Tests added: none. Both fixes are UI behaviour, the Spec says "No tests (UI)" (§3.5) and the Allowed files list contains no test path — a test file would fall outside scope and fail the gate. Noted here so the missing test is deliberate, not an oversight.

Disagreements: none.

Gate (Run after both fixes, from the repo root):

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.2s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single tests were run: the package has no test files near the change (UI), so `--reporter=dot` had nothing to run.

### Round 2 (lead fix round: compact lone callout)

Change: a headerless card whose only rendered block is a `callout` now draws as one compact row, matching the board at `docs/design/mockups/blocks/WebContent.dc.html:103-122`:

- `BlockCard.tsx` builds a compact branch before the stacked layout: `flex-row items-center gap-3` with `px-[14px] py-[12px]` (12/14 padding, like the board's `style="flex-direction: row; align-items: center; gap: 12px; padding: 12px 14px"`), the callout in a `min-w-0 flex-1` wrapper, and the footer passed at the end of the row instead of in a footer row underneath.
- It mirrors the phone twin's `compactCallout` branch (T-1756): the condition is `!hasHeader && rendered.length === 1 && block.kind === 'callout'`, so a lone callout with a header, a multi-block card, or any other lone block keeps the old stacked layout. Everything else is unchanged.
- The fixture needed no edit: it already renders both callouts (`CALLOUT_SUCCESS` at `03:04`, `CALLOUT_WARNING` at `19:40`), which now appear as the board's two compact rows.

Tests added: none (same reason as Round 1 — UI, "No tests (UI)", no test path in Allowed files).

Gate (from the repo root, after the change):

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (0.7s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Round 3 (fix round for PREREVIEW finding 1)

Finding fixed (should-fix, inside Allowed files): unknown `status` / `tone` /
`direction` values no longer crash or garble the card (`PREREVIEW.md` finding 1).
Each lookup now falls back the way `BlockIcon` already does, so an additive enum
value from a newer server (expand/contract) degrades gracefully instead of
throwing inside the message list (there is no `ErrorBoundary` in `apps/web/src`):

- `StatusBlock.tsx` — `DOT[statusTone(row.status)] ?? DOT.neutral`; an unknown
  `status` no longer leaves `dot` `undefined` and throws on `dot.color`.
- `CalloutBlock.tsx` — `CALLOUT[calloutTone(block.tone)] ?? CALLOUT.neutral`; an
  unknown `tone` no longer leaves `tone` `undefined` and throws on `tone.icon`.
- `NumberBlock.tsx` and `FigureBlock.tsx` — `CHANGE_ARROW[dir] ?? '—'`; an unknown
  `direction` now renders the flat dash instead of the literal `undefined 2.1%`.
  `CHANGE_COLOR` is left as-is on purpose, exactly as the finding says: a miss
  there only yields an unstyled span, never a throw.

One commit for the one finding: `317cd9777` —
`T-1755: fix finding 1 - unknown enum lookups fall back instead of crashing`.

Tests added: none, deliberately. The Spec says "No tests (UI)" (§3.5), the
Allowed files list names no test path, and the fix-round rule forbids changing
anything outside the Allowed files — a new
`apps/web/src/components/message/blocks/BlockCard.test.tsx` would be outside
scope and the gate's scope line would flag it. Noted here so the missing test is
a deliberate decision, not an oversight. The fallbacks are plain map lookups, so
the lead's screenshot smoke covers them.

Disagreements: none — the finding is correct and is fixed as described.

Gate (from the repo root, after the fix):

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single tests were run: `@zilar/web` has no test file near the change, so there
was nothing for `--reporter=dot` to run.

## Review (written by Claude)

- **Accepted at `a049b2e37`,** after 2 automatic rounds and 1 lead round (1 cosmetic nit left).
- **The lead compared the boards with the Cosmos fixture,** screenshot at 1000 px:
  - **match:** 01 figures (Prices, with header, meta and change column), 02 big number with sparkline, 08 checklist, 12 status list, 19 link card, the two-block "Morning briefing" with its rule, and the fallback card for an unknown kind;
  - **fixed in the lead round:** a lone callout is now one compact row with the time inline (`WebContent.dc.html:103-122`). The re-shot screenshot matches.
- **Wiring:**
  - a `blocks` card stands alone (no bubble) and hides its fallback text;
  - its time is in the card footer;
  - unknown kinds are skipped, with the fallback when nothing renders;
  - unknown enum values fall back instead of throwing.
- **No tests** (UI).

