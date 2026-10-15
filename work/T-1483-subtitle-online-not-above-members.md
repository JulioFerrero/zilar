---
id: T-1483
title: "Group header never says more online than members: mobile showed 'QA squad › General, 2 members, 3 online' (the room's occupants include the AI, the member count does not); chatSubtitle applies the store's own max(members, online) rule"
status: merged
milestone: M5
branch: task/T-1483-subtitle-online-not-above-members
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1483: Online never above members

## Spec (written by Claude, do not edit)

### Why
On the Android emulator (mock, main, 2026-10-15), the QA squad › General header reads "2 members, 3 online". Web shows "3 members, 3 online" for the same group.
- The room's occupants include QA-1 (an AI), while the member count from the groups API counts only the human members.
- The shared store already guards its own row: `packages/client-core/src/store/incoming.ts:273-274` sets `memberCount = Math.max(chat.memberCount ?? 0, event.occupants.length)`. That is why web is right.
- Mobile's group row merges `memberCount` and `onlineCount` from different rows (`apps/mobile/src/lib/topics.ts:129-130`), so the guard is lost there.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/chat-core/src/chat-labels.ts:34-38`** (78 lines) builds the subtitle, used as the header line on both apps:
  ```ts
  if (chat.kind === 'group') {
    const members = chat.memberCount ?? 0;
    const online = chat.onlineCount ?? 0;
    return online > 0 ? `${members} members, ${online} online` : `${members} members`;
  }
  ```

### What to build
1. In `chat-labels.ts`, the group branch uses `const members = Math.max(chat.memberCount ?? 0, online)`. Compute `online` first.
   - Add one comment line: everyone online is a member, and the room's occupants include AIs (the same rule as `handleOccupants`).
2. Nothing else changes.

### Tests
None (a UI string).

### Allowed files
`packages/chat-core/src/chat-labels.ts`, `work/T-1483-subtitle-online-not-above-members.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- On the emulator (lead), the QA squad › General header no longer shows more online than members.

---

## Report (written by the worker when done)

### What I did
- In `packages/chat-core/src/chat-labels.ts`, the group branch of `chatSubtitle` now computes `online` first and uses `const members = Math.max(chat.memberCount ?? 0, online)`, matching the store's own guard in `incoming.ts` (`handleOccupants`). Added one comment line explaining the rule (everyone online is a member; the room's occupants include AIs). Both lines render from the same `members` value, so a subtitle can never read "N members, M online" with M > N.

### Files changed
- `packages/chat-core/src/chat-labels.ts` (group branch of `chatSubtitle`)
- `work/T-1483-subtitle-online-not-above-members.md` (status + this Report)

### Commands run and real results
- `pnpm install`: `Done in 12s using pnpm v10.32.1`.
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (2.4s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/chat-core  (1.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files: none. `chatSubtitle` has no test file and no test references it (grep for `chatSubtitle` in `packages/chat-core` matches only the definition); the spec says tests are not needed for this UI string, and only the nearest package (`@zilar/chat-core`) test suite ran inside the gate.

### Deviations from the spec
- None.

### Blocked / needs a decision
- None.

### Open questions
- The emulator acceptance check (QA squad › General header no longer shows more online than members) is the lead's; I did not run it.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **The function, evaluated from the worktree:**
  - 2 members with 3 online reads "3 members, 3 online";
  - 5 with 2 reads "5 members, 2 online";
  - 4 with no presence reads "4 members".
- **The emulator check** runs on the next main APK, together with T-1482.
