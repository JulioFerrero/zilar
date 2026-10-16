---
id: T-1681
title: "Lint config: drop two stale max-lines exemptions from .oxlintrc.json — apps/mobile/src/store/chat-store.ts no longer exists and apps/mobile/src/lib/emoji-data.ts is 123 lines since T-1665 (T-1673 follow-up)"
status: merged
milestone: M5
branch: task/T-1681-oxlint-stale-exemptions
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1681: Remove stale lint exemptions

## Spec (written by Claude, do not edit)

### Why
The `max-lines: off` override should only list files that really need it. Two entries are stale.

### Facts (the lead read them on 2026-10-16)
- **`.oxlintrc.json:38-49`:** an override with `"files": ["apps/mobile/src/mock/**", "apps/web/src/mock/**", "packages/mock-backend/**", "apps/mobile/src/store/chat-store.ts", "apps/mobile/src/lib/emoji-data.ts"]` and `"rules": { "max-lines": "off" }`.
- **`apps/mobile/src/store/chat-store.ts` doesn't exist** (`wc` says "No such file").
- **`apps/mobile/src/lib/emoji-data.ts` is 123 lines** (T-1665 moved its table out; T-1673 moved it to chat-core).

### Steps
1. **Remove the two stale entries** (`apps/mobile/src/store/chat-store.ts` and `apps/mobile/src/lib/emoji-data.ts`) from that `files` list. Keep the three mock globs.
2. **Change nothing else.**

### Allowed files
- `.oxlintrc.json`
- `work/T-1681-oxlint-stale-exemptions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The override lists only the three mock globs.**
- **Lint passes.**

---

## Report (written by the worker when done)

### What I did
Removed the two stale `files` entries (`apps/mobile/src/store/chat-store.ts` and
`apps/mobile/src/lib/emoji-data.ts`) from the `max-lines: off` override in
`.oxlintrc.json`. The override now lists only the three mock globs
(`apps/mobile/src/mock/**`, `apps/web/src/mock/**`, `packages/mock-backend/**`).
Nothing else changed.

Facts verified before editing:
- `apps/mobile/src/store/chat-store.ts` does not exist.
- `apps/mobile/src/lib/emoji-data.ts` is 123 lines.

Prettier (printWidth 100) then collapsed the now-shorter `files` array onto one
line, which is the only other diff in the file.

### Files changed
- `.oxlintrc.json`
- `work/T-1681-oxlint-stale-exemptions.md` (this file)

### Checks run
No source files were touched, so no single test file applied.

`pnpm gate` (from repo root), final run:
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.9s)
PASS  lint  (1.4s)
PASS  typecheck  (1.8s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead
- The first gate run failed on `format` (Prettier wanted the shortened array on
  one line). I ran `pnpm exec prettier --write .oxlintrc.json` and re-ran the
  gate; it then passed.
- Acceptance met: the override lists only the three mock globs and lint passes.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff:** only the two stale entries are gone; the three mock globs stay, and lint passes. This closes T-1673's follow-up.
