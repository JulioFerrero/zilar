---
id: T-0375
title: "Web: the \"+\" glyphs on New topic and Create sticker pack become Plus icons; New topic, Manage stickers and folder Edit/Create use the kit Button"
status: merged
milestone: M5
branch: task/T-0375-web-plus-glyphs-icons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0375: Plus icons instead of "+" glyphs, plus kit buttons

## Spec (written by Claude, do not edit)

### Why
Julio wants icons, not glyphs, in the app. Two buttons still render a text "+".

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - `ghost` is `hover:bg-surface-raised hover:text-foreground`;
  - sizes include `sm` (h-7), `icon` (size-8) and `icon-sm` (size-7 rounded-md);
  - `cn` merges a caller `className`.
- **`apps/web/src/components/TopicRow.tsx`:**
  - `GroupHeaderRow` (line 174), line 270: a `<button>` with `aria-label`/`title` "New topic in …", `onClick={onOpenNewTopic}`, `className="flex size-7 … rounded-full text-[18px] … text-muted-foreground hover:bg-surface-raised …"`, and the text `+`.
  - Line 2 imports lucide icons, not `Plus`. The file does not import `Button`.
- **`apps/web/src/components/StickerPanel.tsx`:**
  - line 462: `role="tab"`, `aria-label`/`title` "Create sticker pack", text `+`;
  - line 561: "Manage stickers" (`onManage`, `w-full rounded-[8px] px-3 py-1.5 text-center text-[13px] text-muted-foreground hover:bg-surface-raised hover:text-foreground`);
  - line 2 imports only `Star` from lucide.
- **`apps/web/src/routes/FoldersPage.tsx`** (no `Button` import):
  - line 170: `Pencil` icon, `aria-label` "Edit …", `rounded-full p-2 text-muted-foreground hover:bg-list-hover`;
  - line 186: `Plus` icon + "Create new folder", a dashed `rounded-xl border border-dashed` box.
- **Tests:**
  - `apps/web/src/components/StickerPanel.test.tsx:565` checks the tab by role `tab` and name "Create sticker pack", and "Manage stickers" by role `button`;
  - `apps/web/src/components/ChatList.test.tsx` and `apps/web/src/components/TopicPanel.test.tsx` render `TopicRow`;
  - `apps/web/src/routes/FoldersPage.test.tsx`.

### What to build
1. **TopicRow New topic** → `<Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-full text-muted-foreground" …>`, with `<Plus className="size-4" aria-hidden="true" />` in place of `+`. Keep `aria-label`, `title` and `onClick`.
2. **StickerPanel Create sticker pack:** keep the raw `<button role="tab">` (a tab, not a kit button). Replace the `+` text with `<Plus className="size-3.5" aria-hidden="true" />`.
3. **StickerPanel Manage stickers** → `<Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground">`.
4. **FoldersPage:**
   - Edit → `<Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground">`, with the Pencil kept.
   - Leave the reorder grip (line 140) and the dashed Create box as they are; the dashed box is a drop-zone look the kit has no variant for.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/TopicRow.tsx:170-300`, `apps/web/src/components/StickerPanel.tsx:455-570` and `apps/web/src/routes/FoldersPage.tsx:165-195`.

### Allowed files
`apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/StickerPanel.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/components/StickerPanel.test.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/components/TopicPanel.test.tsx`, `apps/web/src/routes/FoldersPage.test.tsx`, `work/T-0375-web-plus-glyphs-icons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel ChatList TopicPanel FoldersPage
pnpm gate
```

### Acceptance
- No `>+<` or a lone `+` text node remains in `TopicRow.tsx` or `StickerPanel.tsx`.
- The listed buttons are kit `Button`s.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- TopicRow GroupHeaderRow New-topic button is now kit `<Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full text-muted-foreground">` with `<Plus className="size-4">`; kept aria-label/title/onClick. Added `Plus` and `Button` imports.
- StickerPanel Create pack tab kept as raw `<button role="tab">`, `+` replaced with `<Plus className="size-3.5">`; Manage stickers is now kit `<Button variant="ghost" size="sm" className="w-full text-muted-foreground">`. Added `Plus` and `Button` imports.
- FoldersPage Edit button is now kit `<Button variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground">` with Pencil kept; reorder grip and dashed Create box untouched. Added `Button` import.
- Files changed: `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/StickerPanel.tsx`, `apps/web/src/routes/FoldersPage.tsx`.
- Commands:
  - `pnpm install`: pass (18.7s).
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel ChatList TopicPanel FoldersPage`: 6 files, 98 tests passed.
  - `pnpm gate`: GATE PASS — install PASS (3.1s), format PASS (57.0s), lint PASS (2.2s), typecheck PASS (27.7s), tests @zilar/web PASS (41.1s); scope clean (4 changed files, all inside Allowed files).
- Security checklist: no secrets/tokens touched; no deletes/updates, permissions, caps, routes, or audit entries involved — N/A.
- No deviations; no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). Both "+" glyphs are lucide `Plus` icons; New topic is kit ghost `icon-sm`, Manage stickers kit ghost `sm`, folder Edit kit ghost `icon`. The Create sticker pack tab stays a raw `role="tab"` button by design. Pre-review clean (0 findings).
