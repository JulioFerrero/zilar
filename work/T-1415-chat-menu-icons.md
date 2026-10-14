---
id: T-1415
title: "Web chat menu: icons on the items that have none (Topic info, Pinned messages, Media files and links, Search, Chat background)"
status: merged
milestone: M5
branch: task/T-1415-chat-menu-icons
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1415: Chat menu icons (web)

## Spec (written by Claude, do not edit)

### Why
A follow-up from 2026-10-14 (`work/NOW.md`): some items in the web chat header menu have no icon, while the rest do. This web menu is the only place they're missing: mobile opens these as header icon buttons (`apps/mobile/src/components/chat/chat-header.tsx:181`).

### Facts (the lead checked them on main, 2026-10-14)
- `apps/web/src/components/ChatHeader.tsx` is 347 lines; icons come from `lucide-react` (`:2`).
- `MenuItem` (`apps/web/src/components/ui/menu.tsx`) takes an `icon` prop; the header's group-info item uses `icon={Users}` at `:87`.
- **Items without an icon:**
  - in the topic branch: "Topic info" `:208`, "Pinned messages" `:216`, "Media, files and links" `:224`, "Search" `:232`, "Chat background" `:240`;
  - in the other branch: "Pinned messages" `:269`, "Media, files and links" `:277`, "Chat background" `:285`.
- The preference items (`ChatActionsMenu.tsx`) already have icons (`PinIcon`, `Bell`, `Archive`, …).

### What to build
Add `icon=` to each item listed above with a lucide icon that fits and isn't already used in the same menu:
- Topic info → `Info`;
- Pinned messages → `Pin`. `ChatActionsMenu` uses `PinIcon` for "Pin chat", so pick `Pin` vs `PinIcon` so the two read differently (e.g. `Pin` for messages, or `Bookmark`); say which in the Report;
- Media, files and links → `Images`;
- Search → `Search` (already imported);
- Chat background → `Palette` (or `Wallpaper` if the installed lucide version has it).

Use the same names in both branches. No other change.

### Tests
None (UI).

### Allowed files
`apps/web/src/components/ChatHeader.tsx`, `work/T-1415-chat-menu-icons.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The gate passes, and every item in both menu branches shows an icon.

---

## Report (written by the worker when done)

### What I did
Added an `icon=` prop to every menu item named in the Spec, in both branches of
`ChatHeader.tsx`:

| Item | Icon | Where |
| --- | --- | --- |
| Topic info | `Info` | topic branch |
| Pinned messages | `Bookmark` | both branches |
| Media, files and links | `Images` | both branches |
| Search | `Search` | topic branch (already imported) |
| Chat background | `Palette` | both branches |

New lucide imports: `Bookmark`, `Images`, `Info`, `Palette` (`Search` was already
imported). No other change; the existing `Group info` item still uses `Users`.

### Pin vs Bookmark decision
`ChatActionsMenu.tsx:89` already builds `PinIcon = pinned ? PinOff : Pin` for the
"Pin/Unpin" preference item. The Spec asked the two to read differently, so I used
`Bookmark` for "Pinned messages" rather than `Pin` (which would have duplicated the
preference item's glyph). `Pin`, `PinOff`, `Palette`, `Bookmark`, `Images` and
`Info` all exist in the installed `lucide-react` (verified with a `node -e` check
of the module's exports); I used `Palette` as the Spec's primary choice.

### Files changed
- `apps/web/src/components/ChatHeader.tsx` (+19/-1: 4 new imports expanded by
  Prettier, 8 `icon=` props across the two branches)
- `work/T-1415-chat-menu-icons.md` (status + this Report)

### Commands run
- `pnpm install` → `Done in 27.8s`.
- First `pnpm gate` → `FAIL format` (Prettier: `[warn] apps/web/src/components/ChatHeader.tsx`,
  long import line). Fixed with `pnpm exec prettier --write apps/web/src/components/ChatHeader.tsx`
  (only the import was reformatted; diff stayed inside the Allowed file).
- Final `pnpm gate` from the repo root → **GATE PASS**:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.5s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  (`scope` confirms no files outside the Allowed files.)

### Single tests run
None: the gate reported `SKIP tests @zilar/web (no nearby test files)`, and the Spec
says UI changes get no tests.

### Deviations / open questions
None. No dependencies added.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 0. Checked in web ?mock=1 (headless): the topic menu shows icons on Group info, Topic info, Pinned messages (Bookmark), Media (Images), Search, Chat background (Palette) and the preference items.
