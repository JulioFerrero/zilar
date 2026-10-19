---
id: T-2192
title: "Tests only for crucial code: delete 12 chat-core tests of display-only helpers (Julio's 10-10 rule); product code unchanged"
status: merged
milestone: M5
branch: task/T-2192-trim-cosmetic-tests
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-2192: Delete chat-core tests of display-only helpers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-10 (`CLAUDE.md`, Hard rules): tests only for crucial code, meaning auth and keys, permissions and money, and the message pipeline. There are no UI tests. These 12 chat-core test files cover display-only helpers: sticker motion, smooth-text pacing, sender colours, avatar seeds, titles, duration text, sticker recents, the topic activity line, light Markdown, person links and handle error text.

### Facts (the lead read these on 2026-10-19)
Delete these files, 669 lines in all:
- `packages/chat-core/src/sticker-motion.test.ts` (108)
- `packages/chat-core/src/smooth-text.test.ts` (134)
- `packages/chat-core/src/sender-color.test.ts` (40)
- `packages/chat-core/src/avatar-identity.test.ts` (39)
- `packages/chat-core/src/avatar-seed.test.ts` (20)
- `packages/chat-core/src/approval-title.test.ts` (19)
- `packages/chat-core/src/format-duration.test.ts` (11)
- `packages/chat-core/src/sticker-recents.test.ts` (61)
- `packages/chat-core/src/topic-activity.test.ts` (84)
- `packages/chat-core/src/light-markdown.test.ts` (29)
- `packages/chat-core/src/person-link.test.ts` (74)
- `packages/chat-core/src/handle-errors.test.ts` (50)

These chat-core tests **stay**, because they cover keys, money, permissions, URL and media safety or the message pipeline:
- `messages`, `edits`, `reactions`, `topics`;
- `files`, `url`, `media`, `markdown-ast`;
- `connection-check`, `ai-health`, `ai-limits`;
- `store/ledger`.

### Steps
1. Delete the 12 files listed above. Change no other file.
2. If a test helper or fixture is used only by a deleted test, delete it too and list it in the Report. Otherwise leave it.
3. Run `pnpm gate`.

### Allowed files
- The 12 test files listed above
- `packages/chat-core/src/**` test-only helpers that only those tests used
- `work/T-2192-trim-cosmetic-tests.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The diff only deletes test files (and their test-only helpers).

## Report

### What I did
- Deleted the 12 chat-core test files listed in the spec (669 lines).
- Checked their imports: all came from product modules (`./sticker-motion`, `./smooth-text`, `./sender-color`, `./avatar`, `./approval-title`, `./format-duration`, `./sticker-recents`, `./topic-activity`, `./light-markdown`, `./person-link`, `./handle-errors`, `./messages`, `./types`) or `vitest`. No test-only helper or fixture was used exclusively by them, so no helper was deleted. Product code unchanged.
- No product module imports a deleted test file; the deleted tests imported other tests' subjects, not the reverse.

### Files changed
Deleted (12):
- `packages/chat-core/src/sticker-motion.test.ts`
- `packages/chat-core/src/smooth-text.test.ts`
- `packages/chat-core/src/sender-color.test.ts`
- `packages/chat-core/src/avatar-identity.test.ts`
- `packages/chat-core/src/avatar-seed.test.ts`
- `packages/chat-core/src/approval-title.test.ts`
- `packages/chat-core/src/format-duration.test.ts`
- `packages/chat-core/src/sticker-recents.test.ts`
- `packages/chat-core/src/topic-activity.test.ts`
- `packages/chat-core/src/light-markdown.test.ts`
- `packages/chat-core/src/person-link.test.ts`
- `packages/chat-core/src/handle-errors.test.ts`

Modified only: `work/T-2192-trim-cosmetic-tests.md` (status and this Report).

### Commands and results
- `pnpm install --silent`: exit 0, no output.
- `pnpm gate` (repo root): GATE PASS. Summary lines:
  - `gate: 13 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (2.3s)`
  - `SKIP effect (no source files changed)`
  - `PASS  build @zilar/server  (0.7s)`
  - `SKIP tests @zilar/chat-core (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`
- I ran no single test files: the change only deletes tests, and the gate reported no nearby test files for chat-core.

### Problems
None.

### Deviations from the spec
None. The spec's step 2 (delete unused test-only helpers) did not apply.

### Open questions
None.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings).

The diff only deletes the 12 listed chat-core test files of display-only helpers: 669 test lines, product code unchanged (Julio's 10-10 rule).

The tests for messages, edits, reactions, topics, files, URL, media, Markdown parsing, the connection check, AI health and limits, and the ledger stay.
