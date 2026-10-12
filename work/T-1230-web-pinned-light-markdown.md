---
id: T-1230
title: "Web pins follow light Markdown: the pinned banner shows lightToPlain(snapshot) (one line, no markers) and the pins panel renders the snapshot with LinkText formatted, like the bubble (T-1225 follow-up)"
status: merged
milestone: M5
branch: task/T-1230-web-pinned-light-markdown
model: auto
effort: default
depends_on: [T-1225]
estimate: 0.05 day
---

# T-1230: Pins follow light Markdown (web)

## Spec (written by Claude, do not edit)

### Why
T-1225 (merged) renders light Markdown in human message bubbles (`LinkText` `formatted`, `apps/web/src/components/LinkText.tsx`), and strips the markers in chat-list previews (`lightToPlain` from `@zilar/chat-core`). Its pre-review left a follow-up: pinned snapshots still show raw markers.
- **The banner** (`apps/web/src/components/PinnedBanner.tsx:103`) renders `<LinkText text={snapshot} />`.
- **The panel** (`apps/web/src/components/PinsPanel.tsx:201`) renders the same.

### What to build
1. **`PinnedBanner.tsx:103`:** use `<LinkText text={lightToPlain(snapshot)} />`. It's a one-line preview, so no formatting, just no markers.
2. **`PinsPanel.tsx:201`:** use `<LinkText text={snapshot} formatted />`, which renders like the bubble.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/LinkText.tsx`, `apps/web/src/components/PinnedBanner.tsx` and `apps/web/src/components/PinsPanel.tsx`.

### Allowed files
`apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/components/PinsPanel.tsx`, `work/T-1230-web-pinned-light-markdown.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

Did exactly the two spec items, no tests (UI per spec):
- `apps/web/src/components/PinnedBanner.tsx`: import `lightToPlain` from `@zilar/chat-core` (same import style as `ChatListItem.tsx`) and render `<LinkText text={lightToPlain(snapshot)} />` — one-line preview, no markers, no formatting.
- `apps/web/src/components/PinsPanel.tsx:201`: render `<LinkText text={snapshot} formatted />` so the panel renders like the bubble (T-1225).

Files changed: `apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/components/PinsPanel.tsx`.

Commands:
- `pnpm install`: done (15.2s).
- Per instructions, ran no single test files (spec says no tests; gate reported no nearby test files).
- `pnpm gate` from repo root: GATE PASS. Summary lines: 3 changed file(s) against main; PASS install (frozen) (1.2s); PASS format (0.7s); PASS lint (0.8s); PASS typecheck (4.4s); PASS effect (0.9s); SKIP tests @zilar/web (no nearby test files); scope: every changed file is inside the Allowed files; migration: every added migration continues from the base; GATE PASS.

Security checklist: no secrets/tokens touched, no deletes/updates, no caps/uniqueness, no permissions, no routes, no audit entries. UI-only change rendering already-fetched snapshot text.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 0 nits.** The banner shows `lightToPlain(snapshot)`, and the panel renders `LinkText formatted`. These are exactly the two spec lines.
