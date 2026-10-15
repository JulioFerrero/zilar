---
id: T-1464
title: "Mobile SearchField: the input text stays centred and unclipped at large font sizes (no Android default padding, the well grows instead of clipping); fixes every search field at once"
status: merged
milestone: M5
branch: task/T-1464-search-field-font-scale
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1464: SearchField at large font sizes

## Spec (written by Claude, do not edit)

### Why
The lead checked MUX-18 on the emulator with the system font scale at 1.3. In a group's topic list, the "Search topics" placeholder sits too high and its top is clipped by the field's well.

### Facts (the lead read them on main, 2026-10-15)
- **The kit field:** `apps/mobile/src/components/ui/search-field.tsx` (63 lines).
  - Its well is fixed at `h-10` (`:39`).
  - The `TextInput` has `className="flex-1 text-[15px] text-foreground"` (`:46`) and no vertical padding override. On Android, a `TextInput` keeps its default vertical padding, so a scaled font no longer fits 40 dp and is clipped.
- **The users:** `app/explore.tsx`, `components/ui/select-sheet.tsx`, `components/stickers/discover-tab.tsx`, `components/chat/search-header.tsx`, `components/chat/forward-sheet.tsx`, `components/chat/group-topic-list.tsx`, `components/chat/gif-panel.tsx`, `components/group/new-group-members.tsx` and `components/contacts/contact-list.tsx`, all under `apps/mobile/src/`.

### What to build
1. **In `SearchField` only:**
   - the well becomes `min-h-10` instead of `h-10`, so it grows with the text instead of clipping it;
   - the `TextInput` gets `paddingVertical: 0` (style or `py-0`) and `textAlignVertical: 'center'`, and keeps its `flex-1` and font classes.
2. At the default font scale, the field looks exactly as today: 40 dp, the text centred on the icon.
3. **No caller changes.**

### Tests
None (UI).

### Allowed files
`apps/mobile/src/components/ui/search-field.tsx`, `work/T-1464-search-field-font-scale.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead checks the topic search on the emulator at font scale 1.0 and 1.3.

---

## Report (written by the worker when done)

### What I did

Changed only `apps/mobile/src/components/ui/search-field.tsx`:

- The well row is now `min-h-10` instead of `h-10`, so it grows with the text
  instead of clipping a scaled font.
- The `TextInput` now has `py-0` (no Android default vertical padding) and
  `style={[{ textAlignVertical: 'center' }, style]}` so the text stays centred.
  `flex-1` and `text-[15px] text-foreground` are unchanged.
- Destructured `style` from the props so a caller-supplied style still merges
  after the `textAlignVertical` default instead of being dropped.

No caller changes. No tests (UI); the gate skips `@zilar/mobile` tests because
there are no nearby test files.

### Files changed

- `apps/mobile/src/components/ui/search-field.tsx`
- `work/T-1464-search-field-font-scale.md`

### Commands and results

- `pnpm install` — done, success.
- `pnpm gate` — GATE PASS. Summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (4.3s)
PASS  effect  (0.9s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Deviations / open questions

- The spec allowed `paddingVertical: 0` as either a style or `py-0`; I used the
  `py-0` class and put `textAlignVertical: 'center'` in the style, merging the
  caller's `style` prop after it.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- On the emulator, the topic search reads "Search topics" centred on the icon, at both font scale 1.0 (40 dp, as before) and 1.3 (the well grows, with no clipping).
