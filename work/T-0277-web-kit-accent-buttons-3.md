---
id: T-0277
title: "Web kit migration 10: hand-rolled accent buttons in the chat dialogs become the kit Button"
status: merged
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

### What I did
Replaced every hand-rolled `bg-accent px-…` button listed in the spec with the
kit `Button` (`import { Button } from '@/components/ui/button'`), keeping
`type`, `onClick`, `disabled`, `aria-label` and the text, and mapping size by
font: `text-[15px]` → `size="lg"`, `text-[14px]` → `size="default"`,
`text-[13px]` → `size="sm"`. Colour, padding, radius, font and gap classes are
gone; only layout-only classes stay via `className`. Muted Cancel / Close /
Back / Dismiss pills and the out-of-scope files were left untouched.

- `InviteDialog.tsx`: the "Close" action is `Button size="lg"`; the copy button
  (`aria-label="Copy invite link"`) is `Button size="sm"` with
  `className="shrink-0"`, same `disabled` and `onClick`.
- `AddContactDialog.tsx`: the "Close" action is `Button size="lg"`.
- `NewGroupDialog.tsx`: "Next" (keeps `disabled={selected.length === 0}`) and
  "Create" (keeps `disabled={busy}`) are `Button size="lg"`; Cancel and Back
  stay muted pills.
- `ExplorePage.tsx`: the "Close" action is `Button size="lg"`; each row's
  Join/Open is `Button` (default size) with `className="shrink-0"` and the same
  `disabled` and `onClick`.
- `AvatarUploader.tsx`: "Add picture"/"Change picture" and "Save picture" are
  `Button` (default size) with the same `disabled` and `onClick`; Cancel stays
  muted.
- `GroupHandleRoute.tsx`: the error-card "Retry" is `Button size="lg"`; the card
  join button is `Button size="lg"` with `className="mt-5 w-full"`. Muted Close
  pills stay.

### Files changed
- `apps/web/src/components/InviteDialog.tsx` + `.test.tsx`
- `apps/web/src/components/AddContactDialog.tsx` + `.test.tsx`
- `apps/web/src/components/NewGroupDialog.tsx` + `.test.tsx`
- `apps/web/src/components/ExplorePage.tsx` + `.test.tsx`
- `apps/web/src/components/AvatarUploader.tsx` + `.test.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx` + `.test.tsx`
- `work/T-0277-web-kit-accent-buttons-3.md`

### Tests added
One `data-slot="button"` assertion per test file, on a migrated button:
`Close` (InviteDialog), `Close` (AddContactDialog), `Create` (NewGroupDialog),
`Join` (ExplorePage), `Add picture` (AvatarUploader), `Join the group`
(GroupHandleRoute). Existing queries were by role/text and needed no change.

### Commands and results
- `pnpm install` — Done. `pnpm-lock.yaml` is unchanged (`git status` lists only
  the files above).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot InviteDialog
  AddContactDialog NewGroupDialog ExplorePage AvatarUploader GroupHandleRoute` —
  `Test Files 6 passed (6)`, `Tests 33 passed (33)`.
- First `pnpm gate` — `GATE FAIL`: `tests @zilar/web` failed at
  `GroupHandleRoute.test.tsx:165` ("closes the error card with Escape"); the
  error card was still in the DOM after Escape. This test does not use the old
  markup and passes on re-runs, so I treated it as a flake under the shared
  machine's parallel load. Re-ran the same suite the gate runs
  (`pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot --changed main`)
  — `Test Files 49 passed (49)`, `Tests 471 passed (471)`.
- Second `pnpm gate` — `GATE PASS`:
  - `gate: 13 changed file(s) against main`
  - `PASS  install (frozen)  (0.9s)`
  - `PASS  format  (11.9s)`
  - `PASS  lint  (0.4s)`
  - `PASS  typecheck  (0.6s)`
  - `PASS  tests @zilar/web  (19.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Grep confirmed none of the six source files contains `bg-accent px-`.

### Deviations / open questions
- The first gate attempt failed on a flaky `GroupHandleRoute` Escape test
  (unrelated to this migration); the second gate passed. Flagging it since the
  lead's merge gate could hit the same flake. No spec deviation.

## Review (written by Claude)

**Approved.** The pre-review was clean with 0 nits, and there were no fix rounds. No `bg-accent px-` is left in the six files.

**Flaky test:** the `GroupHandleRoute` "closes with Escape" test also flaked in T-0273. It has its own follow-up task.
