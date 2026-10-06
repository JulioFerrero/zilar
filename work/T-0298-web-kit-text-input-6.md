---
id: T-0298
title: "Web kit migration 18: Explore search, sticker pack search and task-strip link fields use the kit TextInput"
status: merged
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

### What I did
- `apps/web/src/components/ExplorePage.tsx`: imported the kit `TextInput` and replaced the search `<input>` with `<TextInput ref={searchRef} value maxLength={100} placeholder aria-label onChange className="mt-3">`. Renders as the bare `<input>` (no label/hint/counter), so the Dialog `initialFocusRef` still focuses it. The radio inputs stay raw.
- `apps/web/src/routes/StickersPage.tsx`: imported `TextInput` and replaced the discover search `<input>` with `<TextInput … className="min-w-0 flex-1">`, keeping `value`, `aria-label`, `placeholder`, `maxLength={60}` and `onChange`.
- `apps/web/src/components/TaskStrip.tsx`: imported `TextInput` and replaced both link-popover inputs with `<TextInput … className="rounded-[8px] px-2.5 py-1.5 text-[13px]">`, keeping the wrapping labels, `value`/`onChange`, `placeholder`, `inputMode="url"` and `maxLength={40}`.
- Tests: one `well-surface` assertion per test file (Explore search, Stickers discover search, TaskStrip URL field), plus a new Explore test that the search input has `well-surface` and receives initial focus (`document.activeElement`).

### Files changed
- `apps/web/src/components/ExplorePage.tsx`
- `apps/web/src/components/ExplorePage.test.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/routes/StickersPage.test.tsx`
- `apps/web/src/components/TaskStrip.tsx`
- `apps/web/src/components/TaskStrip.test.tsx`
- `work/T-0298-web-kit-text-input-6.md` (status/Report)

### Commands and real results
- `pnpm install` → Done, exit 0 (peer-dependency warnings only, pre-existing).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ExplorePage StickersPage TaskStrip` → `Test Files 3 passed (3)`, `Tests 27 passed (27)`, exit 0.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (12.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.8s)
  PASS  tests @zilar/web  (18.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- No raw text `<input>` left in the three files: `grep -n "<input"` finds only the radio input at `ExplorePage.tsx:180`.
- Focus, texts and behaviour unchanged (27 focused tests pass, including the new initial-focus test).
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Problems / deviations
- As in earlier batches, the kit supplies `well-surface`, `text-sm` and the accent focus ring instead of the old `border-input`/`text-[15px]` hand-rolled styling; accepted as the point of the migration. Layout classes kept per spec.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved.** The pre-review was clean (0 nits) and there were no fix rounds (Muse).
- The four inputs are on `TextInput`. The only raw input left is the Explore kind radio.
- The test for Explore's initial focus was added.

The plain-field web batches are now done. What is still hand-rolled is deliberate:
- `SearchBar`, `GifPanel` and `FolderEditorDialog` (custom search fields);
- `Composer` and `OtpInput`;
- file, radio and checkbox inputs.
