---
id: T-2055
title: "Search snippets (server): strip Markdown markup from every search hit's snippet before it is sent (heading/quote/list markers, **, __, ~~, backticks, [text](url) → text) and remap the highlight marks to the stripped text — web and phone stop showing '## Review summary … **both**' in Messages results"
status: merged
milestone: M5
branch: task/T-2055-search-snippet-markdown
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2055: Plain-text search snippets

## Spec (written by Claude, do not edit)

### Why
The lead saw this on 2026-10-18 in the web mock's chat-list search for "mar". The Messages section shows raw Markdown from AI replies: `## Review summary I read **both** …`. The bubbles render Markdown, so the snippet should read as plain text. Fixing it on the server fixes web and every phone build at once.

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **One exit point.** `apps/server/src/search/routes.ts` (310 lines) builds every hit through `pushItem(row, chatJid, key, snippet, marks, match)` (`:163-182`), with `{ snippet, marks }` (code-point offsets, half-open `[start, end)`).
  - Exact hits come from `headlineToSnippet(row.headline)` and then `exactInCodeMarks` (`:218-223`).
  - Fuzzy hits come from `match.ts` (`:195-216`), further down the same file (`:225+`).
- **The snippet helpers.** `apps/server/src/search/snippet.ts` (105 lines) holds `headlineToSnippet`. `MarkedSnippet` is defined in `match.ts`.
- **The client contract.** The client splits by code points (`[...snippet]`) and drops out-of-range marks, so the snippet and marks must stay consistent.
- **Tests.** The existing tests are `apps/server/src/search/routes.test.ts` and `edit-overlay.test.ts`.

### Steps
1. **The strip function.** In `apps/server/src/search/snippet.ts`, add `plainSnippet({ snippet, marks }): MarkedSnippet`.
   - It works over code points, with a keep-mask. It removes:
     - at a line start (start of text or after `\n`): `#`–`######` plus the following spaces; `>` plus one optional space; `-`, `*` or `+` plus a space;
     - anywhere: `**`, `__`, `~~` and backticks;
     - links: `[text](url)` and `![text](url)` keep only `text`.
   - Then it collapses each run of whitespace, newlines included, to one space and trims both ends.
   - **Marks:** each mark `[s, e]` becomes `[kept(s), kept(e)]`, where `kept(i)` is the number of kept code points before index `i`. A mark that becomes empty is dropped.
   - A single `*` or `_` stays, because it can be real text.
2. **Use it.** In `routes.ts`, `pushItem` passes its snippet and marks through `plainSnippet` once, so exact and fuzzy hits both get it. Keep `routes.ts` at or under 400 lines.
3. **Check by hand.** Run `plainSnippet` on `## Review summary I read **both**` with a mark on `both` (code points 25 to 29). Expect `Review summary I read both` with the mark `[22, 26]`. Paste that output into the Report. No new test file: search isn't a crucial-test area.

### Allowed files
- `apps/server/src/search/snippet.ts`
- `apps/server/src/search/routes.ts`
- `work/T-2055-search-snippet-markdown.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/search/routes.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The existing search tests pass, and the gate passes.
- **Lead check, live after deploy:** an AI Markdown reply found via search shows plain text with the term highlighted.

---

## Report (written by the worker when done)

### What I did
- Added `plainSnippet({ snippet, marks }): MarkedSnippet` to `apps/server/src/search/snippet.ts`. It works over code points and removes line-start heading (`#`–`######` plus following spaces), blockquote (`>` plus one optional space) and list (`-`, `*`, `+` plus a space) markers, any `**`, `__`, `~~` and backticks, and the delimiters of `[text](url)` / `![text](url)` while keeping `text`. Single `*` and `_` stay. It then collapses whitespace runs (newlines included) to one space and trims both ends.
- Marks are remapped with a code-point boundary array (`kept(i)`), and marks that become empty are dropped, so the client's `[...snippet]` offsets stay consistent.
- In `apps/server/src/search/routes.ts`, `pushItem` now runs its snippet and marks through `plainSnippet` once, so both exact and fuzzy hits get plain text. `routes.ts` is 312 lines.
- Files changed: `apps/server/src/search/snippet.ts`, `apps/server/src/search/routes.ts`, this task file.

### Checks run
- `pnpm install`: done (18.5s, "Done").
- Hand check (tsx, final code):
  `plainSnippet({ snippet: "## Review summary I read **both**", marks: [[27, 31]] })`
  → `{"snippet":"Review summary I read both","marks":[[22,26]]}` — matches the expected output. (Used the lead's corrected mark `[27, 31)`.)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/routes.test.ts`: 1 file passed, 2 tests passed.
- `pnpm gate` (repo root) summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.9s)
  PASS  effect  (2.3s)
  PASS  build @zilar/server  (0.7s)
  PASS  tests @zilar/server  (10.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- No new test file, as the spec says. Besides the required hand check, I also ran the function by hand on: `"- [link](https://x.y) `code` ~~old~~"` → `link code old`; `"> quote __bold__\nnext\tline"` → `quote bold next line`; `"a   b *real* _x_"` → `a b *real* _x_` (single markers kept). All match the spec.
- Link parsing is non-nested and a URL ends at the first `)`, which is enough for the message text seen so far; a URL containing `)` would keep its tail as text.
- `pushItem` keeps its existing `(snippet, marks, match)` parameters; `plainSnippet` is applied inside it once, so exact and fuzzy hits share exactly one exit point.

## Review (written by Claude)

Approved; the pre-review was clean, with 3 nits.
- **What changed.** `plainSnippet` strips heading, quote and list markers, `**`, `__`, `~~`, backticks and link syntax, then collapses whitespace and remaps the marks over code points. It runs once in `pushItem`, so exact and fuzzy hits both get it.
- **Hand check:** `## Review summary I read **both**` with the mark [27, 31) gives `Review summary I read both` with the mark [22, 26]. The spec's "25 to 29" was the lead's error, corrected mid-task.
- **Nits accepted:** CRLF line starts and a `)` inside a link URL are rare and cosmetic.
- **Still to do:** the live check after deploy.
