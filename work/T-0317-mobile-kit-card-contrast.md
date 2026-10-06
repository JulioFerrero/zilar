---
id: T-0317
title: "Mobile kit polish: ActionSheet and ConfirmDialog cards get the sheet surface and a border, so they stand out in dark mode"
status: merged
milestone: M5
branch: task/T-0317-mobile-kit-card-contrast
model: auto
effort: low
depends_on: [T-0313]
estimate: 0.1 day
---

# T-0317: ActionSheet and ConfirmDialog card contrast

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 18 shows two floating cards in dark mode, the message long-press menu and the "Delete for everyone?" dialog. Both use the page colour (`bg-background`) with no border, so the card edge almost disappears against the dark chat behind it (the lead looked at both screenshots).

The kit's other surfaces use `bg-surface` with a border:
- `BottomSheet` uses `border-t border-border-strong bg-surface` (`apps/mobile/src/components/ui/bottom-sheet.tsx:51`);
- `Card` uses `border border-border bg-surface` (`apps/mobile/src/components/ui/card.tsx:9`).

### Verified facts (do not re-derive)
- `apps/mobile/src/components/ui/action-sheet.tsx:52`: `<Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">`.
- `apps/mobile/src/components/ui/confirm-dialog.tsx:61`: `<View className="w-full max-w-xs rounded-2xl bg-background p-4">`.
- Tests live in `apps/mobile/src/components/ui/kit.test.tsx`, which uses `renderToStaticMarkup` and `toContain` on the markup (e.g. line 258: `expect(html).toContain('bg-well')`).

### What to build
1. `action-sheet.tsx:52`: the class becomes `overflow-hidden rounded-2xl border border-border-strong bg-surface`.
2. `confirm-dialog.tsx:61`: the class becomes `w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4`.
3. In `kit.test.tsx`, add one test per component asserting that the markup contains `bg-surface` and `border-border-strong`.
4. Nothing else changes.

### Read first
`AGENTS.md`, the two kit files, `apps/mobile/src/components/ui/kit.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `work/T-0317-mobile-kit-card-contrast.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit
pnpm gate
```

### Acceptance
- Both cards use `bg-surface` with a `border-border-strong` border, and the new tests cover it.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Changed both floating cards from `bg-background` (no border) to
`border border-border-strong bg-surface`, matching `Card`/`BottomSheet`,
so the card edge stands out against the dark chat behind it.
Files changed (all inside Allowed files):
- `apps/mobile/src/components/ui/action-sheet.tsx` (card `Pressable`
  class; wrapped over two lines for prettier)
- `apps/mobile/src/components/ui/confirm-dialog.tsx` (card `View` class)
- `apps/mobile/src/components/ui/kit.test.tsx` (one new test per
  component asserting `bg-surface` + `border-border-strong` in markup)
- `work/T-0317-mobile-kit-card-contrast.md` (this report)

Commands and real results:
- `pnpm install`: exit 0 (Done in 12.9s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit`:
  1 file, 24 tests passed (22 existing + 2 new).
  (Note: passing the full path `apps/mobile/src/.../kit.test.tsx` as the
  filter fails with ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL because the filter
  resolves outside the package root; the spec's `kit` filter works.)
- `pnpm gate`: first run GATE FAIL on format only
  (`action-sheet.tsx` line too long after the class change); fixed by
  wrapping the props. Second run: PASS install, PASS format, PASS lint,
  PASS typecheck, PASS tests @zilar/mobile, scope clean, GATE PASS.

No deviations from the spec. No secrets touched. Security checklist:
no new routes, logging, deletes, caps, or audit entries; N/A.
Blocked / needs a decision: none.

## Review (written by Claude)

**Approved.** Clean pre-review (1 nit), no fix rounds (Muse, with the paid fallback for the pre-review).
- Both cards are now `border border-border-strong bg-surface`, with tests.
- **Nit, accepted:** the ConfirmDialog `bg-surface` assertion also matches the Cancel button's `active:bg-surface-raised`. The paired `border-border-strong` assertion still catches a regression.

**Still to do:** emulator QA in the next run.
