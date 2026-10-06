---
id: T-0402
title: "Web kit: Always-allowed loading, folder editor Remove chat, channel Mute and code block Show all use the kit"
status: todo
milestone: M5
branch: task/T-0402-web-small-leftovers-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0402: small web leftovers on the kit

## Spec (written by Claude, do not edit)

### Why
These are the last scattered hand-rolled pieces. The first was found by the T-0394 pre-review.

### Verified facts (do not re-derive)
- **Kit:**
  - `apps/web/src/components/ui/state-message.tsx`: `size="inline"`, `kind="loading"`;
  - `apps/web/src/components/ui/button.tsx`: `ghost`, sizes `sm` and `icon-sm`, and `cn` merges `className`.
- **The pieces:**

| File | Line | Today | Kit |
| --- | --- | --- | --- |
| `apps/web/src/components/approvals/AlwaysAllowedList.tsx` | 182-186 | `<p role="status" className="text-[13px] text-muted-foreground">Loading…</p>` | `<StateMessage kind="loading" size="inline" title="Loading…" />` |
| `apps/web/src/components/FolderEditorDialog.tsx` | 376 | `<button aria-label={`Remove ${chat.title}`} title=… onClick={() => onToggle(chat.id)} className="flex shrink-0 … rounded-full p-1 hover:bg-list-hover hover:text-foreground">` with an `X` (h-4 w-4) | `<Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-full" …>` |
| `apps/web/src/components/ChannelComposerBar.tsx` | 65 | `<button disabled={busy} onClick={() => void toggleMute()} className="shrink-0 rounded-full px-4 py-1.5 text-[14px] font-medium text-foreground hover:bg-list-hover disabled:opacity-60">{chat.muted ? 'Unmute' : 'Mute'}</button>` | `<Button type="button" variant="ghost" className="shrink-0" …>` |
| `apps/web/src/components/tools/CodeBlock.tsx` | 55 | `<button onClick={() => setExpanded(...)} className="self-start rounded-full px-2 py-1 text-[13px] text-muted-foreground hover:bg-list-hover …">{expanded ? 'Show less' : 'Show all'}</button>` | `<Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" …>` |

- **Imports:**
  - `AlwaysAllowedList.tsx:11` imports `Button, FieldError` from `@/components/ais/AiPageShell`;
  - `ChannelComposerBar.tsx` and `CodeBlock.tsx` do not import `Button` (CodeBlock imports only `useState`);
  - `FolderEditorDialog.tsx` imports `Button` (since T-0365).
- **Tests:**
  - `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`;
  - `apps/web/src/components/FolderEditorDialog.test.tsx`;
  - `apps/web/src/components/tools/tools.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx` (it renders `ChannelComposerBar`).

  Keep every text, label and handler.

### What to build
1. Apply the table.
2. Import `StateMessage` and `Button` (from `@/components/ui/…`) where missing.

### Read first
`AGENTS.md`, the two kit files and each file around its line.

### Allowed files
`apps/web/src/components/approvals/AlwaysAllowedList.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/ChannelComposerBar.tsx`, `apps/web/src/components/tools/CodeBlock.tsx`, `apps/web/src/components/approvals/AlwaysAllowedList.test.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `apps/web/src/components/tools/tools.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0402-web-small-leftovers-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AlwaysAllowedList FolderEditorDialog tools ChatView
pnpm gate
```

### Acceptance
- The four pieces are on the kit.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
