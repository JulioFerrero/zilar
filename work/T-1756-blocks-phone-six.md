---
id: T-1756
title: "Blocks B5 (phone): the blocks card shell and the first six blocks (01 figures, 02 big number, 08 checklist read-only, 12 status, 19 link, 25 callout), drawn exactly like the approved phone boards"
status: merged
milestone: M5
branch: task/T-1756-blocks-phone-six
model: auto
effort: default
depends_on: [T-1749, T-1752]
estimate: 45 min
---

# T-1756: The phone draws message blocks (the first six)

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1755 (web, running now). AIs and saved tools send a `blocks` payload, and the phone draws it with native views. Julio approved the boards in `docs/design/mockups/blocks/`. The plan is `docs/plan/message-blocks.md` (§3, task B5).

Match the phone boards' exact values: Julio's standing complaint is "design looks nice, app is ugly".

### Facts (read by the lead on 2026-10-16)
- **The payload** (`@zilar/protocol`): `{ v: 0, type: 'blocks', data: BlocksData }`.
  - `BlocksData` is `{ title?, icon?, meta?, fallback, blocks: Block[] }` (`packages/protocol/src/blocks.ts:80-98`).
  - The block types are in `packages/protocol/src/blocks-numbers.ts`, `blocks-progress.ts` and `blocks-content.ts`.
  - On the phone the message carries it as `message.card`.
- **Shared helpers** (`@zilar/chat-core`, `packages/chat-core/src/blocks.ts`): `changeTone`, `statusTone`, `calloutTone`, `sparklinePath(points, w, h, pad?)`, `checklistCount` and `linkHost`. Use them.
- **The phone boards** (read each one; these are exact values):
  - the shared look is in `docs/design/mockups/blocks/README.md` (phone text 15/21, header icon 16 px), with the CSS classes at the top of each board;
  - **the card in a chat:** `PhoneChat.dc.html:52-71` ("Prices"). It's a standalone card next to the AI's avatar, not inside a bubble. Several blocks in one card are split by a 1 px `#232323` rule (`PhoneChat.dc.html:74-120`, "Morning briefing");
  - **01 figures:** `PhoneNumbers.dc.html:38-52`;
  - **02 big number:** `PhoneNumbers.dc.html:53-67`;
  - **08 checklist:** `PhoneProgress.dc.html:42-62`, read-only in this task;
  - **12 status list:** `PhoneProgress.dc.html:129-150`, a dot plus a value, never a word;
  - **19 link card:** `PhoneContent.dc.html:35-51`, opened with `Linking.openURL` like `apps/mobile/src/components/chat/link-preview-card.tsx:11`;
  - **25 callout:** `PhoneContent.dc.html:161-186`.
- **Where a card is drawn on the phone:**
  - `apps/mobile/src/components/chat/payload-card.tsx` (64 lines): the `PayloadCard` switch is at `:39-50`, and `RENDERED_CARD_TYPES` is at `:56-60`;
  - `apps/mobile/src/components/chat/message-bubble-content.tsx` (340 lines) draws `<PayloadCard card=… />`, then a `BubbleMeta` time row unless the card is `progress` (`:188-200`);
  - `apps/mobile/src/components/chat/message-bubble.tsx` (365 lines): `standaloneCard = message.card?.type === 'progress'` at `:128` skips the bubble surface.
- **Sparkline:** use `react-native-svg` (`apps/mobile/package.json:70`) `Path` with `sparklinePath`.
- **Icons:** use `lucide-react-native` (`apps/mobile/package.json:58`); never emoji.
- **Mono numbers:** follow the `font-mono` class used in `apps/mobile/src/components/chat/progress-card.tsx:142`, plus `fontVariant: ['tabular-nums']`.
- **The hidden dev catalog pattern:**
  - the route `apps/mobile/src/app/dev/kit.tsx` (18 lines) loads `apps/mobile/src/mock/dev-kit-screen.tsx` behind `__DEV__`, and redirects home in release builds;
  - it's reachable only through `zilar://dev/kit`.

