---
id: T-0457
title: "Backgrounds A (shared): chatBackgroundPresets tokens (7 presets, slate default) in packages/ui-tokens"
status: todo
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

## Review (written by Claude)
