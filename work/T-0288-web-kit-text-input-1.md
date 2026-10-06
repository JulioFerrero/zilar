---
id: T-0288
title: "Web kit migration 13: name, username and add-contact text fields use the kit TextInput"
status: todo
milestone: M5
branch: task/T-0288-web-kit-text-input-1
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0288: kit TextInput, batch 1

## Spec (written by Claude, do not edit)

### Why
The kit `TextInput` (`apps/web/src/components/ui/text-input.tsx`) exists, but no screen uses it yet. 29 files outside the kit still hand-roll `<input>`. This batch moves the four simplest single text fields, which all share one pattern.

### Verified facts (do not re-derive)
- **`TextInput`** (`ui/text-input.tsx`):
  - it takes all `<input>` props plus `label?`, `hint?`, `invalid?` and `counter?`;
  - it renders a `Field`: a `flex flex-col gap-1.5` wrapper with a `<label htmlFor={id}>` (`text-[14px] font-medium`) when `label` is set, the input, then the hint;
  - it uses the given `id`, or else a `useId()`;
  - the input class is `well-surface w-full rounded-lg px-3 py-2 text-sm …`;
  - `className` goes to the `<input>`, not the wrapper;
  - `well-surface` (`apps/web/src/index.css:249`) has a `:focus-within` outline.
- **Hand-rolled pattern today:**
  - `<label className="… block text-[14px] font-medium" htmlFor="X">Text</label>`;
  - then `<input id="X" … className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40" />`.
- **Instances:**
  - `apps/web/src/routes/NamePage.tsx:49-60`: label "Name", id `auth-name`, `autoFocus`, `maxLength={64}`;
  - `apps/web/src/routes/HandlePage.tsx:113-131`: label "Username", id `auth-handle`;
  - `apps/web/src/components/AddContactDialog.tsx:92-107`: label "Username", id `add-contact-handle`;
  - `apps/web/src/components/ProfileSettingsSection.tsx:128-145`: label "Your @username", id `profile-handle`.
  - Each file has a `*.test.tsx` next to it.

### What to build
1. Each of the four label + input pairs becomes one `<TextInput id="…" label="…" … />`:
   - keep the same `id`, `value`, `onChange`, `autoFocus`, `maxLength`, `autoCapitalize`, `autoCorrect`, `spellCheck` and `placeholder`;
   - delete the hand-rolled `<label>` and the input's style classes;
   - the old label's top margin (`mt-6` / `mt-4`) moves to a wrapping `<div>` so the spacing stays;
   - error and hint lines after the field stay as they are. Do not move them into `hint`.
2. Tests:
   - existing tests keep passing. They should find the fields by label, which the kit keeps;
   - add one assertion per file that the field has the `well-surface` class.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/text-input.fixture.tsx`, and the four files with their tests.

### Allowed files
`apps/web/src/routes/NamePage.tsx`, `apps/web/src/routes/NamePage.test.tsx`, `apps/web/src/routes/HandlePage.tsx`, `apps/web/src/routes/HandlePage.test.tsx`, `apps/web/src/components/AddContactDialog.tsx`, `apps/web/src/components/AddContactDialog.test.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ProfileSettingsSection.test.tsx`, `work/T-0288-web-kit-text-input-1.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NamePage HandlePage AddContactDialog ProfileSettingsSection
pnpm gate
```

### Acceptance
- None of the four files renders a raw `<input>` or `<label>` for these fields. Ids, texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Every other `<input>`, including checkboxes, radios, file inputs, the composer and search.

---

## Report (written by the worker when done)

## Review (written by Claude)
