---
id: T-1850
title: "Alert card A6 (phone): draw 18 · ALERT RULE like PhoneChoices.dc.html:146-163 — bell + title, a threshold well and a 50×30 switch, the note line — answering through the block respond context (switch = done, well = fields.value), no @AI reply"
status: merged
milestone: M5
branch: task/T-1850-phone-alert-block
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1850: Phone alert block (alert plan A6)

## Spec (written by Claude, do not edit)

### Why
**This is the web T-1849's phone twin** (`docs/plan/alert-card.md` §6 task 6; Julio approved option B on 2026-10-17). The phone skips `alert` blocks today. **The answer is not a decision, so no `@AI` reply is sent.**

### Facts (read by the lead on 2026-10-17)
- **The block** (`packages/protocol/src/blocks-choices.ts:147-158`): `{ kind: 'alert', id, title, field: { label, value }, on: boolean, note?: string }`.
- **The board** (`docs/design/mockups/blocks/PhoneChoices.dc.html:146-163`):
  - **head row:** a `Bell`, 16 px, `#a1a1a1`, then the title;
  - **a row with gap 10:** the well showing the value, and a switch 50×30 (radius 999). When on, it has the white gradient track and a dark knob at the right;
  - **the note** at 13 px, `#8a8a8a`, e.g. "Checked every 5 min · now $82,302";
  - **the time.**
- **`apps/mobile/src/components/chat/blocks/block-respond.tsx`** (81 lines):
  - `useBlockRespond()` returns `{ submit({ blockId, itemId?, value, reply?, onSettled? }), pending, … }` or `null`;
  - styles `KEY_LIGHT` (`:50`), `KEY_DARK` (`:57`) and `WELL` (`:65`).
- **The pattern:** `rating-block.tsx` uses `disabled = respond === null || respond.pending` and the render-time prop sync (`selectedFrom`).
- **The dispatch:**
  - `choice-blocks.tsx` (39 lines) has `CHOICE_KINDS` (`:11-17`) and `renderChoiceBlock` (`:24-38`);
  - `block-card.tsx:106-111` lists the choice cases.
- **The catalog:** `apps/mobile/src/mock/dev-choice-blocks.tsx` (150 lines) holds the dev examples.
- **`AGENTS.md`:**
  - `:65`: a view whose gradient look swaps needs a `key` that changes with the look;
  - `:69`: icons come from lucide, never emoji.

### Steps
1. **New `apps/mobile/src/components/chat/blocks/alert-block.tsx`:**
   - **Head row:** `Bell` (16 px, `#a1a1a1`) and the title.
   - **The well:** a `TextInput` with `WELL`, `accessibilityLabel={block.field.label}` and `maxLength={120}`.
     - **It commits** on `onSubmitEditing` and `onEndEditing`, only when the trimmed text changed and is not empty: `respond.submit({ blockId: block.id, value: { fields: { value } }, onSettled })`.
     - **On failure** it reverts.
   - **The switch:** a `Pressable` with `accessibilityRole="switch"` and `accessibilityState={{ checked: on, disabled }}`, at 50×30.
     - **When on,** it has the light track (the board's gradient, or `KEY_LIGHT`) with a dark knob at the right.
     - **When off,** it has the `KEY_DARK` track with a `#8a8a8a` knob at the left.
     - **The track** gets `key={on ? 'on' : 'off'}` (`AGENTS.md:65`).
     - **A press** sets `on` optimistically and calls `submit({ blockId, value: { done: next }, onSettled })`; it reverts when `ok` is false.
   - **The note:** `block.note` (13 px, `#8a8a8a`) when present.
   - **Disabled** when `respond === null || respond.pending`.
   - **A room correction** replaces the local `on` and value (the render-time prop sync from `rating-block.tsx`).
   - **Never pass `reply`.**
2. **Dispatch:** add `'alert'` to `CHOICE_KINDS`, to the `renderChoiceBlock` union and switch, and to the case list in `block-card.tsx`.
3. **Catalog:** add the board's example (on) and an off variant to `dev-choice-blocks.tsx`.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/alert-block.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/mock/dev-choice-blocks.tsx`
- `work/T-1850-phone-alert-block.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The card matches the phone board,** with on and off looks.
- **The switch and the well** answer through `submit` without a reply and revert on failure.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`apps/mobile/src/components/chat/blocks/alert-block.tsx` (new):** draws 18 · ALERT RULE — a `Bell` (16 px, `#a1a1a1`) and the title in the board's head row, the value in a `WELL` `TextInput` (`accessibilityLabel` = the field label, `maxLength={120}`) beside a 50×30 pill switch. The switch is a `Pressable` with `accessibilityRole="switch"` and `accessibilityState={{ checked: on, disabled }}`; on it has the board's white gradient track (`#ffffff → #d4d4d4`) with a dark gradient knob at the right, off it uses `KEY_DARK` with a `#8a8a8a` knob at the left. The track is keyed `on ? 'on' : 'off'` (`AGENTS.md:65`). The note is 13 px `#8a8a8a`.
- **Answers:** the well commits on `onSubmitEditing` and `onEndEditing` only when the trimmed text is non-empty and differs from the server value, sending `{ fields: { value } }`; the switch sets `on` optimistically and sends `{ done: next }`. Neither passes `reply`. Both revert on `ok === false`, and the render-time prop sync from `rating-block.tsx` lets a room correction replace `on` and the value. A `useRef` remembers the text an edit already sent, so submit + end of one edit sends once. Disabled when `respond === null || respond.pending`.
- **Dispatch:** added `'alert'` to `CHOICE_KINDS` and to `renderChoiceBlock`'s union and switch in `choice-blocks.tsx`, and to the case list in `block-card.tsx` (the renderer set already picks it up from `CHOICE_KINDS`).
- **Catalog:** added `18 · ALERT RULE (ON)` (the board's BTC example) and `18 · ALERT RULE (OFF)` to `dev-choice-blocks.tsx`.
- No tests added: UI-only change, per `AGENTS.md`. Every changed file is under 400 lines.

### Checks run
- `pnpm exec prettier --write` on `alert-block.tsx` and `choice-blocks.tsx` (the first gate run failed on format for those two; the write fixed it).
- `pnpm gate` from the repo root, final run:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test run: `apps/mobile` has no test near these files (the gate reports `SKIP tests @zilar/mobile`).
- I did not run the app on a phone or simulator, so the visual match with the board is from the computed styles, not from a live smoke.

### Notes for the lead
- The board's on-track gradient is `#ffffff → #d4d4d4` (no border), so I used a local `SWITCH_ON` style rather than `KEY_LIGHT` (`#ffffff → #d9d9d9` with a border); the off track uses `KEY_DARK` as the spec says.
- The ref that de-duplicates the submit/end commit is local and changes nothing in the protocol.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `7d60643f2`.
- **The emulator check:** `pnpm phone:smoke` passed on `dev/blocks`, and I scrolled to the end of the catalog. Both alert examples match `PhoneChoices.dc.html:146-163`:
  - the bell and the title;
  - the well;
  - the 50×30 switch: white with a dark knob at the right when on, dark with a grey knob at the left when off;
  - the note line and the time.
- **The well text is dim in the catalog** because there is no responder there, so the controls are disabled.
- **The pre-review's F1** (the server answered 400) is already fixed by T-1848, merged before this.
