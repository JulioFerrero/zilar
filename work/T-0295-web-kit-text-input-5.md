---
id: T-0295
title: "Web kit migration 17: sticker pack, machine rename and model picker fields use the kit TextInput"
status: todo
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

## Review (written by Claude)
