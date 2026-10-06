---
id: T-0327
title: "Web kit: Stickers page pack actions on Button, glyph arrows and star become icons"
status: todo
milestone: M5
branch: task/T-0327-web-stickers-buttons
model: auto
effort: low
depends_on: [T-0325]
estimate: 0.2 day
---

# T-0327: Stickers page pack actions

## Spec (written by Claude, do not edit)

### Why
T-0325 moved the Stickers page states and its first two pill buttons to the kit. Seven raw buttons are left in the same file, and three of them draw text glyphs (↑, ↓, ★) where the app uses icons: Julio wants icons, never emoji or glyph characters. Read the T-0325 Report first.

### Verified facts (do not re-derive)
- **`Button`** (`apps/web/src/components/ui/button.tsx:14-32`):
  - variants `default`, `outline`, `secondary`, `ghost`, `destructive` (`bg-danger/10 text-danger hover:bg-danger/20`) and `link`;
  - sizes `default`, `sm`, `lg`, `icon`, `icon-sm` (`size-7 rounded-md`) and `icon-lg`.
- **Raw buttons in `apps/web/src/routes/StickersPage.tsx`:**
  - lines 403-412 and 413-422: move up and move down;
    - each has `aria-label` and `title` `Move ${pack.title} up/down` and `disabled={movingPackId !== undefined}`;
    - `onClick` calls `movePack(pack.id, ∓1)`;
    - the label is the glyph `↑` or `↓`;
  - lines 423-435: Share or Make private, `toggleVisibility(pack)`, disabled for imported packs with a `title` explaining why, outline pill styling;
  - line 436 on: Edit (`setEditingPackId`), outline pill;
  - line 443 on: Remove from panel (`removePack`), outline pill;
  - line 450 on: Delete (`setDeletingPack`), a danger pill (`border-danger/40 bg-danger/10 text-danger`);
  - line 607 on: Unfavorite, a small absolute round button (`absolute top-0.5 right-0.5 flex size-5 … rounded-full border border-edge bg-black/70 … text-white`) whose label is the glyph `★`, with `aria-label` and `title` `Unfavorite …`.
- `apps/web/src/routes/StickersPage.test.tsx` does not mock `lucide-react` and does not query the glyphs. It must pass unchanged.

### What to build
1. **Move up and down:** `<Button type="button" variant="ghost" size="icon-sm" …>` with `<ChevronUp />` / `<ChevronDown />` from lucide (`aria-hidden="true"`). Keep `aria-label`, `title`, `disabled` and `onClick`.
2. **Share / Make private, Edit, Remove from panel:** `<Button type="button" variant="outline" size="sm" …>`, keeping handlers, `disabled` and `title`.
3. **Delete:** `<Button type="button" variant="destructive" size="sm" …>`.
4. **Unfavorite:** keep the raw button and its positioning classes. Replace the `★` glyph with `<Star className="size-3 fill-current" aria-hidden="true" />`.
5. Texts and handlers stay the same.

### Read first
`AGENTS.md`, `work/T-0325-web-stickers-kit.md` (Report), `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/StickersPage.tsx:395-460` and `:600-620`.

### Allowed files
`apps/web/src/routes/StickersPage.tsx`, `work/T-0327-web-stickers-buttons.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickersPage
pnpm gate
```

### Acceptance
- The characters `↑`, `↓` and `★` no longer appear in `StickersPage.tsx`.
- The only raw `<button` left in the file is Unfavorite.
- `StickersPage.test.tsx` passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
