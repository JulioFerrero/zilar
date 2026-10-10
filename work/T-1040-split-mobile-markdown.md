---
id: T-1040
title: "Size split T115: apps/mobile/src/lib/markdown.ts (410 lines) into lib/{markdown-inline,markdown-blocks}.ts, the old path re-exports"
status: merged
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

### What I did

Split `apps/mobile/src/lib/markdown.ts` (410 lines at HEAD) into
`markdown-inline.ts` and `markdown-blocks.ts`; `markdown.ts` is now a thin
barrel that re-exports the same names. Code moved unchanged.

Mapping (per `docs/audit/size-plan.md` §2.3 #111):

- **`markdown-inline.ts`**: the `InlineNode` / `ListItem` / `Block` types (old
  18–38), `ALLOWED_PROTOCOLS` + `safeMarkdownUrl` (old 61–74),
  `trimTrailingPunctuation` and its helpers (old 76–109), and the inline rules +
  `parseInline` (old 111–245). The plan's ranges for this file (18–38, 111–245)
  omit 61–109 because its Dedup would delete `trimTrailingPunctuation` into
  chat-core; the task says to skip that Dedup, so it moves with its caller here.
- **`markdown-blocks.ts`**: the block regexes + `isBlank` / `isBlockStart` (old
  40–59), `MAX_LENGTH`, and `parseFence` / `parseList` / `parseQuote` /
  `parseMarkdown` (old 247–410).
- The original top-of-file doc comment became the barrel comment; each new file
  got a short doc comment in the style of prior splits (T-1030).
- `markdown-blocks.ts` imports `parseInline` and the `Block` / `InlineNode` /
  `ListItem` types from `markdown-inline.ts`. No cycle; no file outside the
  Allowed files changed.

**Dedup skipped** as instructed: the plan's `trimTrailingPunctuation` dedup would
remove the copy here in favour of `packages/chat-core/src/links.ts`, which
crosses out of this task into `packages/chat-core`. The link parsing code is
unchanged.

### Files changed

- `apps/mobile/src/lib/markdown.ts` (now a barrel)
- `apps/mobile/src/lib/markdown-inline.ts` (new)
- `apps/mobile/src/lib/markdown-blocks.ts` (new)
- `work/T-1040-split-mobile-markdown.md` (this report)

### Size (split-rules item 8)

| file | `wc -l` |
| --- | ---: |
| `markdown.ts` (old, at HEAD) | 410 |
| `markdown.ts` (barrel) | 14 |
| `markdown-inline.ts` | 217 |
| `markdown-blocks.ts` | 198 |

Every new file and the barrel are at most 400 lines.

### Exports before / after (split-rules item 8)

Before, `grep -E '^export'` on the old `markdown.ts`:

```
export type InlineNode =
export interface ListItem {
export type Block =
export function safeMarkdownUrl(url: string): string | undefined {
export function parseInline(text: string): InlineNode[] {
export function parseMarkdown(text: string): Block[] {
```

After, `grep -E '^export'` on the barrel plus the two new files:

```
export { safeMarkdownUrl, parseInline } from './markdown-inline';
export type { InlineNode, ListItem, Block } from './markdown-inline';
export { parseMarkdown } from './markdown-blocks';
export type InlineNode =
export interface ListItem {
export type Block =
export function safeMarkdownUrl(url: string): string | undefined {
export function parseInline(text: string): InlineNode[] {
export function parseMarkdown(text: string): Block[] {
```

Same six names, same kinds (three types, three functions); the barrel re-exports
all of them.

### Effect ratchet

No `// effect-plain:` marker added. The two new files and the barrel hit no hard
or weak signal and import no legacy library, so the effect map classifies them
`plain`; the gate's effect step passed. They are not on an exempt path
(`apps/mobile/src/lib/` is not exempt), so no marker is applicable.

### Commands and results

- `pnpm --filter @zilar/mobile typecheck`: **PASS** (`tsc --noEmit`, no output).
- No single test file was run while working: no test is named after the markdown
  files (`apps/mobile/src/lib` has no `markdown*.test.ts`), and no test imports
  the module.
- `pnpm gate` from the repo root:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.8s)
PASS  lint  (1.4s)
PASS  typecheck  (3.8s)
PASS  effect  (0.9s)
PASS  tests @zilar/mobile  (1.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The mobile test step ran the tests directly in `apps/mobile/src/lib` (the
nearest-folder rule, since no test is named `markdown.*`): `auth-api.test.ts`,
`auth.test.ts`, `session-token.test.ts` — all passed.

### Deviations / open questions

- The `Block` and `ListItem` types live in `markdown-inline.ts` because the
  plan's range 18–38 holds all three type declarations and is assigned to that
  file. They read as block concepts, but the split rules say to follow the
  plan's ranges and move code unchanged, so they stay where the plan puts them.
- Nothing else; no blocked items.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `markdown.ts` (410 lines) is now a 14-line barrel, plus `markdown-inline` (217) and `markdown-blocks` (198).
- **The lead's line check:** the old file's non-import code lines against the new files'. They are identical, so the link parsing is unchanged.
- **The lead's phone smoke** (mock, Dev AI chat): the review summary renders headings, bold, inline code, the list, the code block, the quote and the link.
- **Not supported, here or on main:** the table shows as raw `|` text, because mobile markdown has no table support. The code is unchanged, so main does the same. It is a follow-up.
- **Check:** the gate passed.
