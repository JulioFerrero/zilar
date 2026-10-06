---
id: T-0327
title: "Web kit: Stickers page pack actions on Button, glyph arrows and star become icons"
status: merged
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

- Move up/down are now `<Button type="button" variant="ghost" size="icon-sm">` with `<ChevronUp />` / `<ChevronDown />` (lucide, `aria-hidden="true"`); aria-label, title, disabled and onClick kept.
- Share/Make private, Edit, Remove from panel are now `<Button type="button" variant="outline" size="sm">`; handlers, disabled and title kept.
- Delete is now `<Button type="button" variant="destructive" size="sm">`.
- Unfavorite keeps its raw button and positioning classes; the `★` glyph is now `<Star className="size-3 fill-current" aria-hidden="true" />`.
- Texts and handlers unchanged. `StickersPage.test.tsx` untouched.
- Files changed: `apps/web/src/routes/StickersPage.tsx`, `work/T-0327-web-stickers-buttons.md`.
- Checks: `pnpm install` ok (12.4s); `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickersPage`: 1 file, 12 tests passed, test file unchanged. `pnpm gate`: PASS install (1.5s), format (17.2s), lint (1.5s), typecheck (11.9s), tests @zilar/web (30.4s); scope ok; GATE PASS.
- Acceptance: verified via grep — no `↑`, `↓`, `★` remain in StickersPage.tsx; only one raw `<button` left (Unfavorite, line 614).
- Security checklist: UI-only change, no secrets/routes/permissions/caps/audit touched; N/A.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The pack actions on the Stickers page are kit Buttons:
- move up and down are ghost `icon-sm` buttons with ChevronUp and ChevronDown;
- Share / Make private, Edit and Remove from panel are `outline sm`;
- Delete is `destructive sm`;
- Unfavorite keeps its round button, with a filled `Star` icon.

No `↑`, `↓` or `★` glyphs are left in the file.
- **Lead note:** the kit Button has `disabled:pointer-events-none`, so on an imported pack the disabled Share button no longer shows its hover title ("Imported packs stay private for personal use"). This is minor and stays on the polish list.
