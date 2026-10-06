---
id: T-0295
title: "Web kit migration 17: sticker pack, machine rename and model picker fields use the kit TextInput"
status: merged
milestone: M5
branch: task/T-0295-web-kit-text-input-5
model: auto
effort: low
depends_on: [T-0293]
estimate: 0.2 day
---

# T-0295: kit TextInput, batch 5

## Spec (written by Claude, do not edit)

### Why
This is batch 5 of moving hand-rolled text fields onto the kit `TextInput` (`apps/web/src/components/ui/text-input.tsx`). Read the T-0291 to T-0293 Reports first.

Since T-0292, a `TextInput` with no `label`, `hint` or `counter` renders as the bare `<input>`. React 19 (`apps/web/package.json:26`) passes `ref` as a normal prop, so the kit's `{...props}` spread forwards it to the `<input>`. Check that in a test.

### Verified facts (do not re-derive)
- **`apps/web/src/components/PackEditor.tsx`:**
  - line 421: "Pack name" input in a wrapping `<label className="flex flex-col gap-1"><span>Pack name</span>…`, with `maxLength={60}` and `disabled={busy}`;
  - line 570: the per-sticker emoji input in a wrapping label, `aria-label={`Emoji for ${item.name}`}`, compact class `w-14 rounded-md … px-2 py-1 text-[15px]`. It adds `border-danger` when `item.emoji !== '' && !isEmojiLike(item.emoji)`.
  - Test: `apps/web/src/components/PackEditor.test.tsx`.
- **`apps/web/src/components/machines/ApprovedMachineCard.tsx`** line 89: the inline rename input:
  - `ref={inputRef}`, `aria-label={`Rename ${machine.name}`}`, `maxLength={64}`;
  - Enter commits, Escape cancels, blur commits;
  - class `w-full rounded-md … px-2 py-1 text-[16px] font-semibold`.
  - Test: `apps/web/src/routes/MachinesPage.test.tsx`; the rename tests are around line 318.
- **`apps/web/src/components/ais/ModelPicker.tsx`** line 55: `id={inputId}` input in a wrapping label "Model", already `well-surface rounded-lg px-3 py-2 text-[15px]`. Test: `apps/web/src/components/ais/ModelPicker.test.tsx`.

### What to build
1. Replace each of the four `<input>` elements with `<TextInput …>`:
   - keep the wrapping labels;
   - keep `ref`, `id`, `aria-label`, `value`, handlers, `onKeyDown`, `onBlur`, `maxLength`, `placeholder` and `disabled`.
2. **Emoji field:**
   - pass `invalid={item.emoji !== '' && !isEmojiLike(item.emoji)}` instead of the hand-added `border-danger`;
   - keep the compact size with `className="w-14 px-2 py-1"`.
3. **Rename field:** keep `className="px-2 py-1 text-[16px] font-semibold"` so the card header does not jump in height.
4. **Tests:**
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `well-surface` assertion per test file;
   - add one test that the rename field still receives focus through its `ref` when editing starts.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `work/T-0293-web-kit-text-input-4.md` (Report), the three files and their tests.

### Allowed files
`apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/PackEditor.test.tsx`, `apps/web/src/components/machines/ApprovedMachineCard.tsx`, `apps/web/src/routes/MachinesPage.test.tsx`, `apps/web/src/components/ais/ModelPicker.tsx`, `apps/web/src/components/ais/ModelPicker.test.tsx`, `work/T-0295-web-kit-text-input-5.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PackEditor MachinesPage ModelPicker
pnpm gate
```

