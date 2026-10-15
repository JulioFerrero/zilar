---
id: T-1463
title: "Mobile chat row: the title truncates instead of overflowing, so a channel's 'N subscribers' never draws over the time at large font sizes (found on the emulator at font scale 1.3)"
status: merged
milestone: M5
branch: task/T-1463-chat-row-title-shrink
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1463: The chat row title truncates

## Spec (written by Claude, do not edit)

### Why
The lead checked MUX-18 on the emulator with the system font scale at 1.3. In the chat list, the channel row "Acme Announcements 📢 120 subscribers" draws its subscriber label over the row's time ("Mon"), so the two texts overlap. Every other row holds at 1.3.

### Facts (the lead read them on main, 2026-10-15)
- **The cause:** in `apps/mobile/src/components/chat/chat-list-item.tsx:97-124`, the first line's left box is `min-w-0 flex-1 flex-row items-center`.
  - The title `<Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">` (`:98`) has **no `shrink`**, and React Native defaults `flexShrink` to 0.
  - The channel label `View` is `shrink-0` (`:106`).
  - So a long title plus the label overflow the box, under the time (`:127`).
- **The group row does it right:** its title has `className="shrink …"` (`apps/mobile/src/components/chat/group-list-item.tsx:112`).

### What to build
1. Add `shrink` to the title `Text` at `apps/mobile/src/components/chat/chat-list-item.tsx:98`, so the title truncates with its ellipsis first. The channel label, AI badge, pin and mute icons keep their size.
2. Nothing else changes.

### Tests
None (UI).

### Allowed files
`apps/mobile/src/components/chat/chat-list-item.tsx`, `work/T-1463-chat-row-title-shrink.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead re-checks the chat list on the emulator at font scale 1.3.

---

## Report (written by the worker when done)

### What I did
- In `apps/mobile/src/components/chat/chat-list-item.tsx:98`, added `shrink` to the title `Text` className, so the title (`text-[16px] font-semibold`) shrinks and truncates with its ellipsis first instead of overflowing under the time. The channel label (`shrink-0`), AI badge, pin and mute icons keep their size.
- Nothing else changed. The group row already did this (`group-list-item.tsx:112`), so this brings the chat row in line.

### Files changed
- `apps/mobile/src/components/chat/chat-list-item.tsx` — one class added.
- `work/T-1463-chat-row-title-shrink.md` — status and this report.

### Commands and results
- `pnpm install`: done, 1137 added/reused, no errors.
- Single tests: none. The spec says "Tests: None (UI)" and AGENTS.md says UI code gets no tests, so I ran none.
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations / problems
- None. The change matches the spec exactly.

### Blocked / needs a decision
- None. The on-emulator re-check at font scale 1.3 is the lead's, per the Acceptance section.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- On the emulator at font scale 1.3, the Acme channel row now reads "Acme Annou… 📢 120 subscribers Mon", with no overlap.
- The other rows are unchanged.
