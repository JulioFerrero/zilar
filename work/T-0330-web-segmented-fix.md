---
id: T-0330
title: "Web kit: SegmentedControl ignores clicks on the active option; PackEditor glyph buttons become icons"
status: merged
milestone: M5
branch: task/T-0330-web-segmented-fix
model: auto
effort: low
depends_on: [T-0326]
estimate: 0.2 day
---

# T-0330: SegmentedControl re-click fix, PackEditor icons

## Spec (written by Claude, do not edit)

### Why
1. **A bug found in the T-0326 pre-review.** `SegmentedControl` calls `onChange` on every click, even on the option that is already active. A native radio only fires on a real change. The group Visibility switches reset state in `onChange`, so in the New group dialog and the group panel, re-clicking the active "Public" clears the handle availability check.
2. **Glyphs.** PackEditor's sticker rows still draw `↑`, `↓` and `✕` glyphs; Julio wants icons.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/segmented-control.tsx`:**
  - line 76: `onClick={() => onChange(option.value)}`;
  - line 52: the keyboard helper `move` calls `onChange(option.value)` and then focuses the target.

  Home on the first option, or End on the last, also re-fires today. Tests are in `apps/web/src/components/ui/segmented-control.test.tsx` and `apps/web/src/components/ui/kit.test.tsx`.
- **Callers:**
  - `apps/web/src/components/NewGroupDialog.tsx` and `apps/web/src/components/VisibilitySection.tsx` reset the check, error and other state in `onChange`;
  - `apps/web/src/components/ExplorePage.tsx` and `apps/web/src/components/PackEditor.tsx` only set the value.
- **`apps/web/src/components/PackEditor.tsx`:**
  - lines 585-593: move up (`aria-label` `Move ${item.name} up`), glyph `↑`;
  - lines 594-602: move down, glyph `↓`;
  - lines 613-621: remove (`aria-label` `Remove ${item.name}`, danger hover), glyph `✕`.

  Each is a raw `button` with `rounded-md px-2 py-1 text-[13px] text-muted-foreground … disabled:opacity-40`. Line 10 imports `cn`, and lucide is not imported yet. `apps/web/src/components/PackEditor.test.tsx:136` clicks `getByLabelText('Move b.png up')`.

### What to build
1. **SegmentedControl:**
   - clicking the active option does not call `onChange`;
   - in `move`, call `onChange` only when the target differs from `value`, but always move focus.
2. **New tests in `segmented-control.test.tsx`:**
   - clicking the active option does not call `onChange` (`vi.fn`), and clicking another option does;
   - Home on the first option does not call it.
3. **PackEditor:** replace the three glyphs with lucide `ChevronUp`, `ChevronDown` and `X` (`className="size-4" aria-hidden="true"`). Keep each button's classes, labels, `disabled` and handlers.

### Read first
`AGENTS.md`, `work/T-0326-web-segmented-2.md` (Review), `apps/web/src/components/ui/segmented-control.tsx`, its test, and `apps/web/src/components/PackEditor.tsx:580-625`.

### Allowed files
`apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ui/segmented-control.test.tsx`, `apps/web/src/components/PackEditor.tsx`, `work/T-0330-web-segmented-fix.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot segmented-control kit PackEditor NewGroupDialog VisibilitySection ExplorePage
pnpm gate
```

### Acceptance
- Re-clicking the active segment calls nothing, and the new tests prove it.
- `↑`, `↓` and `✕` no longer appear in `PackEditor.tsx`.
- Existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

- `apps/web/src/components/ui/segmented-control.tsx`: `onClick` now skips `onChange` when the clicked option equals `value`; `move` skips `onChange` when the target equals `value` but always moves focus.
- `apps/web/src/components/ui/segmented-control.test.tsx`: added test that clicking the active option does not call `onChange` while clicking another does (called once with 'groups'); added test that Home on the first option does not call `onChange`.
- `apps/web/src/components/PackEditor.tsx`: replaced `↑`/`↓`/`✕` glyphs with lucide `ChevronUp`/`ChevronDown`/`X` (`className="size-4" aria-hidden="true"`); added the lucide import. Button classes, labels, `disabled`, handlers unchanged. Grep for `[↑↓✕]` in PackEditor.tsx: no matches.
- Checks: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot segmented-control kit PackEditor NewGroupDialog VisibilitySection ExplorePage` — 6 files, 88 tests, all passed. `pnpm gate` — GATE PASS (install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/web PASS; scope: every changed file inside the Allowed files; 4 changed files against main).
- Security checklist: no secrets/tokens; no deletes/updates touched; no caps/uniqueness; no permission changes (presentational + no-op-on-reselect change only); no new routes; no audit entries.
- No deviations from the spec; no open questions.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). `SegmentedControl` calls `onChange` only when the target option differs from `value`, both on click and on Arrow, Home and End; keyboard focus still moves. New tests prove that a re-click and Home on the first option are no-ops. This fixes the handle check resetting when the active Public option was clicked again (New group, group panel). PackEditor's move and remove buttons draw ChevronUp, ChevronDown and X instead of glyphs.