### Acceptance
- None of the three files has a raw text `<input>` left. The file and radio inputs in `PackEditor` stay.
- Behaviour is unchanged: rename with Enter, Escape and blur; the emoji validation.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/PackEditor.tsx`: imported the kit `TextInput`.
  - "Pack name" `<input>` became a bare `<TextInput value maxLength={60} placeholder="My stickers" disabled={busy} onChange>` — it renders as the bare `<input>` because no `label`/`hint`/`counter` is passed, so it still sits inside the existing wrapping `<label>`.
  - The per-sticker emoji `<input>` became `<TextInput … invalid={item.emoji !== '' && !isEmojiLike(item.emoji)} className="w-14 px-2 py-1" />`. Kept `value`, `maxLength={8}`, `placeholder`, `disabled`, `aria-label` and the `setEmoji` handler; the hand-added `border-danger`/`cn` class string is gone. `tailwind-merge` drops the kit `w-full`, `px-3 py-2` and keeps the compact size.
  - The radio inputs (visibility) and the hidden file input stay raw `<input>`.
- `apps/web/src/components/machines/ApprovedMachineCard.tsx`: imported `TextInput` and replaced the inline rename `<input>` with `<TextInput ref={inputRef} … className="px-2 py-1 text-[16px] font-semibold" />`. Kept `aria-label`, `value={draft}`, `maxLength={64}`, the `onChange`/`onKeyDown` (Enter commits, Escape cancels)/`onBlur` handlers, and the `w-full` comes from the kit class so the header height is unchanged.
- `apps/web/src/components/ais/ModelPicker.tsx`: imported `TextInput` and replaced the "Model" `<input>` with `<TextInput id={inputId} … />`, keeping the wrapping `<label>`, the `providerLabel` placeholder, `maxLength={256}`, `autoComplete="off"` and the `onChange`.
- Tests:
  - `PackEditor.test.tsx`: one `well-surface` assertion on the pack-name input (the test that creates the pack).
  - `ModelPicker.test.tsx`: one `well-surface` assertion on the "Model" input.
  - `MachinesPage.test.tsx`: one `well-surface` assertion on the rename input in the existing rename test, plus a new test that the rename input receives focus through its `ref` when editing starts (`document.activeElement` is the input).
- Behaviour unchanged: no assertion needed changing beyond the added ones; the `ref`-forwarding works because React 19 passes `ref` in `ComponentProps<'input'>` and the kit spreads it onto the `<input>` (verified by the new focus test and by typecheck).

### Files changed
- `apps/web/src/components/PackEditor.tsx`
- `apps/web/src/components/PackEditor.test.tsx`
- `apps/web/src/components/machines/ApprovedMachineCard.tsx`
- `apps/web/src/routes/MachinesPage.test.tsx`
- `apps/web/src/components/ais/ModelPicker.tsx`
- `apps/web/src/components/ais/ModelPicker.test.tsx`
- `work/T-0295-web-kit-text-input-5.md` (status/Report)

### Commands and real results
- `pnpm install` → Done, exit 0 (peer-dependency warnings only, pre-existing).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PackEditor MachinesPage ModelPicker` → `Test Files 3 passed (3)`, `Tests 39 passed (39)`, exit 0.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (7.3s)
  PASS  tests @zilar/web  (17.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- No raw text `<input>` is left in the three source files: `grep -n "<input"` finds only the two radio inputs (lines 434, 443) and the hidden file input (line 490) in `PackEditor.tsx`; `ApprovedMachineCard.tsx` and `ModelPicker.tsx` have none.
- Behaviour unchanged: rename with Enter, Escape and blur; the emoji validation now uses the kit `invalid` prop (same condition). The 39 focused tests pass.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Problems / deviations
- As in the earlier batches, the kit supplies `well-surface`, `text-sm` and the accent focus ring instead of the old `text-[15px]` / `border-input` hand-rolled styling; accepted as the point of the migration. The emoji field keeps its compact size (`w-14 px-2 py-1`) and the rename field keeps `text-[16px] font-semibold`, so the card header does not jump.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved.** Clean pre-review with 0 nits and no fix rounds.
- The four fields now use `TextInput`. The only raw inputs left in `PackEditor` are the radio and file inputs.
- The emoji field uses the kit `invalid` prop.
- The rename field keeps its focus through `ref`, now covered by a new test.
