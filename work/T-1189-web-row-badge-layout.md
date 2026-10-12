---
id: T-1189
title: "WUX-4: web chat list rows put the time and the unread badge on one right edge for DM, topic and group rows; the hover 'more' button moves to the title row so it never covers the badge or ticks"
status: merged
milestone: M5
branch: task/T-1189-web-row-badge-layout
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1189: One badge position in the web chat list

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-4 (P1, confirmed). Three row layouts place the badge differently:
- **DM rows:** the "more" button is `absolute right-0` (`apps/web/src/components/ChatListItem.tsx:159-174`), so the badge is flush right. But the hover button has `bg-surface-raised` and paints over the badge and ticks (`:171`).
- **Topic rows:** an inline `size-6` placeholder at `opacity-0` (`apps/web/src/components/TopicRow.tsx:146-161`) puts the badge 24 px plus the gap left of the time above it.
- **Group header rows:** `ml-auto`, with a chevron button after the badge (`TopicRow.tsx:247-285`).
- **Telegram:** the time and the badge share one right edge.

Re-check the line numbers: T-1170 changed `ChatListItem.tsx` since the audit.

### What to build
1. **Every row** (DM, topic and group header) has the time (top line) and the badge or ticks (bottom line) right-aligned to the same edge.
2. **The hover "more" button:** `absolute`, vertically on the **title line** (about `top-1.5`), right-aligned, and visible only on hover or focus. It must never overlap the badge or ticks. In `TopicRow`, remove the inline `opacity-0` placeholder.
3. **The group header's chevron** stays usable, but must not push the badge off the shared right edge. Put it left of the time, or overlay it on hover, and say which.
4. **Keep the right-click menu** (`onContextMenu`) unchanged.
5. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-4), `apps/web/src/components/ChatListItem.tsx` and `apps/web/src/components/TopicRow.tsx`.

### Allowed files
`apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `work/T-1189-web-row-badge-layout.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the live web:** the badges of a DM row and a topic row line up; hovering a DM row doesn't cover its badge.

---

## Report (written by the worker when done)

### What I did

One right edge per row: the time (top line) and the badge or ticks (bottom line) now share the content-column right edge in DM rows (`ChatListItem`) and topic rows (`TopicRow`), and the hover "more" button moved to the title line so it never paints over the badge or ticks.

- **ChatListItem.tsx**
  - Moved the "more" `Button` out of the preview line and out of the `Link` (it was a button nested in an anchor), placing it as a sibling of the `Link` inside the outer `div.group.relative`.
  - Positioned it `absolute top-1.5`, right-aligned to the row content edge: `right-[10px]` on wide (matches `p-[10px]`) and `right-4` on narrow (matches `px-4`). The button is `size-6`, so on the title line it spans roughly the title row and stops at the badge line's top.
  - Visible only on hover or focus: kept `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` and added `pointer-events-none` with `group-hover:pointer-events-auto focus-visible:pointer-events-auto`, so the hidden button no longer swallows clicks on the time.
  - Removed `top-1/2 -translate-y-1/2` (the old vertical centering over the badge line).
  - The time span (`ml-auto`) and the badge/ticks (`ml-auto`) were already both flush to the content-column right edge, so they line up; the only thing that broke the DM hover was the button background over the badge, now gone.
- **TopicRow.tsx (`TopicRow`)**
  - Removed the inline `size-6 opacity-0` placeholder `Button` from the preview line (this was what pushed the badge `24px + gap` left of the time).
  - Added the same absolute title-line "more" button as in `ChatListItem` (sibling of the `Link`, `absolute top-1.5`, `right-[10px]`/`right-4`, opacity/pointer-events gated on hover/focus). Now the time and the badge both sit at the content right edge.
- **Group header row (`GroupHeaderRow`, same file)** — no code change needed. The chevron already sits left of the time (title row: title, chevron, then the `ml-auto` time span), so it does not push the time or the badge off the right edge. I chose the spec's "put it left of the time" option (not overlay) and left it as is.
- **Right-click menu**: untouched. `ChatActionsMenu` was already rendered as a sibling of the `Link`; only where the "more" button lives changed. The `Menu` uses `top-6 right-0` against the same `div.group.relative`, so its position is unchanged.
- No tests added (UI, per spec).

### Files changed

- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `work/T-1189-web-row-badge-layout.md`

### Commands I ran (real results)

- `pnpm install` — all 16 workspace projects, 1180 packages installed, done in 13.8s.
- `pnpm gate` (from the repo root) — **GATE PASS**. Summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (3.1s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran no single test file: no test file covers these components (`SKIP tests @zilar/web (no nearby test files)`), and the spec says UI gets no tests.

### Deviations / things worth a look

- **Group header badge edge vs topic rows.** Within the group header, the time and the badge share one edge (both `ml-auto`). But that edge is the collapse button's content column, which sat left of the row's `Plus` ("new topic") button, so the group header's edge was ~40 px left of the topic rows' edge. The spec's item 3 only names the chevron, and the acceptance check is DM vs topic, so I left the `Plus` in flow. → Resolved in the fix round below: the `Plus` is now a hover/focus overlay and the group time shares the other rows' right edge.
- The "more" button now overlays the time on hover (button on the title line, time at the same right edge). The spec places the button on the title line and only forbids covering the badge/ticks, so this matches; say so if the time should instead hide on hover.

### Acceptance (for the lead's live check)

- DM rows and topic rows: time and badge/ticks share the content right edge.
- Hovering a DM row shows the "more" button on the title line; it no longer covers the badge or ticks.

### Fix round (lead's visual check, `VITE_MOCK=1` / `?mock=1`)

**Item 1 — the "more" button overlapped the time on DM and topic rows.** The button has no visible background of its own against the hovered row, so the left part of the time ("06.09") showed through beside the 24 px button. The time now fades out while the button is shown: `transition-opacity group-hover:opacity-0 group-focus-within:opacity-0` on the time span in `ChatListItem.tsx` and in the `TopicRow` function in `TopicRow.tsx`. The badge and ticks on the second line are untouched (they already shared the content right edge).

**Item 2 — group header time edge and the "+" swap.** The always-rendered "+" (new topic) button took the right edge, pushing the group header's time ~40 px left of the other rows.
- The "+" is now `absolute top-1.5`, `right-[10px]` (wide) / `right-4` (narrow) — the same edge as every other row — `size-6`, `rounded-full`, hidden until the row is hovered or the button itself is `focus-visible`, then shown in the time's place.
- The group header row got `group relative`; the time uses the same `group-hover:opacity-0 group-focus-within:opacity-0` (applied only when the "+" is actually rendered, through `showNewTopic`), so there is no blank edge for a group without topics.
- Keyboard: the "+" is still a `<button>` after the collapse button in DOM order, so Tab reaches it, and `focus-visible:opacity-100` makes it visible.
- With the "+" out of flow, the collapse button (`flex-1`) fills the row, so the group time and badge now sit on the same content right edge as the DM and topic rows.

Gate was run after each item and passed both times.

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (2.1s)
PASS  effect  (0.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-12: approved, after the lead's visual fix round. The pre-review is clean, with 1 nit.**
- **DM, topic and group-header rows** share one right edge for the time (top line) and the badge or ticks (bottom line).
- **The hover or focus "more" button** (and the group "+") replaces the time cleanly (the time is hidden while the button shows) and never covers the badge or ticks.
- **The lead's check**, on the mock build of the branch (`VITE_MOCK=1`, `?mock=1`), passed after the round: the edges align, and hovering a DM row, a topic row and a group header shows a clean swap.
