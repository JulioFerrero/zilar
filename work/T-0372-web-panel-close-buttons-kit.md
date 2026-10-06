---
id: T-0372
title: "Web kit: the Group, Channel, Topic and Pins panel close buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0372-web-panel-close-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0372: panel close buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The four side panels copy the same hand-rolled round X button.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - `ghost` is `hover:bg-surface-raised hover:text-foreground`;
  - `icon-lg` is `size-9`;
  - `cn` merges a caller `className`.
- **The four buttons**, all with `className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"` and `<X className="size-5" aria-hidden="true" />`:

| File | Line | `aria-label` |
| --- | --- | --- |
| `apps/web/src/components/GroupPanel.tsx` | 285 | "Close group panel" |
| `apps/web/src/components/ChannelPanel.tsx` | 282 | "Close channel panel" |
| `apps/web/src/components/TopicPanel.tsx` | 408 | "Close topic panel" |
| `apps/web/src/components/PinsPanel.tsx` | 78 | "Close pinned messages" |

- All four files already import `Button` (`./ui/button`).
- **Leave alone:**
  - the picker rows in `TopicPanel.tsx` (lines 523, 683 and 1022);
  - the Jump and Open rows in `PinsPanel.tsx` (lines 103 and 155).
- **Tests:**
  - `apps/web/src/components/GroupPanel.test.tsx`;
  - `apps/web/src/components/InviteLinksSection.test.tsx`;
  - `apps/web/src/components/Channels.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx`.

  They may query the close buttons by name. Keep every `aria-label` and `onClick`.

### What to build
1. Replace each with `<Button type="button" variant="ghost" size="icon-lg" aria-label=… onClick={onClose} className="shrink-0 rounded-full text-muted-foreground">`, keeping the `X` icon at `size-5`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the four lines above.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `apps/web/src/components/Channels.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0372-web-panel-close-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel InviteLinksSection Channels ChatView
pnpm gate
```

### Acceptance
- No `size-9 shrink-0 items-center justify-center rounded-full` close button remains in the four files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
