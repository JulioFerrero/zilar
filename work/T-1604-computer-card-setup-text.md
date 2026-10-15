---
id: T-1604
title: "AI computers T4 (UI text): the Zilar computer option says 'Needs setup on your server' instead of 'Not available yet' (web and phone), and the contract comment matches"
status: merged
milestone: M5
branch: task/T-1604-computer-card-setup-text
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1604: "Needs setup on your server"

## Spec (written by Claude, do not edit)

### Why
- **The plan:** `docs/deploy/ai-computers-auto-plan.md` §1.5 (T-1599). The lead decided the wording on 2026-10-15.
- **Why the change:** once computers turn on with one host command, "Not available yet" no longer tells an admin what to do. The command itself lives in the installer and the install docs.
- **Text only:** no layout change.

### Facts (the lead read them on 2026-10-15)
- `apps/web/src/components/ais/AiComputerSection.tsx:39`: `description: cloud ? 'Runs on a Zilar cloud computer' : 'Not available yet',`
- `apps/mobile/src/components/ais/computer-picker.tsx:38`: the same line.
- `packages/api-contract/src/ais.ts:28-30`: "// T-1425: what the Computer picker may offer. `cloud` is true when the server / has the cloud desk client wired; when it is false the picker disables the / cloud option with "Not available yet"."

### Steps
1. **In both files,** change `'Not available yet'` to `'Needs setup on your server'`.
2. **Rewrite the contract comment** to: "T-1425: what the Computer picker may offer. `cloud` is true when the server's desk agent answers ready (gVisor installed on the host); when it is false the picker disables the cloud option with "Needs setup on your server"."

### Tests
None (UI text).

### Allowed files
- `apps/web/src/components/ais/AiComputerSection.tsx`
- `apps/mobile/src/components/ais/computer-picker.tsx`
- `packages/api-contract/src/ais.ts`
- `work/T-1604-computer-card-setup-text.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n "Not available yet" -- apps/web/src/components/ais apps/mobile/src/components/ais packages/api-contract/src/ais.ts` finds nothing.

---

## Report (written by the worker when done)

### What I did
- Changed the cloud option description from `'Not available yet'` to `'Needs setup on your server'` in `apps/web/src/components/ais/AiComputerSection.tsx:39` and `apps/mobile/src/components/ais/computer-picker.tsx:38`.
- Rewrote the contract comment in `packages/api-contract/src/ais.ts:28-30` to the lead's wording.
- No layout or behaviour change.

### Checks run
- `pnpm install`: completed, 17 workspace projects, no added dependencies.
- `git grep -n "Not available yet" -- apps/web/src/components/ais apps/mobile/src/components/ais packages/api-contract/src/ais.ts`: no matches (exit 1), so the acceptance check passes.
- `pnpm gate` (from repo root): exit 0.
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen) (1.5s)`
  - `PASS format (0.8s)`
  - `PASS lint (1.2s)`
  - `PASS typecheck (9.0s)`
  - `PASS effect (0.9s)`
  - `SKIP tests @zilar/api-contract (no nearby test files)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No single test files were run: the spec's Tests section says "None (UI text)" and the gate reported no nearby test files.

### Notes for the lead
- The 4 changed files are the three allowed source files plus this task file.
- No blockers, no deviations from the spec.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff** is exactly the two description strings (web and phone) and the contract comment.
- **Safe to merge before T-1602, T-1603 and T-1605:** while the server still reports `cloud: false`, the card simply says "Needs setup on your server", which is true for live today (no gVisor on the VPS).
