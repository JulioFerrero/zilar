---
id: T-0374
title: "Web kit: the group visibility Cancel and Copy share link, and the invite link Done and Revoke buttons use the kit Button"
status: merged
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
Replaced the four hand-rolled buttons with kit `<Button>` per the spec table.
Files changed:
- `apps/web/src/components/VisibilitySection.tsx`: Cancel and Copy share link/Copied now `variant="outline"` kit Buttons; kept texts, `copyText` handler, `setConfirmingPrivate(false)`.
- `apps/web/src/components/InviteLinksSection.tsx`: Done now `variant="link" size="sm" className="self-start px-0 text-accent"`; Revoke/Revoking… now `variant="outline" size="sm" className="shrink-0"`; kept aria-labels, disabled, handlers.
- No test files needed changes.
Commands:
- `pnpm install`: pass (21.3s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot VisibilitySection InviteLinksSection GroupPanel`: 3 files, 32 tests passed.
- `pnpm gate`: PASS install (1.7s), PASS format (21.9s), PASS lint (2.2s), PASS typecheck (33.7s), PASS tests @zilar/web (65.7s); scope: every changed file is inside the Allowed files; GATE PASS; 3 changed files.
Verified `grep <button` finds no matches in either component file.
Security checklist: no secrets/tokens touched; no new routes, deletes, caps, or audit entries.
No deviations from spec; no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). Visibility Cancel and Copy share link are kit outline; invite Done is a kit link, Revoke kit outline `sm`. Texts, labels and handlers kept. Pre-review clean (0 findings).
