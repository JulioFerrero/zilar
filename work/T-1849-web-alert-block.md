---
id: T-1849
title: "Alert card A5 (web): draw 18 · ALERT RULE like WebChoices.dc.html:150-166 — bell + title, a threshold well and a switch, the note line — answering through BlockRespond (switch = done, well = fields.value), no @AI reply"
status: merged
milestone: M5
branch: task/T-1849-web-alert-block
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1849: Web alert block (alert plan A5)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/alert-card.md` (2026-10-17), option B.** This is task 5 of §6. The web skips `alert` blocks today (`BlockCard.tsx` `default: return null`).
- **The server side** (T-1848, running in parallel) records an alert answer.
- **In option B** the answer is not a decision: **no `@AI` reply is sent.**

### Facts (read by the lead on 2026-10-17)
- **The block** (`packages/protocol/src/blocks-choices.ts:147-158`): `{ kind: 'alert', id, title, field: { label, value }, on: boolean, note?: string }`.
- **The board** (`docs/design/mockups/blocks/WebChoices.dc.html:150-166`):
  - **head row:** a lucide `Bell`, 14 px, `#a1a1a1`, then the title with `flex-grow: 1`;
  - **a row with `gap: 10px`:**
    - the well input showing the value (the form's well);
    - a switch: 44×26, radius 999, padding `0 3px`. When on, its track is `linear-gradient(180deg,#ffffff,#d4d4d4)` with `box-shadow: inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)`, and a 20 px knob `linear-gradient(180deg,#2c2c2c,#151515)` sits at the right;
  - **the note** at 12 px, `#8a8a8a`, e.g. "Checked every 5 min · now $82,302";
  - **the time.**
- **Styles to reuse:** `apps/web/src/components/message/blocks/FormBlock.tsx` has `MAX_FIELD_CHARS = 120` (`:8`), `WELL_STYLE` (`:11-17`), `ICON_KEY_STYLE` (`:19-23`) and `LIGHT_KEY_STYLE`.
- **The answer pattern:** `RatingBlock.tsx` uses `useBlockRespond()`, a `busy` flag, the prop-sync pattern (`seenSelected`), and `respond.answer(block.id, value).then(data => data === null ? revert : …)`.
  - `respond === null` (fixtures, the viewer's own card) draws disabled controls.
- **The dispatch:**
  - `ChoiceBlocks.tsx` (32 lines) `renderChoiceBlock` switches on `'buttons' | 'poll' | 'choice' | 'form' | 'rating'`;
  - `BlockCard.tsx:40-45` lists those cases before `return renderChoiceBlock(block, showHeading)`.
- **The fixture:** `ChoiceBlocks.fixture.tsx` (185 lines) holds the rating examples at `:104-117`.

### Steps
1. **New `apps/web/src/components/message/blocks/AlertBlock.tsx`** `{ block, showHeading }`:
   - **Head row:** a `Bell` (14 px, `#a1a1a1`, `aria-hidden`) and the title, shown when `showHeading` is true, the same way `FormBlock` handles it.
   - **The well:** an `<input>` with `WELL_STYLE`, `aria-label={block.field.label}`, `maxLength={MAX_FIELD_CHARS}` and `inputMode="decimal"`.
     - **It commits on Enter or blur,** only when the trimmed text changed and is not empty: `respond.answer(block.id, { fields: { value } })`.
     - **On `null`** it reverts to the previous value.
   - **The switch:** a `<button role="switch" aria-checked={on} aria-label="Alert on">` with the board's on look.
     - **The off look** has the `ICON_KEY_STYLE` track and a `#8a8a8a` knob at the left.
     - **A click** sets `on` optimistically and calls `respond.answer(block.id, { done: next })`; on `null` it reverts.
   - **Both controls** are disabled while `busy` or when `respond === null`.
   - **The note:** `block.note` under the row (12 px, `#8a8a8a`) when present.
   - **A room correction** of `on` or `field.value` replaces the local state (the prop-sync pattern from `RatingBlock`).
   - **Never call `reply`.** Export `MAX_FIELD_CHARS` and `WELL_STYLE` from `FormBlock.tsx` (or a small shared file) rather than copying them.
2. **Dispatch:** add `'alert'` to `renderChoiceBlock`'s union and switch, and to the case list in `BlockCard.tsx`.
3. **Fixture:** add the board's example to `ChoiceBlocks.fixture.tsx`:
   - title "Tell me when BTC goes above";
   - field `{ label: 'Price', value: '$90,000' }`, `on: true`;
   - note "Checked every 5 min · now $82,302".

   Also add an off variant.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/web/src/components/message/blocks/AlertBlock.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.tsx`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `apps/web/src/components/message/blocks/choiceStyles.ts`
- `apps/web/src/components/message/blocks/ChoiceBlocks.fixture.tsx`
- `work/T-1849-web-alert-block.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The card draws as on the board** at 1440 and 390, with on and off looks.
- **The switch and the well** answer through `respond.answer` and revert on failure; no @AI reply is sent.
- **Controls are disabled** without a responder.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`AlertBlock.tsx` (new):** draws 18 · ALERT RULE as on `WebChoices.dc.html:150-166`: the `Bell` head row (14 px, `#a1a1a1`) with the title when `showHeading`, a `gap: 10px` row holding the well input and the 44×26 switch, and the 12 px `#8a8a8a` note. The well commits its trimmed value on Enter (via `blur`) or blur when it changed and is not empty; the switch toggles optimistically. Both call `respond.answer(block.id, { fields: { value } })` / `{ done: next }`, revert on `null`, and are disabled while `busy` or when `respond === null`. The prop-sync pattern on `block.on` and `block.field.value` applies a room correction. `reply` is never called, so no @AI reply is sent.
- **`choiceStyles.ts` (new):** `MAX_FIELD_CHARS`, `WELL_STYLE`, `ICON_KEY_STYLE` and `LIGHT_KEY_STYLE`, moved out of `FormBlock.tsx` so the form and the alert share them instead of copying.
- **`FormBlock.tsx`:** imports the four constants from `choiceStyles.ts`; behaviour unchanged.
- **Dispatch:** `'alert'` added to `renderChoiceBlock`'s union, switch and import in `ChoiceBlocks.tsx`, and to the case list in `BlockCard.tsx`.
- **Fixture:** `ChoiceBlocks.fixture.tsx` gains the on example (title "Tell me when BTC goes above", `Price`/`$90,000`, `on: true`, note "Checked every 5 min · now $82,302") and an off variant.
- No tests added (UI), per the spec. Every file stays under 400 lines.

### Checks run

- `pnpm install`: Done in 16.3s.
- `pnpm gate`: GATE PASS. Summary lines:
  - `gate: 7 changed file(s) against main`
  - `PASS install (frozen) (2.0s)`
  - `PASS format (1.1s)`
  - `PASS lint (1.6s)`
  - `PASS typecheck (4.9s)`
  - `PASS effect (1.4s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the task adds UI only and the web package has no nearby tests.

### Notes for the lead

- The card was built from the board's exact values, but I did not open it in a browser (no dev server daemon allowed and the checks list only `pnpm gate`); the 1440/390 visual check rests on the lead's smoke.
- As the spec dictates, the switch answers `{ done: next }` and the well `{ fields: { value } }`; the server/contract side is T-1848.
- `RatingBlock.tsx` still holds its own copy of the icon-key style. I left it untouched because it is outside the Allowed files; it could import `choiceStyles.ts` in a later cleanup.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `6764d3967`.
- **The screen check:** I screenshotted the fixture from the branch's Cosmos renderer at 900 px wide. It matches `WebChoices.dc.html:150-166`:
  - the bell and the title;
  - a `$90,000` well;
  - the white switch with its dark knob at the right;
  - the note line and the time.

  The off variant shows the dark track with a grey knob at the left.
- **The code:** the well and the switch answer through `respond.answer` and revert on `null`; no reply is sent. Controls are disabled without a responder. The form styles moved to `choiceStyles.ts` unchanged.
- **The `RatingBlock` key-style copy** is left for a later cleanup.