### Steps
1. **Create `apps/mobile/src/components/chat/blocks/`**, one file per part, each under about 150 lines:
   - `block-icons.ts`: a map from every `BlockIcon` name to a lucide-react-native component (`chart` to `ChartColumn`, `sliders` to `SlidersHorizontal`, `warning` to `TriangleAlert`);
   - `block-card.tsx`: the card shell (`#141414`, a 1 px `#232323` border, 16 px radius, the board's padding and gap).
     - It draws the optional header row, each block through a switch with a rule between blocks, and a `footer` slot at the bottom right.
     - Width: `minWidth: 260`, `maxWidth: 340`, and `width: '100%'`.
     - It skips kinds with no renderer yet, and shows `data.fallback` as 15/21 text when nothing renders;
   - `figure-block.tsx`, `number-block.tsx` (an `Svg` sparkline), `checklist-block.tsx` (read-only), `status-block.tsx` (a dot with `accessibilityRole="image"` and an `accessibilityLabel`), `link-block.tsx` and `callout-block.tsx`.
2. **Wire it:**
   - **`payload-card.tsx`:** add `'blocks'` to `RENDERED_CARD_TYPES` and a `case 'blocks'` that renders `<BlockCard data={card.data} footer={footer} />`. `PayloadCard` takes an optional `footer?: ReactNode` prop.
   - **`message-bubble-content.tsx`:** for `blocks`, pass the `BubbleMeta` time row as `footer`, and don't draw it again below. Keep the file at most 400 lines.
   - **`message-bubble.tsx:128`:** `standaloneCard` is also true for `'blocks'`.
   - **The fallback text:** the body text must not show above or below a blocks card. Check how a `question` card hides its fallback on the phone (search `message-bubble-content.tsx` for the card branch order) and make `blocks` behave the same.
3. **Dev catalog:**
   - a new route `apps/mobile/src/app/dev/blocks.tsx`, a copy of `kit.tsx`'s pattern;
   - a new `apps/mobile/src/mock/dev-blocks-screen.tsx` that renders one card per phone board example with the boards' sample data: Prices, Bitcoin with points, Groceries, Services, the link, both callouts, and the two-block "Morning briefing" shape.
   - The lead screenshots it next to the boards.
4. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/blocks/block-icons.ts`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/figure-block.tsx`
- `apps/mobile/src/components/chat/blocks/number-block.tsx`
- `apps/mobile/src/components/chat/blocks/checklist-block.tsx`
- `apps/mobile/src/components/chat/blocks/status-block.tsx`
- `apps/mobile/src/components/chat/blocks/link-block.tsx`
- `apps/mobile/src/components/chat/blocks/callout-block.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/app/dev/blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1756-blocks-phone-six.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A `blocks` message draws the standalone card with the six blocks, matching the phone boards, with no fallback text around it.
- Unknown kinds are skipped, with the fallback text shown when nothing renders.
- `zilar://dev/blocks` shows every board example in dev builds. The gate passes.

---

## Report (written by the worker when done)

### What I did

The phone twin of T-1755's web blocks: a new
`apps/mobile/src/components/chat/blocks/` folder plus the dev catalog, and the
wiring that makes a `blocks` card a standalone card.

New files (all under 150 lines):
- `block-icons.ts` — a total `Record<BlockIcon, LucideIcon>`; `chart` →
  `ChartColumn`, `sliders` → `SlidersHorizontal`, `warning` → `TriangleAlert`,
  the rest 1:1.
- `block-card.tsx` — the card shell: `#141414`, 1 px `#232323` border, 16 px
  radius, `padding 12/14/8/14`, 10 px gap, `minWidth 260 / maxWidth 340 / width
  100%`. Draws the optional header row (16 px lucide icon, title 14/500
  `#a1a1a1`, right mono 12 `#8a8a8a` meta), then each block through a switch
  with a 1 px `#232323` rule between blocks, then the `footer` slot at the
  bottom right. It skips the 19 kinds with no renderer and shows `data.fallback`
  (15/21) when none render. A `TextClassContext` gives the body 15/21 without
  touching the footer's own size.
- `figure-block.tsx` (01) — label / right value / optional change rows; keeps the
  change column once any row has one, so values align. Exports the shared
  `TABULAR` style, `changeColor` and `changeLabel` (▲/▼ from the boards).
- `number-block.tsx` (02) — label + code row, the 32/38 value, the optional
  change, and the `react-native-svg` sparkline (`Path` from `sparklinePath`,
  `preserveAspectRatio="none"`, 1.6 px stroke coloured by the change tone).
- `checklist-block.tsx` (08, read-only) — its own title row (ListChecks icon,
  title, the `checklistCount` `done of total` fraction) and the ticked/unticked
  boxes with the `by` name; the boxes are views, never controls.
- `status-block.tsx` (12) — its own title row (Activity icon) and a dot plus a
  value per row; the dot is `accessibilityRole="image"` with a status word as
  `accessibilityLabel` (`statusTone` decides the colour and ring).
- `link-block.tsx` (19) — the `#101010` inner tile, host from `site`/`linkHost`,
  opened with `Linking.openURL` behind `safeLinkTarget`, key from the shared
  `iconKey` depth recipe.
- `callout-block.tsx` (25) — the tone icon in its tinted circle, then the line
  (`calloutTone`, success/warning/error/info).

Wiring:
- `payload-card.tsx`: `PayloadCard` takes `footer?: ReactNode`; a `case 'blocks'`
  renders `<BlockCard data={card.data} footer={footer} />`; `'blocks'` joins
  `RENDERED_CARD_TYPES`.
- `message-bubble-content.tsx`: the card branch passes the `BubbleMeta` row as
  the blocks card's `footer`, and no longer draws the meta below it.
- `message-bubble.tsx`: `standaloneCard` is also true for `'blocks'`, so the card
  skips the bubble surface like a progress card.
- Fallback: the card branch is taken before the markdown/plain branches, so a
  rendered card never draws the body text; adding `blocks` to
  `RENDERED_CARD_TYPES` gives it the same behaviour as question/progress/
  approval. `BlockCard` shows `data.fallback` only when no block kind renders.

Dev catalog:
- `apps/mobile/src/app/dev/blocks.tsx` — the `kit.tsx` route pattern, behind
  `__DEV__`, reachable only through `zilar://dev/blocks`.
- `apps/mobile/src/mock/dev-blocks-screen.tsx` — one card per board example
  (Prices 01, Bitcoin 02 with points, Groceries 08, Services 12, the link 19,
  both callouts 25, and a two-block Morning briefing) on a `#0a0a0a` page.

No tests (UI), as the spec says.

### Checks run

`pnpm gate` (from the repo root), the only command run for the checks:

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.7s)
PASS  lint  (2.1s)
PASS  typecheck  (4.8s)
PASS  effect  (1.2s)
PASS  tests @zilar/mobile  (1.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run: the change is UI-only and the spec says no tests, so
the gate's `tests @zilar/mobile` step is the only test run. Before the gate I ran
`pnpm exec prettier --write` on the 13 files I changed (the gate's `format` step
only checks).

### Notes for the lead

Deviations / decisions worth a look while reviewing against the boards:
- **Block headings.** `BlockCard` draws the card-level header from
  `data.icon/title/meta`. Checklist and status blocks draw their *own* title row
  (with the `list-checks`/`activity` icons and, for the checklist, the
  `done of total` fraction on the right), which is the only way to reproduce
  board 08's single header; that row hides when the card already draws a header,
  so the Morning briefing mixed card shows one header as its board does.
- **Icon names are illustrative on the boards.** The boards use a cart (08) and
  an activity pulse (12); the vocabulary has no cart, so 08 uses `list-checks`.
- **Change arrows** are the text ▲/▼ the boards draw, not lucide glyphs.
- The dev screen is wrapped in `RequireAuth`, like the kit/whistle dev screens.
- Sparkline padding is `6` (the board's inset); with no change the line is
  `#ededed`.

Nothing is blocked.

### Lead fix round (status kept at `review`)

Three follow-ups, one commit each:

1. **A lone callout is one compact row** — `block-card.tsx`
   (`dafd8e7fd`). When a card has no header and exactly one block and that block
   is a `callout`, the card is drawn as a single row with 12/14 padding: the
   tinted icon, the line (flex 1) and the footer time inline at the right, with
   no footer row below, matching `PhoneContent.dc.html:161-186`. Every other
   card keeps the stacked layout (header, blocks, footer row).
2. **Shared tabular style** — `checklist-block.tsx`, `status-block.tsx`
   (`2b95022d0`). Both now import `TABULAR` from `figure-block.tsx` instead of
   defining their own.
3. **Dev screen behind auth** — `dev-blocks-screen.tsx` (`18f5193c3`). It is now
   wrapped in `RequireAuth`, like `dev-kit-screen.tsx:47`.

`pnpm gate` after the three commits:

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (2.8s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

## Review (written by Claude)

- **Accepted at `565f20eeb`.** It's clean after one lead round.
- **What the lead read against the phone boards:**
  - the card shell: `#141414`, a `#232323` border, 16 radius, padding 12/14/8/14, gap 10, text 15/21, a 16 px header icon and a mono meta;
  - unknown kinds are skipped, with the fallback when nothing renders;
  - the `blocks` card stands alone (`message-bubble.tsx`), and its time sits in the card's footer.
- **The lead's round:**
  - a lone callout is now one compact row with the time inline (`PhoneContent.dc.html:161-186`);
  - the shared `TABULAR`;
  - `RequireAuth` on the dev screen.
- **Still open:** the emulator check of `zilar://dev/blocks` against `PhoneNumbers`, `PhoneProgress` and `PhoneContent`. It wasn't run because Julio may be at the PC. It gates the next APK, not this merge, since phone code only ships with a build.
