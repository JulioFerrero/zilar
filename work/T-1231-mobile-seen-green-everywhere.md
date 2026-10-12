---
id: T-1231
title: "Mobile seen ticks are green everywhere from one constant: add SEEN (palette.online) to lib/colors.ts, use it in the bubble meta and decor (replacing the '#22c55e' literals from T-1228) and in the chat-list and topic rows (replacing '#ededed')"
status: merged
milestone: M5
branch: task/T-1231-mobile-seen-green-everywhere
model: auto
effort: default
depends_on: [T-1228]
estimate: 0.05 day
---

# T-1231: Green seen ticks everywhere on mobile

## Spec (written by Claude, do not edit)

### Why
Julio chose **green** seen ticks (2026-10-12). T-1228 (merged) draws them green in the bubbles, but with a hard-coded `'#22c55e'`:
- `apps/mobile/src/components/chat/message-bubble-content.tsx:64,168`;
- `apps/mobile/src/components/chat/message-bubble-decor.tsx:69,160`.

The chat-list and topic rows still draw seen in `'#ededed'`:
- `apps/mobile/src/components/chat/chat-list-item.tsx:146`;
- `apps/mobile/src/components/chat/topic-row.tsx:165`.

The green is already a token: `palette.online` (`packages/ui-tokens/src/index.ts:25`).

### What to build
1. **`apps/mobile/src/lib/colors.ts`:** add `export const SEEN: string = palette.online;` next to the other palette exports (`:22-35`), with a one-line doc comment saying it's the green of seen ticks.
2. **Replace the four `'#22c55e'` literals** in `message-bubble-content.tsx` and `message-bubble-decor.tsx` with `SEEN`.
3. **Replace `'#ededed'`** in `chat-list-item.tsx:146` and `topic-row.tsx:165` with `SEEN`. `MUTED_FOREGROUND` stays for every other status.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/lib/colors.ts` and the four component files above.

### Allowed files
`apps/mobile/src/lib/colors.ts`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/topic-row.tsx`, `work/T-1231-mobile-seen-green-everywhere.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `grep -rn "#22c55e\|#ededed" apps/mobile/src/components/chat` finds no tick colours.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/lib/colors.ts`: added `export const SEEN: string = palette.online;` with a one-line doc comment (`/** The green of seen ticks. */`), next to the other palette exports.
- `apps/mobile/src/components/chat/message-bubble-content.tsx`: imported `SEEN` and replaced both `'#22c55e'` literals (bubble meta `ticksColor` and the raised-pill `Ticks` color).
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`: imported `SEEN` and replaced both `'#22c55e'` literals (same two spots).
- `apps/mobile/src/components/chat/chat-list-item.tsx`: imported `SEEN` and replaced the read-status `'#ededed'` with `SEEN` (`MUTED_FOREGROUND` kept for every other status).
- `apps/mobile/src/components/chat/topic-row.tsx`: same change as chat-list-item.

### Files changed
- `apps/mobile/src/lib/colors.ts`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `work/T-1231-mobile-seen-green-everywhere.md` (status)

### Commands and results
- `pnpm install`: Done in 12.1s (frozen lockfile).
- Acceptance grep `#22c55e` in `apps/mobile/src/components/chat`: no matches (all four literals replaced).
- Gate summary lines:
```
gate: 6 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/mobile
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
- No single test files were run (spec says UI change, no tests).

### Notes / deviations
- None. No tests added (UI change, per spec).
- The acceptance grep for `#ededed` still matches five places in `apps/mobile/src/components/chat` (`link-text.tsx:45`, `message-bubble.tsx:164`, `voice-message-bars.tsx:144`, `message-actions-sheet.tsx:116`, `reaction-chips.tsx:50`). Those are text/background colours, not tick colours, and all sit outside the Allowed files, so they were left untouched; the two tick usages named by the spec were replaced.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 0 nits.** `SEEN = palette.online` is in `lib/colors.ts`, and the four bubble literals and two list-row literals now use it. The remaining `#ededed` matches in `components/chat` aren't tick colours.
