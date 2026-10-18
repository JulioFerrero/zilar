---
id: T-2033
title: "Share W1-n: one safe Markdown AST in chat-core (parseMessageMarkdown on the mdast/micromark GFM stack web already runs) behind a subpath export @zilar/chat-core/markdown-ast — URL allow-list http/https/mailto, raw HTML dropped, images become alt text, 20k cap — with tests; no app uses it yet"
status: merged
milestone: M5
branch: task/T-2033-markdown-ast-chat-core
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2033: A safe Markdown AST in chat-core (share plan W1-n)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "one parser". He approved adding `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm` to `packages/chat-core`, at the versions already in the lockfile (memory `decisions-1018-share`, and `docs/audit/share-plan.md` §3.1 and §7 Q1).
- **The problem.** Today the phone hand-rolls a Markdown parser of about 564 lines. It can't do nested lists, nested styles, task lists, quotes with blocks, or `www.` and email autolinks, so the same AI reply renders differently on web and phone.
- **This task** builds the shared parser. W2-f (next) switches the phone renderer to it and deletes the phone parser.
- **Tests are required** (the URL allow-list is a security rule).

### Facts (read by the lead on 2026-10-18 at `c0f134fa7`)
- **Lockfile versions** already present through react-markdown: `mdast-util-from-markdown@2.0.3`, `mdast-util-gfm@3.1.0` and `micromark-extension-gfm@3.0.0`. Pin exactly these, so pnpm adds no second copy.
- **The package.** `packages/chat-core/package.json`:
  - `"exports": { ".": "./src/index.ts" }`;
  - dependencies are only `@zilar/protocol` and `@zilar/ball-avatar`.
- **The server imports `@zilar/chat-core`** (for example `apps/server/src/ai/catalog.ts`). Its production build fails if its bundle imports a package that isn't a server production dependency (T-2025). So **don't export the new module from `packages/chat-core/src/index.ts`**. Use a subpath export instead.
- **What the phone parser renders today:**
  - `apps/mobile/src/lib/markdown-inline.ts` defines `InlineNode` (text, bold, italic, strike, code, link) and `Block` (paragraph, heading 1-6, code with language, quote, list ordered or bullet).
  - Links pass only for `http:`, `https:` and `mailto:`. Images render as alt text, and raw HTML stays plain text.
  - The input cap is 20,000 characters (`apps/mobile/src/lib/markdown-blocks.ts:12`).
- **Web** (`apps/web/src/components/MarkdownText.tsx`) allows only http, https and mailto, and renders images as alt text.

### Steps
1. **Dependencies.** Add the three packages to `packages/chat-core/package.json` `dependencies` at the exact versions above. Run `pnpm install`, then check that `pnpm-lock.yaml` didn't add a second version of any of them.
2. **The subpath export.** Add `"./markdown-ast": "./src/markdown-ast.ts"` to `exports`. Keep `"."` as it is.
3. **The parser.** Create `packages/chat-core/src/markdown-ast.ts`, at most about 200 lines:
   - `parseMessageMarkdown(text: string): MdBlock[]`. Parse with `fromMarkdown(text.slice(0, 20000), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })`, then map to a small, safe AST.
   - `MdBlock`:
     - `paragraph`, with `children: MdInline[]`;
     - `heading`, with a `level` and `children`;
     - `code`, with an optional `lang` and a `value`;
     - `quote`, with `children: MdBlock[]`;
     - `list`, with `ordered`, an optional `start`, and `items: { checked?: boolean; children: MdBlock[] }[]`;
     - `table`, with `align` and `rows: MdInline[][][]`;
     - `hr`.
   - `MdInline`:
     - `text`, with a `value`;
     - `strong`, `em` and `del`, each with `children`;
     - `code`, with a `value`;
     - `link`, with an `href` and `children`;
     - `break`.
   - **Safety rules:**
     - `safeMarkdownUrl(url)` allows only `http:`, `https:` and `mailto:`. A link with any other scheme becomes its children as plain inline nodes;
     - `html` nodes are dropped;
     - images become `text` with their alt;
     - unknown nodes become their text content.
   - GFM autolinks (`www.`, emails) come from `mdast-util-gfm` and pass through `safeMarkdownUrl`.
   - It must be pure and total: any input, including a half-written AI draft, returns blocks without throwing.
