---
id: T-0374
title: "Web kit: the group visibility Cancel and Copy share link, and the invite link Done and Revoke buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0374-web-visibility-invite-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0374: visibility and invite link buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The group panel's visibility and invite link sections put hand-rolled outline pills next to kit Buttons.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default`, `outline` (`border-border-strong bg-surface … hover:bg-surface-raised`), `ghost` and `link` (`text-primary underline-offset-4 hover:underline`);
  - sizes: `default` (h-8), `sm` (h-7) and `lg`;
  - `cn` merges a caller `className`.
  Both files already import `Button` from `@/components/ui/button`.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Kit |
| --- | --- | --- | --- |
| `apps/web/src/components/VisibilitySection.tsx` | 191 | "Cancel" (`setConfirmingPrivate(false)`), next to the kit Save at line 187 (default size) | `variant="outline"` |
| same | 200 | "Copy share link" or "Copied" (`copyText(shareUrl)`) | `variant="outline"` |
| `apps/web/src/components/InviteLinksSection.tsx` | 141 | "Done" (`onDismissCreated`, `self-start text-[13px] font-medium text-accent hover:underline`) | `variant="link" size="sm"`, `className="self-start px-0 text-accent"` |
| same | 240 | "Revoke" or "Revoking…" (`aria-label` "Revoke invite link …", `disabled={revoking}`, `shrink-0 rounded-full border border-border-strong px-3 py-1 text-[13px]`) | `variant="outline" size="sm"`, `className="shrink-0"` |

- **Tests:** `apps/web/src/components/VisibilitySection.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx` and `apps/web/src/components/GroupPanel.test.tsx` find buttons by role and name. Keep every text, `aria-label`, `disabled` and handler.

### What to build
1. Replace the four buttons with `<Button type="button" …>`, using the table.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/VisibilitySection.tsx:180-212` and `apps/web/src/components/InviteLinksSection.tsx:130-250`.

### Allowed files
`apps/web/src/components/VisibilitySection.tsx`, `apps/web/src/components/InviteLinksSection.tsx`, `apps/web/src/components/VisibilitySection.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `work/T-0374-web-visibility-invite-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot VisibilitySection InviteLinksSection GroupPanel
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in the two files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
