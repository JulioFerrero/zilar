---
id: T-1836
title: "Web topic panel header counts people plus the topic's AIs ('· 4 members'), like the chat header and Julio's 'AIs count as members' rule; it showed people only ('· 3 members')"
status: merged
milestone: M5
branch: task/T-1836-panel-count-includes-ais
model: auto
effort: default
depends_on: [T-1817]
estimate: 10 min
---

# T-1836: The panel count includes AIs

## Spec (written by Claude, do not edit)

### Why
**Live check on 2026-10-17, "ai test › cards test":** the chat header says "ai test · 4" (3 people plus Deepseek), but the topic panel header says "Public topic · 3 members".
- **The rule:** Julio decided that AIs count as members everywhere (10-15), and the topic-people README says the header count is people plus AIs (`docs/design/mockups/topic-people/README.md`, "Rules from the boards").
- **The source:** T-1817's suffix counts people only.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/TopicPanel.tsx`:**
  - `headerSuffix` (`:179-184`) is `' · Everyone'` for General; otherwise, when `membersState.status === 'ready'`, it is `` ` · ${membersState.members.length} members` ``, else `''`.
  - `aisState` (`:76`) holds `{ status, ais }` for the topic's AIs.

### Steps
1. **Non-General topics:** when both `membersState` and `aisState` are `'ready'`, the suffix is `` ` · ${membersState.members.length + aisState.ais.length} members` ``. While either is loading, keep `''` so the count never jumps. General stays `' · Everyone'`.
2. **No tests** (UI).

### Allowed files
- `apps/web/src/components/TopicPanel.tsx`
- `work/T-1836-panel-count-includes-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- "cards test" shows "Public topic · 4 members".
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/components/TopicPanel.tsx`: the panel header suffix for non-General topics now adds the topic's AIs to the people count (`membersState.members.length + aisState.ais.length`) once **both** `membersState` and `aisState` are `ready`; while either is loading the suffix stays `''`, so the number never jumps. General keeps ` · Everyone`.
- No tests added (UI-only change, per spec).

### Checks run

- `pnpm install`: completed (1151 packages added, peer warning about `@types/react-dom` in `apps/mobile`, pre-existing).
- `pnpm gate`: **GATE PASS**. Summary lines:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.1s)
PASS  typecheck  (5.0s)
PASS  effect  (1.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: the only changed package is `apps/web` and the change is UI-only. I did not run the live "cards test" topic myself; the acceptance check for "Public topic · 4 members" needs Julio's live environment.

### Notes for the lead

- Behaviour: for "cards test" (3 people + Deepseek), the suffix becomes ` · 4 members` once both lists load; while the AI list is loading the header shows no count rather than a count that later changes.
- The General topic is untouched (` · Everyone`).
- Only the two Allowed files changed (the component and this task file).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `d60744c85`.
- **The suffix** adds `aisState.ais.length` and waits for both lists to be ready; General keeps " · Everyone".
- **The lead checks** "cards test" live after the next push.

