---
id: T-0242
title: "ui-tokens follow-up: the chat dot grid comes from the package, the wrong recorded difference goes, drift tests tightened"
status: merged
milestone: M5
branch: task/T-0242-tokens-dot-grid-cleanup
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0240]
estimate: 0.2 day
---

# T-0242: Dot grid from tokens, drift test cleanup

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: the chat dot grid on both web and mobile. The lead checked: mobile already draws it. `apps/mobile/src/components/chat/chat-background.tsx` is an SVG pattern, 22 px cell, `Circle r=1` `#1c1c1c` on `#0a0a0a`, used 4 times in `apps/mobile/src/app/chat/[id].tsx` (lines 323, 475, 654, 829). So the `chat-background` entry in `platformDifferences` (T-0240) is wrong: only the unused CSS variable differs. This task makes the grid values come from `@zilar/ui-tokens` on both sides and fixes the 4 test nits from the T-0240 pre-review. No visual change.

### Verified facts (do not re-derive)
- `packages/ui-tokens/src/index.ts`: `platformDifferences` entries `chat-background` (lines 99-104) and `chat-background-literal` (lines 105-110). `key-text-shadow` (lines 111-116) records the web value as `'0 1px 0 rgba(255,255,255,.7)'`, while `apps/web/src/index.css` line 88 says `0 1px 0 rgba(255, 255, 255, 0.7)`.
- Web grid: `apps/web/src/index.css` line 133, `--chat-background: radial-gradient(#1c1c1c 1px, transparent 1px) 0 0 / 22px 22px var(--panel);`.
- Mobile: `apps/mobile/src/global.css` line 52 `--chat-background: #0a0a0a;`. `CHAT_BACKGROUND` in `apps/mobile/src/lib/colors.ts` is used for the auth and join gradients (NameForm, join, welcome/handle, invite), not the chat. Keep it.
- Drift tests: `apps/web/src/lib/tokens-drift.test.ts` (line 234 checks `chat-background` contains `radial-gradient`) and `apps/mobile/src/lib/tokens-drift.test.ts` (lines 67-69: `chat-background` is `#0a0a0a`, a skip check, and a vacuous `depth.keyPrimaryShadow.length > 0`).

### What to build
1. `packages/ui-tokens/src/index.ts`: add `chatGrid = { cell: 22, dotRadius: 1, dot: '#1c1c1c', background: palette.panel }`. Remove the `chat-background` entry from `platformDifferences`. Rename `chat-background-literal` to `auth-gradient-background`, with a note that mobile `CHAT_BACKGROUND` is the auth screens' gradient (page black). Write the `key-text-shadow` web value exactly as the CSS writes it.
2. `apps/mobile/src/components/chat/chat-background.tsx`: read cell, radius, dot and background from `chatGrid`. The rendered SVG is identical.
3. Web drift test: check that `--chat-background` contains `chatGrid.dot`, `${chatGrid.dotRadius}px` and `${chatGrid.cell}px ${chatGrid.cell}px`. Check `iconColor` inside the `key-icon` utility block only, not the whole file. Replace each `> 10` guard with the exact count of checked values.
4. Mobile drift test: remove the vacuous assertion. The `--chat-background` CSS variable stays `#0a0a0a`: it is unused by the chat (the SVG draws the grid). Assert that and say so in a comment. Use an exact count guard.

### Read first
`AGENTS.md`, `packages/ui-tokens/src/index.ts`, `apps/mobile/src/components/chat/chat-background.tsx`, `apps/web/src/lib/tokens-drift.test.ts`, `apps/mobile/src/lib/tokens-drift.test.ts`.

### Allowed files
`packages/ui-tokens/src/index.ts`, `packages/ui-tokens/src/index.test.ts`, `apps/mobile/src/components/chat/chat-background.tsx`, `apps/mobile/src/lib/tokens-drift.test.ts`, `apps/web/src/lib/tokens-drift.test.ts`, `work/T-0242-tokens-dot-grid-cleanup.md`.

### Checks
```bash
pnpm --filter @zilar/ui-tokens test --reporter=dot
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts
pnpm gate
```

### Acceptance
- The dot grid on both apps reads its numbers from `@zilar/ui-tokens`, and nothing looks different.
- `platformDifferences` lists only real differences.
- The drift tests have exact count guards and no vacuous assertion.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Custom chat backgrounds (images or coloured dots; a later feature), web CSS changes.

---

## Report (written by the worker when done)

### What I did
- `packages/ui-tokens/src/index.ts`: added `chatGrid = { cell: 22, dotRadius: 1, dot: '#1c1c1c', background: palette.panel }`. Removed the `chat-background` entry from `platformDifferences` (the grid is shared now, not a difference). Renamed `chat-background-literal` to `auth-gradient-background` with a note that mobile `CHAT_BACKGROUND` is the auth screens' gradient (page black). Wrote the `key-text-shadow` web value exactly as the CSS writes it (`0 1px 0 rgba(255, 255, 255, 0.7)`, verified against `apps/web/src/index.css` line 88).
- `apps/mobile/src/components/chat/chat-background.tsx`: reads cell/radius/dot/background from `chatGrid`. Rendered values identical (22, 1, `#1c1c1c`, `#0a0a0a`); no visual change.
- `apps/web/src/lib/tokens-drift.test.ts`: `--chat-background` now asserts it contains `chatGrid.dot`, `1px`, `22px 22px` instead of a bare `radial-gradient` check. `iconColor` is checked inside the `key-icon` utility block only. Count guard is exact (`23`).
- `apps/mobile/src/lib/tokens-drift.test.ts`: removed the vacuous `depth.keyPrimaryShadow.length > 0` assertion (and the now-unused `depth` import) and the `SKIPPED.has('chat-background')` skip check. Asserts `--chat-background` stays `#0a0a0a` with a comment that it is unused by the chat (the SVG draws the grid). Count guard is exact (`22`).
- `CHAT_BACKGROUND` in mobile `colors.ts` untouched per spec. No CSS files changed.

### Files changed
`packages/ui-tokens/src/index.ts`, `apps/mobile/src/components/chat/chat-background.tsx`, `apps/web/src/lib/tokens-drift.test.ts`, `apps/mobile/src/lib/tokens-drift.test.ts`, `work/T-0242-tokens-dot-grid-cleanup.md`.

### Commands and real results
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/ui-tokens test --reporter=dot`: 1 file, 5 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts`: 1 file, 7 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/tokens-drift.test.ts`: 1 file, 2 tests passed.
- `pnpm gate` (first run): GATE FAIL on `format` only (prettier flagged my two hand-edited files). Fixed with `prettier --write` on those two Allowed files. Second run: `PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/mobile, PASS tests @zilar/ui-tokens, PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Problems / deviations
- None from the spec. Exact counts verified by passing runs: web checks 23 palette entries, mobile 22.

### Security checklist
- No secrets, no routes, no deletes/updates, no caps, no audit entries touched. N/A beyond that.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean, with 2 nits:
- the comment above `platformDifferences` still says Julio decides the dot grid later;
- an uncommitted lockfile peer flip sits in the worktree, not in the branch.

I read the `chat-background.tsx` diff: the same SVG, with its numbers now taken from `chatGrid`. Fix the stale comment the next time the tokens are touched.
