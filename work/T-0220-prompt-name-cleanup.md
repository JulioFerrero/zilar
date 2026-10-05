---
id: T-0220
title: "Lead tooling: 'prereview-resume' in PromptName (no cast) and one task-file import in autopilot.ts"
status: planned
milestone: M5
branch: task/T-0220-prompt-name-cleanup
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0216]
estimate: 0.1 day
---

# T-0220: PromptName cleanup

## Spec (written by Claude, do not edit)

### Why
Follow-up and nit of T-0216's pre-review. T-0216 added the prompt `packages/devtools/prompts/prereview-resume.md` but could not extend the `PromptName` union, so `autopilot.ts` casts the name.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/prompts.ts` lines 6-16: `export type PromptName = 'worker' | 'switch' | 'resume' | 'nudge' | 'prereview' | 'scout' | 'qa' | 'autofix' | 'doctor' | 'fresh';`
- `packages/devtools/src/lead/autopilot.ts` line 207: `loadPrompt(deps.promptsDirPath, 'prereview-resume' as PromptName)`.
- `packages/devtools/src/lead/autopilot.ts` lines 24-25: `import { extractBlockedText, parseFrontMatter } from './task-file.js';` then `import { splitModel } from './task-file.js';`.
- `packages/devtools/src/lead/prompts.test.ts` line 19 already lists `'prereview-resume'`.

### What to build
1. Add `| 'prereview-resume'` to `PromptName` in `prompts.ts`.
2. In `autopilot.ts` line 207, drop `as PromptName` (pass `'prereview-resume'` directly). If `PromptName` is then unused elsewhere in the file, keep the import only if line 178 still uses it (it does).
3. Merge lines 24-25 into one import: `import { extractBlockedText, parseFrontMatter, splitModel } from './task-file.js';`.
Nothing else.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/prompts.ts` (lines 1-30), `packages/devtools/src/lead/autopilot.ts` (lines 1-30 and 170-215).

### Allowed files
`packages/devtools/src/lead/prompts.ts`, `packages/devtools/src/lead/autopilot.ts`, `work/T-0220-prompt-name-cleanup.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/prompts.test.ts src/lead/autopilot.test.ts
pnpm gate
```

### Acceptance
- No `as PromptName` in `autopilot.ts`; one import from `./task-file.js`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Any behaviour change.

---

## Report (written by the worker when done)

## Review (written by Claude)
