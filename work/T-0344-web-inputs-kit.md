---
id: T-0344
title: "Web kit migration: the Telegram import link field and the Group roles name fields use the kit TextInput"
status: todo
milestone: M5
branch: task/T-0344-web-inputs-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0344: three raw inputs on TextInput

## Spec (written by Claude, do not edit)

### Why
Three plain text fields still hand-roll their input styling instead of the kit `TextInput` (`well-surface`):
- The Telegram import link field still uses the old `border border-input bg-background` look, so it does not match the kit fields in the other dialogs.
- The two Group roles fields copy the `well-surface` classes by hand.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/text-input.tsx`:**
  - `TextInput` takes `ComponentProps<'input'>` plus `label?`, `hint?`, `invalid?` and `counter?`;
  - it spreads the rest of the props onto the `<input>` (React 19, so `ref` passes through as a prop);
  - its classes are `well-surface w-full rounded-lg px-3 py-2 text-sm …`, merged with `className` through `cn`;
  - without `label`, `hint` or `counter` it returns the bare `<input>`; with a `label` it renders `<label htmlFor>` plus the input.
- **The three inputs:**
  1. **`apps/web/src/components/TelegramImportDialog.tsx:263-275`:**
     - a `<label className="mt-3 flex flex-col gap-1 text-[14px]">Pack link or name<input …/></label>`;
     - the input has `ref={inputRef}`, `value={input}`, `aria-label="Pack link or name"`, `placeholder="t.me/addstickers/FunCats"`, `maxLength={512}`, `disabled={busy}` and `onChange`;
     - its classes are `rounded-lg border border-input bg-background px-3 py-2 text-[15px] … disabled:opacity-60`.
  2. **`apps/web/src/components/GroupPanel.tsx:703-709`:** the role rename input, with `aria-label={`Rename ${role.name}`}`, `value={renameValue}`, `maxLength={30}`, `onChange`, and `className="well-surface min-w-0 flex-1 rounded-[10px] px-3 py-1.5 text-[14px] …"`.
  3. **`apps/web/src/components/GroupPanel.tsx:830-837`:** the new role input, with `aria-label="New role name"`, `value={newName}`, `maxLength={30}`, `onChange`, `placeholder="e.g. Designers"`, and `className="well-surface min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[14px] …"`.
- **Tests:**
  - `apps/web/src/components/TelegramImportDialog.test.tsx` queries `getByLabelText('Pack link or name')` (lines 34, 58, 74);
  - the GroupPanel tests query the role inputs by their aria-labels.

### What to build
1. **TelegramImportDialog:** replace the `<label>` wrapper and the `<input>` with `<TextInput label="Pack link or name" ref={inputRef} …same props… />`.
   - Drop the `aria-label`: the visible label names it.
   - Keep the `mt-3` spacing on a wrapper `div` if needed.
   - `getByLabelText('Pack link or name')` must still find exactly one element.
2. **GroupPanel:** both role inputs become `<TextInput aria-label=… className="min-w-0 flex-1" …same props… />`, with no label. Keep their `py-1.5` and `py-2` only if needed for row height; otherwise use the kit default.
3. Do not change the search fields (FolderEditorDialog, GifPanel, SearchBar). They use a different, search-specific style.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/TelegramImportDialog.tsx:250-290`, `apps/web/src/components/GroupPanel.tsx:690-720` and `:820-850`, and their tests (`grep -rl "GroupPanel\|TelegramImportDialog" apps/web/src --include=*.test.tsx`).

### Allowed files
`apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/Channels.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `work/T-0344-web-inputs-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot TelegramImportDialog GroupPanel
pnpm gate
```

### Acceptance
- The three inputs render through `TextInput`.
- No `border-input bg-background` input remains in `TelegramImportDialog.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
