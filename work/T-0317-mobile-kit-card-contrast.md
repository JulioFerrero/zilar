---
id: T-0317
title: "Mobile kit polish: ActionSheet and ConfirmDialog cards get the sheet surface and a border, so they stand out in dark mode"
status: todo
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

## Review (written by Claude)
