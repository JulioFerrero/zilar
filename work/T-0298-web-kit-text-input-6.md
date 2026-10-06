---
id: T-0298
title: "Web kit migration 18: Explore search, sticker pack search and task-strip link fields use the kit TextInput"
status: todo
milestone: M5
branch: task/T-0298-web-kit-text-input-6
model: auto
effort: low
depends_on: [T-0295]
estimate: 0.2 day
---

# T-0298: kit TextInput, batch 6

## Spec (written by Claude, do not edit)

### Why
This is batch 6 of moving hand-rolled text fields onto the kit `TextInput` (`apps/web/src/components/ui/text-input.tsx`). It is the last batch of ordinary fields. Read the T-0293 and T-0295 Reports first.

A `TextInput` with no `label`, `hint` or `counter` renders the bare `<input>`, and `ref` passes through. `className` is merged with tailwind-merge, so a caller's size classes replace the kit's.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ExplorePage.tsx` lines 153-161:** search input.
  - `ref={searchRef}`, which is the Dialog's `initialFocusRef` since T-0274;
  - `aria-label="Search public groups and channels"`, `maxLength={100}`;
  - class `mt-3 w-full rounded-lg border …`.
  - The radio inputs at line 179 stay as they are.
- **`apps/web/src/routes/StickersPage.tsx` lines 514-521:** search input in a form row next to a `size="lg"` submit `Button`.
  - `aria-label="Search sticker packs"`, `maxLength={60}`, class `min-w-0 flex-1 …`.
- **`apps/web/src/components/TaskStrip.tsx` lines 410-425:** two compact inputs in the link popover, inside wrapping labels.
  - Class `well-surface rounded-[8px] px-2.5 py-1.5 text-[13px] …`;
  - "URL (https only)" with `inputMode="url"`;
  - "Label (optional)" with `maxLength={40}`.
- **Tests:** `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `apps/web/src/components/TaskStrip.test.tsx`.

### What to build
1. Each of the four inputs becomes `<TextInput …>`:
   - keep `ref`, `value`, handlers, `aria-label`, `maxLength`, `placeholder` and `inputMode`;
   - keep layout classes only: `mt-3` on Explore, `min-w-0 flex-1` on Stickers;
   - the TaskStrip pair keeps its compact size with `className="rounded-[8px] px-2.5 py-1.5 text-[13px]"`.
2. Tests:
   - existing tests keep passing;
   - add one `well-surface` assertion per test file;
   - Explore's search still gets the initial focus. An existing test may cover this; if not, add one.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `work/T-0295-web-kit-text-input-5.md` (Report), the three files and their tests.

### Allowed files
`apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/TaskStrip.test.tsx`, `work/T-0298-web-kit-text-input-6.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ExplorePage StickersPage TaskStrip
pnpm gate
```

### Acceptance
- No raw text `<input>` is left in the three files; the radios stay.
- Focus, texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`SearchBar`, `GifPanel`, `FolderEditorDialog` (custom search fields with icons), `Composer`, `OtpInput`, and file inputs.

---

## Report (written by the worker when done)

## Review (written by Claude)
