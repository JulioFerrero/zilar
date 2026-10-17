---
id: T-1855
title: "Web search Messages section: drop the per-chat header row (20 px avatar + title) that repeats what every hit already shows — the web twin of T-1854"
status: merged
milestone: M5
branch: task/T-1855-web-search-group-header
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1855: No repeated chat header in web message search

## Spec (written by Claude, do not edit)

### Why
**Julio's phone screenshot (2026-10-17)** showed the Messages section repeating the chat: a small header row, then each hit with the same avatar and title. T-1854 removes it on the phone. Web draws the same header, so this is its twin.

### Facts (read by the lead on 2026-10-17)
- **The header row:** `apps/web/src/components/MessageSearchResults.tsx` (320 lines) draws, per group, `<div className="flex items-center gap-2 px-[10px] pt-1.5 pb-0.5">` with `EntityAvatar` size 20 and the title (`:184-193`), then a `SearchHit` per item (`:194-205`).
- **The hit already shows the chat:** `SearchHit` in `apps/web/src/components/MessageSearchResult.tsx` draws the 36 px avatar and the chat title (`:79-95`).

### Steps
1. **Remove the per-group header `div`** (`:184-193`) and keep the hits in the same order. Keep the "Messages" label and the keyboard highlight logic unchanged.
2. **Remove any import or variable** that only the header used.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/MessageSearchResults.tsx`
- `work/T-1855-web-search-group-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Message search hits** show without the extra small header row, and keyboard navigation still works.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Removed the per-group header row in `MessageHitList` (the 20 px `EntityAvatar` plus the repeated chat title above each group's hits). The "Messages" label, group order, hit order and the arrow-key/Enter highlight logic are unchanged.
- Removed the now-unused `EntityAvatar` import and the `avatarUrl` plumbing in `groupByChat` and its caller, since only the header used it. Hits still get the chat title via the existing `chatTitle` prop from `SearchHit`.
- No other files touched.

### Checks run
- `pnpm install`: `Done in 21.2s using pnpm v10.32.1`.
- `pnpm gate` (repo root): `gate: 2 changed file(s) against main`, then `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/web (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: every workspace package an app image needs is copied into its Dockerfile`, `size: every changed source file is within 400 lines`, `GATE PASS`.
- No single test files were run: the spec says no tests (UI) and the gate skipped web tests because there are no nearby test files.

### Notes for the lead
- Deviation: step 2 asked to drop anything only the header used, so `groupByChat` no longer carries `avatarUrl` in its input/output types. It is only used inside this file (grep found no other callers), but its signature is exported.
- I did not visually verify the web UI in a browser; the change is a pure removal of the header block.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `bbe670818`.
- **The mock check** ran on the branch in vite at 1440 px. A search for "staging" shows two hits ("Checkout button hidden on Safari", "General"), each with its avatar, title, time and snippet once, and no small header row above them.
