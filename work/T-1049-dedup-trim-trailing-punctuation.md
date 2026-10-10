---
id: T-1049
title: "Dedup F8a: mobile markdown uses @zilar/chat-core's trimTrailingPunctuation instead of its own copy"
status: merged
milestone: M5
branch: task/T-1049-dedup-trim-trailing-punctuation
model: auto
effort: default
depends_on: [T-1040]
estimate: 0.1 day
---

# T-1049: One `trimTrailingPunctuation`

## Spec (written by Claude, do not edit)

### Why
`docs/audit/size-plan.md` §4.1 F8 lists `links.ts:24` `trimTrailingPunctuation` as a shared helper. The lead compared both copies (main, 2026-10-10):
- `apps/mobile/src/lib/markdown-inline.ts:62` has the same body as `packages/chat-core/src/links.ts:24` (`diff` empty);
- the helpers above it are also the same: `ALWAYS_STRIP`, `BRACKETS` and `countCharacter` (`markdown-inline.ts:48-59`, `links.ts:6-17`).

`apps/mobile/package.json:22` already depends on `@zilar/chat-core`, and `packages/chat-core/src/index.ts:8` re-exports `./links`.

### What to build
1. **chat-core:** in `packages/chat-core/src/links.ts`, add `export` to `trimTrailingPunctuation`. Change nothing else in that file.
2. **mobile:** in `apps/mobile/src/lib/markdown-inline.ts`:
   - delete the local `ALWAYS_STRIP`, `BRACKETS`, `countCharacter` and `trimTrailingPunctuation` (lines 48-~95), and their doc comment;
   - import `trimTrailingPunctuation` from `@zilar/chat-core`;
   - first check that the three helpers have no other user in the file (`grep`).
3. **Out of scope:** the server copy in `apps/server/src/media/extract.ts:41-95`, because the server does not depend on `@zilar/chat-core`.

### Read first
`AGENTS.md`, `packages/chat-core/src/links.ts`, and `apps/mobile/src/lib/markdown-inline.ts`.

### Allowed files
`packages/chat-core/src/links.ts`, `apps/mobile/src/lib/markdown-inline.ts`, `work/T-1049-dedup-trim-trailing-punctuation.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function trimTrailingPunctuation" apps/mobile packages` lists only `packages/chat-core/src/links.ts`.

---

## Report (written by the worker when done)

### What I did
- `packages/chat-core/src/links.ts`: added `export` to `trimTrailingPunctuation` (line 24). Nothing else in the file changed.
- `apps/mobile/src/lib/markdown-inline.ts`: changed the chat-core import to `import { parseUrl, trimTrailingPunctuation } from '@zilar/chat-core';` and deleted the local `ALWAYS_STRIP`, `BRACKETS`, `countCharacter`, `trimTrailingPunctuation` and their doc comment (old lines 48-81).
- Before deleting, I grepped the file: `ALWAYS_STRIP`/`BRACKETS`/`countCharacter` were used only by the local `trimTrailingPunctuation`, which was used only at old line 140. So no other user remained.

### Files changed
- `packages/chat-core/src/links.ts`
- `apps/mobile/src/lib/markdown-inline.ts`
- `work/T-1049-dedup-trim-trailing-punctuation.md`

### Commands and real results
- `pnpm install`: Done (already up to date, added turbo 2.11.4 / typescript 7.0.2 / vitest 5.0.2).
- `pnpm --filter @zilar/mobile typecheck`: passed, no output.
- `grep -rn "function trimTrailingPunctuation" apps/mobile packages` → only `packages/chat-core/src/links.ts:24:export function trimTrailingPunctuation(raw: string): string {` (Acceptance check passes).
- `pnpm gate` summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (1.4s)
  PASS  lint  (1.4s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test files exist for `markdown-inline.ts` or `links.ts` (searched `*.test.ts` in `apps/mobile/src` and `packages/chat-core/src`), so no per-file test run was needed; the gate's package test runs cover both packages.

### Deviations / notes
- None. Out-of-scope server copy in `apps/server/src/media/extract.ts` left untouched as specified.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `packages/chat-core/src/links.ts:24` gains `export` on `trimTrailingPunctuation`, and nothing else in that file changes;
  - `apps/mobile/src/lib/markdown-inline.ts` drops its local `ALWAYS_STRIP`, `BRACKETS`, `countCharacter` and `trimTrailingPunctuation`, and imports the chat-core one.
- **Same behaviour:** before the spec, the lead diffed the two bodies and helpers, and they are identical. `grep` now finds one `function trimTrailingPunctuation`, in chat-core.
- **Check:** the gate passed.
