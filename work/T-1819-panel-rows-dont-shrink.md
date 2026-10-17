---
id: T-1819
title: "Web topic and contact panels: the scrolling body's children never shrink (shrink-0), so the Tools and routines row (overflow-hidden) no longer collapses to 2px when the content is taller than the panel"
status: merged
milestone: M5
branch: task/T-1819-panel-rows-dont-shrink
model: auto
effort: default
depends_on: [T-1817]
estimate: 10 min
---

# T-1819: Panel rows don't shrink

## Spec (written by Claude, do not edit)

### Why
**Web mock mode on 2026-10-17:** once a public topic's panel lists its members (T-1817), the content is taller than the panel. The "Tools and routines" row then vanishes. The DOM shows `nav[aria-label="This topic"]` with a height of **2 px**.
- **The cause:** the body is a scrolling flex column, and its children keep the default `flex-shrink: 1`. So they shrink instead of the column scrolling, and the row's `overflow-hidden` hides everything but its border.
- **This predates T-1817:** a private topic with many members hits it too.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/TopicPanel.tsx:207`:** `<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">`.
- **`apps/web/src/components/ContactPanel.tsx:201`** has the same container.
- **`apps/web/src/components/panels/TopicToolsRow.tsx`:** the `nav` uses `overflow-hidden rounded-xl border`.

### Steps
1. Add `*:shrink-0` (Tailwind's child variant) to both containers' class lists, so every direct child keeps its height and the column scrolls.
2. **No tests** (UI).

### Allowed files
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/ContactPanel.tsx`
- `work/T-1819-panel-rows-dont-shrink.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- With a long member list, the topic panel scrolls and the Tools and routines row keeps its full height.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added Tailwind's child variant `*:shrink-0` to the scrolling flex column in `apps/web/src/components/TopicPanel.tsx:207` and `apps/web/src/components/ContactPanel.tsx:201`, so every direct child keeps its natural height and the column scrolls instead of squashing rows (the `overflow-hidden` Tools and routines row no longer collapses to 2 px).
- No other change; no tests added (UI-only change, per spec).

### Checks run
- `pnpm install`: done in 16.4s (lockfile satisfied).
- `pnpm gate` (from repo root): `GATE PASS`. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.4s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests for this UI change and the gate reports no nearby web test files.

### Notes for the lead
## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `b53684709`.
- **`*:shrink-0`** is added to the scrolling bodies of `TopicPanel` and `ContactPanel`.
- **The lead checks** the DOM height of `nav[aria-label="This topic"]` in local web mock mode on main right after this merge (it was 2 px before).

### Notes (worker)
- Used `*:shrink-0` (Tailwind v4 universal child variant, available in the project's `tailwindcss ^4.3.3`).
- Not verified in a live browser; acceptance relies on the lead's smoke. The change makes the scrolling column's children non-shrinking while the container keeps `min-h-0 flex-1 overflow-y-auto`, which is the intended scroll behaviour.
