---
id: T-0457
title: "Backgrounds A (shared): chatBackgroundPresets tokens (7 presets, slate default) in packages/ui-tokens"
status: merged
milestone: M5
branch: task/T-0457-background-preset-tokens
model: auto
effort: low
depends_on: [T-0456]
estimate: 0.1 day
---

# T-0457: background preset tokens

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, task A. Web, mobile and the server's validation all read one preset list.

### Verified facts (do not re-derive)
- **`packages/ui-tokens/src/index.ts:53-58`:** `export const chatGrid = { cell: 22, dotRadius: 1, dot: '#1c1c1c', background: palette.panel } as const;`, where `palette.panel` is `'#0a0a0a'` (line 12).
- **Tests** live in `packages/ui-tokens/src/index.test.ts`.

### What to build
1. **In `packages/ui-tokens/src/index.ts`,** after `chatGrid`, add these exports, with a short doc comment pointing to the plan §8:
   ```ts
   export const CHAT_BACKGROUND_PRESET_IDS = ['slate', 'gold', 'blue', 'navy', 'forest', 'wine', 'amber'] as const;
   export type ChatBackgroundPresetId = (typeof CHAT_BACKGROUND_PRESET_IDS)[number];
   export const DEFAULT_CHAT_BACKGROUND_PRESET: ChatBackgroundPresetId = 'slate';
   export const chatBackgroundPresets: Record<ChatBackgroundPresetId, { ground: string; dot: string }> = { ... };
   ```
   The values are exactly:

   | id | ground | dot |
   | --- | --- | --- |
   | slate | `palette.panel` | `chatGrid.dot` |
   | gold | `#0a0a0a` | `#715625` |
   | blue | `#0a0a0a` | `#204074` |
   | navy | `#0b1322` | `#1d3357` |
   | forest | `#0a1510` | `#1b3a2a` |
   | wine | `#160a10` | `#42192b` |
   | amber | `#15100a` | `#4a3818` |

2. **In `packages/ui-tokens/src/index.test.ts`,** test that:
   - the ids are unique and match the keys of `chatBackgroundPresets`;
   - the default is `slate`, and `slate` equals `chatGrid`'s dot and background;
   - every ground and dot is a 7-character `#rrggbb`;
   - every ground's relative luminance is below that of `palette.bubbleIn` (`#161616`). Use a small sRGB luminance helper inside the test.

### Read first
`AGENTS.md`, `packages/ui-tokens/src/index.ts`, `packages/ui-tokens/src/index.test.ts`, `docs/audit/chat-backgrounds-plan.md` §8.

### Allowed files
`packages/ui-tokens/src/index.ts`, `packages/ui-tokens/src/index.test.ts`, `work/T-0457-background-preset-tokens.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/ui-tokens test --reporter=dot
pnpm gate
```

### Acceptance
- The 7 presets are exported with exactly the values above and are tested.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added the chat background preset tokens to `packages/ui-tokens/src/index.ts` immediately after `chatGrid`, with a doc comment pointing to `docs/audit/chat-backgrounds-plan.md` §8: `CHAT_BACKGROUND_PRESET_IDS`, `ChatBackgroundPresetId`, `DEFAULT_CHAT_BACKGROUND_PRESET` (`'slate'`) and `chatBackgroundPresets` with exactly the 7 id/ground/dot values from the spec table (`slate`'s ground/dot alias `palette.panel` / `chatGrid.dot`).
- Extended `packages/ui-tokens/src/index.test.ts` with a `chatBackgroundPresets` describe block: ids unique and equal to the preset keys; default is `slate` and slate matches `chatGrid`; every ground and dot is a 7-character `#rrggbb`; every ground's sRGB relative luminance is below `palette.bubbleIn` (`#161616`). A small local `luminance()` helper implements the sRGB formula.

### Files changed
- `packages/ui-tokens/src/index.ts`
- `packages/ui-tokens/src/index.test.ts`
- `work/T-0457-background-preset-tokens.md` (status + report only)

### Commands and results
- `pnpm install` — exit 0 (1170 packages, warnings about deprecated subdeps and one unmet peer in `apps/mobile`, pre-existing).
- `pnpm --filter @zilar/ui-tokens test --maxWorkers=2 --reporter=dot src/index.test.ts` — 1 test file passed, 9 tests passed.
- `pnpm gate` (first run) — GATE FAIL: only step `FAIL format (23.1s)`; Prettier flagged `packages/ui-tokens/src/index.test.ts` (long `.toEqual([...])` line). Scope line already said "every changed file is inside the Allowed files".
- `pnpm exec prettier --write packages/ui-tokens/src/index.test.ts` — reformatted the one file.
- `pnpm gate` (second run) — GATE PASS. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (18.0s)
  PASS  lint  (1.4s)
  PASS  typecheck  (2.0s)
  PASS  tests @zilar/ui-tokens  (0.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- First gate run failed on formatting only; fixed by formatting the single file, no check was disabled. No spec deviation. No other test broke.

### Blocked / needs a decision
- None.

## Review (written by Claude)

Approved (lead, 2026-10-07). The 7 presets are exported with exactly the spec values; slate reuses chatGrid. Tests cover unique ids, the default, the hex shape and luminance below bubbleIn. Pre-review clean.
