---
id: T-0357
title: "Web kit: SearchField (well input with a search icon); GIF, folder editor, Explore and sticker discover searches use it"
status: todo
milestone: M5
branch: task/T-0357-web-kit-search-field
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0357: web kit SearchField

## Spec (written by Claude, do not edit)

### Why
Mobile has a kit `SearchField` (T-0308), but web does not. Four web searches look different from one another:
- two raw `<input>`s with their own styles;
- two plain `TextInput`s with no search icon.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/text-input.tsx`:**
  - `TextInput` takes `ComponentProps<'input'>` plus `label?`, `hint?`, `invalid?` and `counter?`;
  - its field class is `FIELD_INPUT` = `'well-surface w-full rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground disabled:pointer-events-none disabled:opacity-50'`;
  - without `label`, `hint` or `counter` it returns the bare `<input>`.
- **`apps/web/src/components/ui/*.fixture.tsx`:** one fixture file per kit component, a default export of named JSX states (see `text-input.fixture.tsx`). `fixtures.test.tsx` globs them.
- **The four search fields:**
  1. **`apps/web/src/components/GifPanel.tsx:282-289`:** a raw `<input type="search">` with `value={query}`, `onChange`, `placeholder="Search GIFs"`, `aria-label="Search GIFs"` and its own `rounded-[8px] bg-surface-raised … text-[13px]` style.
  2. **`apps/web/src/components/FolderEditorDialog.tsx:342-357`:**
     - an sr-only `<label htmlFor={searchId}>`, then an absolutely placed lucide `Search` icon;
     - then a raw `<input id={searchId} type="text" …>` with `rounded-xl border border-border bg-surface-raised py-2 pr-3 pl-9 text-[15px]`.
  3. **`apps/web/src/components/ExplorePage.tsx:160-168`:** `<TextInput ref={searchRef} value={query} maxLength={100} … placeholder="Search by name or @handle" aria-label="Search public groups and channels" className="mt-3" />`.
  4. **`apps/web/src/routes/StickersPage.tsx:536-543`:** `<TextInput value={query} aria-label="Search sticker packs" placeholder="Search shared packs" maxLength={60} … className="min-w-0 flex-1" />`, inside a form with a Search `Button`.
- **Tests that render them:**
  - `apps/web/src/components/GifPanel.test.tsx`;
  - `apps/web/src/components/FolderEditorDialog.test.tsx`;
  - `apps/web/src/components/ExplorePage.test.tsx`;
  - `apps/web/src/routes/StickersPage.test.tsx`;
  - `apps/web/src/components/StickerPanel.test.tsx`, which embeds the GIF panel.

### What to build
1. **New `apps/web/src/components/ui/search-field.tsx`:** `SearchField` takes `ComponentProps<'input'>` (forward `ref` as a prop, React 19) and renders:
   - a relative wrapper `div`, which takes `className` for layout;
   - an absolutely placed lucide `Search` icon (`size-4`, `text-subtle-foreground`, `aria-hidden`) on the left;
   - an `<input type="search">` with the `well-surface` field look of `FIELD_INPUT` plus left padding for the icon (`pl-9`).

   Export it. Add `apps/web/src/components/ui/search-field.fixture.tsx` (Default, WithValue, Disabled). Add a `kit.test.tsx` case: it renders `type="search"`, keeps the `aria-label`, and puts `className` on the wrapper.
2. **Migrate the four fields to `SearchField`.** Keep every `value`, `onChange`, `placeholder`, `aria-label`, `maxLength`, `ref`, `id` and layout class.
   - In FolderEditorDialog, keep the sr-only `<label htmlFor>` (pass `id`) and remove the hand-placed icon.
3. Tests: update only queries that relied on the old element, for example a `type="text"` query. Keep the assertions.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/text-input.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, the four call sites and their tests.

### Allowed files
`apps/web/src/components/ui/search-field.tsx`, `apps/web/src/components/ui/search-field.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/GifPanel.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/ExplorePage.tsx`, `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/components/GifPanel.test.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx`, `work/T-0357-web-kit-search-field.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit GifPanel FolderEditorDialog ExplorePage StickersPage StickerPanel
pnpm gate
```

### Acceptance
- `SearchField` exists, with a fixture and a kit test.
- The four fields use it.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
