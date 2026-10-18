---
id: T-2037
title: "Share W2-f (phone): the Markdown renderer draws the shared chat-core AST (parseMessageMarkdown, T-2033) — nested lists, nested styles, task boxes, quotes with blocks, autolinks, mailto opens — and the hand-written parser (lib/markdown*.ts, table splitter) is deleted — about −400 lines; web unchanged"
status: merged
milestone: M5
branch: task/T-2037-phone-markdown-shared
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2037: The phone renders Markdown from the shared parser (share plan W2-f)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "one parser". T-2033 (merged at `8f920d2b6`) added a safe Markdown AST to chat-core, on the same mdast/micromark GFM stack web runs through react-markdown. The phone still uses about 560 lines of its own parser. That parser can't do:
- nested lists or nested styles;
- task boxes;
- quotes that hold lists or code;
- `www.` and email autolinks;
- opening `mailto:` links (`docs/audit/share-plan.md` §3.1).

So the same AI reply looks different on the phone. This task switches the phone renderer and deletes its parser. The UI has no tests (Julio's rule): the shared parser is already tested.

### Facts (read by the lead on 2026-10-18 at `8f920d2b6`)
- **The shared API.** Import it from `@zilar/chat-core/markdown-ast`, a subpath; **not** from `@zilar/chat-core`. In `packages/chat-core/src/markdown-ast.ts`:
  - `parseMessageMarkdown(text): MdBlock[]` (`:194`);
  - `MdBlock`:
    - `paragraph`, with `children`;
    - `heading`, with a `level` of 1-6 and `children`;
    - `code`, with an optional `lang` and a `value`;
    - `quote`, with `children: MdBlock[]`;
    - `list`, with `ordered`, an optional `start`, and `items: MdListItem[]`;
    - `table`, with `align: MdTableAlign[]` and `rows: MdInline[][][]`;
    - `hr`.
  - `MdInline`: `text`, `strong`, `em`, `del` (each with `children`), `code`, `link` (with `href` and `children`) and `break`;
  - `MdListItem` (`:28`). Read it for its `checked?` field and its children.
- **Phone files today:**
  - `apps/mobile/src/components/chat/markdown-text.tsx` (285 lines):
    - it imports `parseInline` and `parseMarkdown` from `../../lib/markdown` (`:13`), and `splitMarkdownTables` from `./markdown-table` (`:16`);
    - `renderInline` (`:38-`) maps the old `InlineNode`. Links go through `safeLinkTarget` and `Linking.openURL` (`:74-83`);
    - `BlockView` draws the blocks;
    - `toItems` (`:205-218`) merges the table split with the blocks;
    - `MarkdownText` (`:233-285`) is memoized and puts the `trailing` meta inline after a final paragraph;
    - it exports `BODY`, `CODE` and `INLINE_CODE_BACKGROUND`, which `apps/mobile/src/components/chat/link-text.tsx:13` imports. **Keep these exports.**
  - `apps/mobile/src/components/chat/markdown-table.tsx` (297 lines):
    - `MarkdownTable` renders a table;
    - `splitMarkdownTables` (`:120`) is a source-line table detector;
    - its types are `MarkdownTableData { header, align, rows: string[][] }` and `MarkdownPart`.
  - `apps/mobile/src/lib/markdown.ts` (14), `markdown-blocks.ts` (198) and `markdown-inline.ts` (182) are the old parser. Only `markdown-text.tsx` imports them.

### Steps
1. **The renderer.** Rewrite the parsing side of `markdown-text.tsx` to call `parseMessageMarkdown(text)` once, memoized on `text`, and render `MdBlock` and `MdInline` recursively:
   - nested `strong`, `em` and `del` as nested `<Text>` styles;
   - `link` opens with `Linking.openURL` after `safeLinkTarget`, and `mailto:` must open too;
   - `break` as a newline;
   - `quote` draws its child blocks inside the quote bar;
   - `list` draws nested lists indented, numbers from `start`, and `checked` as a box icon from `lucide-react-native` (`Square` or `SquareCheck`) instead of the bullet;
   - `table` uses `MarkdownTable`.

   Keep the styles, the block gap, the heading sizes, the trailing-meta rule and the `memo`.
2. **The table.** `markdown-table.tsx` keeps only the table view, taking `{ align, rows: MdInline[][][] }` and a `renderCell` callback. Delete `splitMarkdownTables`, `MarkdownPart` and the source-line detection.
3. **Delete the old parser:** `apps/mobile/src/lib/markdown.ts`, `apps/mobile/src/lib/markdown-blocks.ts` and `apps/mobile/src/lib/markdown-inline.ts`. Delete any test of them if one exists. First check with `git grep` that nothing else imports them.
4. **Dependencies.** Add `"@zilar/chat-core"` to `apps/mobile/package.json` only if it isn't there already; it is a workspace package, so no new third-party dependency. No other dependency changes.
5. **Size.** Product lines across these files must drop by **at least 350**, against 976 today. Report the counts. Every file stays at or under 400 lines. No tests (UI).

### Allowed files
- `apps/mobile/src/components/chat/markdown-text.tsx`
- `apps/mobile/src/components/chat/markdown-table.tsx`
- `apps/mobile/src/lib/markdown.ts`
- `apps/mobile/src/lib/markdown-blocks.ts`
- `apps/mobile/src/lib/markdown-inline.ts`
- `apps/mobile/package.json`
- `work/T-2037-phone-markdown-shared.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead emulator smoke** (a mock release build, an AI reply with nested lists, a task list, `mailto:`, a table and code):
  - it renders, with no red screen;
  - this proves the Hermes `\p{…}` regex in micromark works;
  - a streamed reply stays smooth.

---

## Report (written by the worker when done)

### What I did

- Rewrote `apps/mobile/src/components/chat/markdown-text.tsx` to parse once with
  `parseMessageMarkdown` from `@zilar/chat-core/markdown-ast`, memoized on `text`
  with `useMemo`. Blocks render recursively:
  - `strong`/`em`/`del` nest as `<Text>` styles, so nested styles work;
  - `link` opens via `Linking.openURL`; `mailto:` opens too (`safeLinkTarget`
    only allows http/https and `lib/links.ts` is outside my Allowed files, so
    the renderer opens a `mailto:` href directly after checking the prefix; the
    shared parser has already filtered every href through `safeMarkdownUrl`);
  - `break` becomes a newline;
  - `quote` renders its child blocks inside the quote bar, so it can hold lists
    and code;
  - `list` renders nested lists indented, ordered numbers from `start`, and
    `checked` items with a `Square`/`SquareCheck` lucide icon instead of the
    bullet;
  - `table` renders through `MarkdownTable`.
  - Kept `BODY`, `CODE`, `INLINE_CODE_BACKGROUND`, `CodeBlock`, the block gap,
    heading sizes, the trailing-meta rule and the `memo`.
- Rewrote `apps/mobile/src/components/chat/markdown-table.tsx` as a view only:
  it takes `{ align, rows: MdInline[][][], color, renderCell }`, uses the first
  row as the header, and estimates column widths from the flattened cell text.
  `splitMarkdownTables`, `MarkdownPart`, `MarkdownTableData` and all source-line
  detection are gone.
- Deleted `apps/mobile/src/lib/markdown.ts`, `markdown-blocks.ts` and
  `markdown-inline.ts` (`git rm`). `git grep` showed `markdown-text.tsx` was the
  only importer, and there were no tests of them.
- `apps/mobile/package.json` already had `"@zilar/chat-core": "workspace:*"`, so
  it is unchanged. No dependency changes.

Product lines (the five files in the task):

| file | before | after |
| --- | --- | --- |
| `markdown-text.tsx` | 285 | 329 |
| `markdown-table.tsx` | 297 | 146 |
| `lib/markdown.ts` | 14 | deleted |
| `lib/markdown-blocks.ts` | 198 | deleted |
| `lib/markdown-inline.ts` | 182 | deleted |
| **total** | **976** | **475** |

Net drop: **501 lines** (target: at least 350). Every remaining file is under
400 lines (`markdown-text.tsx` 329, `markdown-table.tsx` 146).

No tests were added or run individually: the spec says UI gets no tests and the
shared parser is already tested.

### Checks run

`pnpm gate` (first run) failed only on format:
```
FAIL  format  (0.8s)
[warn] apps/mobile/src/components/chat/markdown-text.tsx
```
I fixed it with `pnpm exec prettier --write apps/mobile/src/components/chat/markdown-text.tsx`
and re-ran the gate:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.6s)
PASS  lint  (0.8s)
PASS  typecheck  (1.1s)
PASS  effect  (0.9s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (2.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **`mailto:` and `safeLinkTarget`:** `apps/mobile/src/lib/links.ts` allows only
  `http`/`https` and is not in my Allowed files, so the renderer special-cases a
  `mailto:` href before calling `safeLinkTarget`. The hrefs come from
  `parseMessageMarkdown`, which already drops every scheme but http/https/mailto.
  If you would rather widen `safeLinkTarget` itself, that is a separate task.
- **Not tested on a device.** I did not build or run the app; the acceptance
  emulator smoke (nested lists, task list, `mailto:`, table, code, streaming,
  Hermes `\p{…}` regex in micromark) is still yours.
- Task-list icon rows use a flex row; ordinary list items stay a single flowing
  `Text` per item, per the existing measurement note in the code.


## Review (written by Claude)

Approved; the pre-review was clean, with 1 follow-up.
- **What changed.** The phone renders `parseMessageMarkdown` from `@zilar/chat-core/markdown-ast`, and its hand-written parser is gone: `lib/markdown.ts`, `markdown-blocks.ts`, `markdown-inline.ts` and the table splitter. About −500 product lines net.
- **Lead emulator check** (mock release build of this branch on Hermes, the Dev-1 "Review summary" reply):
  - H2 and H3 headings, bold, inline code, a nested bullet, a scrolling fenced code block, the 3-column table, the quote bar and the link all render;
  - no crash and no JS error, so micromark's `\p{…}` regex works on Hermes.
- **Follow-up:** input over 20,000 characters is cut, as on web's cap. Keep it.
