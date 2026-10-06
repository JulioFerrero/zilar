---
id: T-0385
title: "Web kit: the hover \"Chat actions\" and \"Message actions\" buttons and the attachment Remove use the kit Button"
status: merged
milestone: M5
branch: task/T-0385-web-hover-action-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0385: hover action icon buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The "…" buttons that appear on hover over chat rows and message bubbles are hand-rolled icon buttons, and so is the composer's attachment Remove.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - `ghost` is `hover:bg-surface-raised hover:text-foreground` plus the kit focus ring;
  - sizes `icon-sm` (size-7 rounded-md), `icon` (size-8) and `icon-lg` (size-9);
  - `cn` (tailwind-merge) lets a caller `className` override `size-*` and `rounded-*`;
  - it takes `React.ComponentProps<'button'>` on React 19, so `ref` passes through.
- **`apps/web/src/components/ChatListItem.tsx:151`** and **`apps/web/src/components/TopicRow.tsx:146`:**
  - both are `<button type="button" aria-label={`Chat actions for ${chat.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((value) => !value); }} className="shrink-0 rounded-md p-1 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none">` with `<MoreHorizontal className="size-4" aria-hidden="true" />`;
  - TopicRow imports `Button` (line 17), and ChatListItem does not.
- **`apps/web/src/components/MessageBubble.tsx:373`** and **`:680`:**
  - both are `<button ref={menuButtonRef} type="button" aria-label="Message actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="absolute top-0.5 right-0.5 z-10 flex size-6 items-center justify-center rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100">` with a `MoreHorizontal` icon;
  - the file does not import `Button`.
- **`apps/web/src/components/AttachmentPreview.tsx`:**
  - the `<button>` that ends at line 40 has `aria-label="Remove attachment"`, `onClick={onCancel}`, `className="flex size-9 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-surface-raised"` and `<X className="size-4" />`;
  - line 1 imports lucide, and there is no `Button` import.
- **Leave alone in MessageBubble:** the inline underlined Retry and Delete text links (lines 75, 83, 362, 516 and 570).
- **Tests:**
  - `apps/web/src/components/ChatListItem.test.tsx`;
  - `apps/web/src/components/MessageList.test.tsx`;
  - `apps/web/src/components/AttachmentPreview.test.tsx`;
  - `apps/web/src/components/ChatList.test.tsx`.

  They may query these buttons by name, check `aria-expanded`, or rely on `stopPropagation`. Keep every attribute and handler.

### What to build
1. **The two "Chat actions" buttons** → `<Button type="button" variant="ghost" size="icon-sm" … className="size-6 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">`, keeping all aria props, the `onClick` and the icon.
2. **The two "Message actions" buttons** → `<Button ref={menuButtonRef} type="button" variant="ghost" size="icon-sm" … className="absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100">`.
3. **Remove attachment** → `<Button type="button" variant="ghost" size="icon-lg" aria-label="Remove attachment" onClick={onCancel} className="shrink-0 rounded-[8px] text-muted-foreground">`.
4. Import `Button` from `@/components/ui/button` where it is missing.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ChatListItem.tsx:140-165`, `apps/web/src/components/TopicRow.tsx:140-160`, `apps/web/src/components/MessageBubble.tsx:370-385` and `:677-692`, and `apps/web/src/components/AttachmentPreview.tsx`.

### Allowed files
`apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/AttachmentPreview.tsx`, `apps/web/src/components/ChatListItem.test.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/components/AttachmentPreview.test.tsx`, `apps/web/src/components/ChatList.test.tsx`, `work/T-0385-web-hover-action-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatListItem MessageList AttachmentPreview ChatList
pnpm gate
```

### Acceptance
- The five buttons are kit `Button`s.
- No hand-rolled `<button` remains in `ChatListItem.tsx` or `AttachmentPreview.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Converted the 5 hand-rolled icon buttons to kit `Button` (`variant="ghost"`), keeping all aria props, handlers (incl. `stopPropagation` on chat actions, `menuButtonRef` on message actions), and icons:
  - `ChatListItem.tsx`: chat-actions button → `size="icon-sm"`, class `size-6 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`; added `Button` import.
  - `TopicRow.tsx`: same conversion (Button already imported).
  - `MessageBubble.tsx` (2 buttons): → `size="icon-sm"`, class `absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100`; added `Button` import. Left Retry/Delete text links untouched.
  - `AttachmentPreview.tsx`: Remove → `size="icon-lg"`, class `shrink-0 rounded-[8px] text-muted-foreground`; added `Button` import.
- Files changed: `apps/web/src/components/ChatListItem.tsx`, `TopicRow.tsx`, `MessageBubble.tsx`, `AttachmentPreview.tsx` (+ this task file).
- Commands:
  - `pnpm install`: pass.
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatListItem MessageList AttachmentPreview ChatList`: 5 files, 64 tests passed.
  - `pnpm gate`: GATE PASS — install/lint/format/typecheck/tests pass; scope: every changed file inside Allowed files (5 changed files).
- Security checklist: no secrets, no permission/data-scope changes (pure UI button swap); N/A for deletes/caps/audit/401/rate-limit.
- No deviations, no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). The two Chat actions, two Message actions (ref kept) and the attachment Remove are kit ghost icon `Button`s with the hover/opacity classes kept. The one nit (import path `./ui/button` vs the spec's `@/…`) matches the neighbouring files, so no change. Pre-review clean otherwise.
