---
id: T-1040
title: "Size split T115: apps/mobile/src/lib/markdown.ts (410 lines) into lib/{markdown-inline,markdown-blocks}.ts, the old path re-exports"
status: todo
milestone: M5
branch: task/T-1040-split-mobile-markdown
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1040: Split the mobile `markdown.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/lib/markdown.ts` is 410 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #111 (task T115): `lib/markdown-inline.ts` and `lib/markdown-blocks.ts`, under `apps/mobile/src/`. `markdown.ts` re-exports every name it exports today.

- **Move unchanged:** move the code as it is, and skip the Dedup, because it crosses into `packages/chat-core`.
- **Link handling:** the link parsing decides which URLs become tappable links, so not one line of it changes. `trimTrailingPunctuation` (`markdown.ts:76-109`) moves with its callers.

The lead runs a phone smoke of a chat with formatted messages in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #111, and `apps/mobile/src/lib/markdown.ts`.

### Allowed files
`apps/mobile/src/lib/markdown.ts`, `apps/mobile/src/lib/markdown-inline.ts`, `apps/mobile/src/lib/markdown-blocks.ts`, `work/T-1040-split-mobile-markdown.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
