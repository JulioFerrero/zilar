---
id: T-1839
title: "Web group panel's Your/Other topics rows show '#' for a public topic (lock for private), like WebGroup.dc.html and the phone's Group info; they showed the topic's first letter"
status: merged
milestone: M5
branch: task/T-1839-web-group-topic-hash
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1839: "#" tiles in the web group panel

## Spec (written by Claude, do not edit)

### Why
**In web mock mode on 2026-10-17,** the group panel's topic rows show letter tiles ("G", "B", "D"). The board draws `#` (`docs/design/mockups/topic-people/WebGroup.dc.html:70,75,96`), and the phone's Group info already does (`apps/mobile/src/components/group-info/topics-section.tsx:97-109`).

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/group-info/TopicsSection.tsx:77-88`:** `TopicGlyph` renders `<Lock … aria-label="Private" />` for a private topic, otherwise `topic.glyph`.

### Steps
1. Render `#` (aria-hidden) instead of `topic.glyph` for non-private topics. Keep the tile's classes and the private lock.
2. **No tests** (UI).

### Allowed files
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `work/T-1839-web-group-topic-hash.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The group panel's topic rows show `#`, or a lock for a private topic.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/group-info/TopicsSection.tsx`: `TopicGlyph` now renders `#` (wrapped in `<span aria-hidden="true">`) for a non-private topic instead of `topic.glyph`. The private lock (`Lock`, `aria-label="Private"`) and the tile's classes are unchanged. Updated the function's doc comment to match. This affects both Your topics and Other topics rows, because both go through `TopicRow`/`TopicGlyph`.
- No tests added (UI, per the spec).

### Checks run
- `pnpm install`: done, 15.5s (peer-dependency warning about `@types/react-dom` vs `@types/react` in `apps/mobile`, pre-existing).
- `pnpm gate`: exit 0. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.3s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Changed files: `apps/web/src/components/group-info/TopicsSection.tsx`, `work/T-1839-web-group-topic-hash.md` only.

### Notes for the lead
- I did not run the web app or eyeball the panel; acceptance is based on the code path (`TopicRow` → `TopicGlyph`), which is the only tile renderer for both topic lists.
- `topic.glyph` is no longer read here. It is still part of the `TopicInfo` type and may be used elsewhere; I left it alone since only this file was in scope.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `a95539760`. A public topic's tile is an aria-hidden `#`, and a private one keeps the lock. `topic.glyph` still feeds the sidebar's letter tiles.
