---
id: T-0277
title: "Web kit migration 10: hand-rolled accent buttons in the chat dialogs become the kit Button"
status: todo
milestone: M5
branch: task/T-0277-web-kit-accent-buttons-3
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0277: accent buttons on the kit Button, batch 3 (dialogs)

## Spec (written by Claude, do not edit)

### Why
This is batch 3 of removing the flat `bg-accent px-` pill outside the kit (`docs/audit/ui-kit-audit.md` line 437). T-0275 and T-0276 did batches 1 and 2. Copy their approach; their Reports are in `work/T-0275-web-kit-accent-buttons-1.md` and `work/T-0276-web-kit-accent-buttons-2.md`.

The kit primary is `Button` (`apps/web/src/components/ui/button.tsx`):
- the default variant is `key-primary`;
- sizes are `sm`, `default` and `lg`;
- it renders `data-slot="button"`.

### Verified facts (do not re-derive)
All of these are `<button>` elements with `rounded-… bg-accent px-… text-accent-foreground hover:bg-accent/90`.
- `apps/web/src/components/InviteDialog.tsx`: line 52 (`text-[15px]`) and line 70 (`px-2.5 py-1 text-[13px]`).
- `apps/web/src/components/AddContactDialog.tsx`: line 89 (`text-[15px]`).
- `apps/web/src/components/NewGroupDialog.tsx`: lines 148 and 167 (`text-[15px]`).
- `apps/web/src/components/ExplorePage.tsx`: line 147 (`text-[15px]`) and line 247 (`text-[14px]`).
- `apps/web/src/components/AvatarUploader.tsx`: line 283 (`text-[14px]`) and line 348 ("Save picture", `text-[14px]`, in the crop Dialog `actions`).
- `apps/web/src/routes/GroupHandleRoute.tsx`: line 122 (`py-1.5 text-[15px]`) and line 206 (`py-2.5 text-[15px]`).

Each file has a `*.test.tsx` next to it.

### What to build
1. Every button listed above becomes the kit `Button` (`import { Button } from '@/components/ui/button'`):
   - keep `type`, `onClick`, `disabled`, aria attributes, `title`, icons and text;
   - size: `text-[15px]` becomes `size="lg"`, `text-[14px]` becomes `size="default"`, `text-[13px]` becomes `size="sm"`;
   - keep layout-only classes (`w-full`, `shrink-0`, `self-start`, margins) through `className`; drop the colour, padding, radius, font and gap classes.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `data-slot="button"` assertion per file's test.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `work/T-0276-web-kit-accent-buttons-2.md` (Report), and the six files with their tests.

### Allowed files
`apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/InviteDialog.test.tsx`, `apps/web/src/components/AddContactDialog.tsx`, `apps/web/src/components/AddContactDialog.test.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/AvatarUploader.test.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `work/T-0277-web-kit-accent-buttons-3.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot InviteDialog AddContactDialog NewGroupDialog ExplorePage AvatarUploader GroupHandleRoute
pnpm gate
```

### Acceptance
- None of the six source files contains `bg-accent px-`. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. `pnpm-lock.yaml` must not change (T-0272 fixed the flip; if it still changes, say so in the Report and revert it).

### Out of scope
- muted Cancel / Close pills;
- every other file with `bg-accent px-`.

---

## Report (written by the worker when done)

## Review (written by Claude)