4. **Tests** in a new `packages/chat-core/src/markdown-ast.test.ts`:
   - `[x](javascript:alert(1))` gives no link node;
   - `mailto:` and `https:` links pass;
   - `<b>hi</b>` raw HTML gives no html in the output;
   - `![alt](u)` becomes text "alt";
   - a nested list keeps its nesting;
   - `- [x] done` gives `checked: true`;
   - a GFM table parses with its rows;
   - an unclosed fence gives a code block;
   - 30,000 characters of input are capped without throwing.
5. **Apps.** Don't touch any app in this task.

### Allowed files
- `packages/chat-core/package.json`
- `pnpm-lock.yaml`
- `packages/chat-core/src/markdown-ast.ts`
- `packages/chat-core/src/markdown-ast.test.ts`
- `work/T-2033-markdown-ast-chat-core.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/markdown-ast.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes, including the server production build.
- The lockfile has a single copy of each of the three packages.

---

## Report (written by the worker when done)

### What I did

- Added `mdast-util-from-markdown@2.0.3`, `mdast-util-gfm@3.1.0` and `micromark-extension-gfm@3.0.0` to `packages/chat-core/package.json` dependencies at the lockfile versions, and added the `"./markdown-ast": "./src/markdown-ast.ts"` subpath export. `"."` is unchanged, and nothing is exported from `src/index.ts`, so the server bundle is unaffected.
- Created `packages/chat-core/src/markdown-ast.ts` (204 lines): `parseMessageMarkdown(text)` parses `text.slice(0, 20000)` with the GFM mdast stack and maps it to `MdBlock`/`MdInline`. `safeMarkdownUrl` allows only `http:`, `https:` and `mailto:` through `parseUrl`; unsafe links keep their children as plain inline nodes; `html` and `definition` nodes are dropped; images and image references become `text` with their alt; unknown nodes fall back to their text content. The parse is wrapped so any input returns blocks and never throws.
- Created `packages/chat-core/src/markdown-ast.test.ts` with 10 tests: javascript link dropped, https/mailto links pass, raw HTML dropped, image alt becomes text, GFM autolinks become safe links, nested list nesting, GFM task list `checked`, GFM table rows/alignment, unclosed fence as code, and 30,000-character input capped at 20,000 without throwing.
- No app files touched.

### Checks run

- `pnpm install` — done; lockfile gained only the three direct dependency entries. `grep` shows one version each: `mdast-util-from-markdown@2.0.3`, `mdast-util-gfm@3.1.0`, `micromark-extension-gfm@3.0.0` (they appear twice only as the normal `packages` and `snapshots` sections).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/markdown-ast.test.ts` — 1 file passed, 10 tests passed.
- `pnpm gate` — GATE PASS. Summary lines:
  - `PASS  install (frozen)  (1.5s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (2.2s)`
  - `PASS  effect  (0.6s)`
  - `PASS  build @zilar/server  (1.3s)`
  - `PASS  tests @zilar/chat-core  (3.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- Deviation: `markdown-ast.ts` is 204 lines, just over the "about 200" estimate. The exported types take about 40 of them; no logic was added beyond the spec.
- The gate's effect ratchet initially failed on the `try`/`catch` in the total parser. I added the repo's existing escape hatch as the first line: `// effect-plain: total Markdown parse; a failed parse is a value, not an error` (the same pattern as `packages/chat-core/src/url.ts`). No check was disabled.
- `safeMarkdownUrl` reuses chat-core's existing `parseUrl` rather than the runtime `URL` (React Native's partial polyfill), so the allow-list behaves the same on both platforms.
- `start` is only set for ordered lists; `checked` is only present on task items, so both are truly optional in the AST. Table alignment keeps `null` for columns without a marker.
- No open questions. W2-f can import from `@zilar/chat-core/markdown-ast` and delete the phone parser.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.** `parseMessageMarkdown` sits behind the subpath `@zilar/chat-core/markdown-ast`, so the server bundle never imports it. It pins the three lockfile versions Julio approved on 10-18; the lockfile only adds importer entries, with no second copy.
- **Safety rules:** links pass only for http, https and mailto; raw HTML is dropped; images become their alt text; input is capped at 20k characters.
- **No app uses it yet.** W2-f switches the phone renderer to it.
- **Still to check:** the Hermes `\p{…}` regex inside micromark, on a device, in W2-f.
