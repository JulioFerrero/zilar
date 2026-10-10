---
id: T-1049
title: "Dedup F8a: mobile markdown uses @zilar/chat-core's trimTrailingPunctuation instead of its own copy"
status: todo
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

## Review (written by Claude)
