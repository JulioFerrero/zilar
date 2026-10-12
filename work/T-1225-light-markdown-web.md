---
id: T-1225
title: "Light Markdown for human messages, shared rule + web: a new chat-core parser formats **bold**, *italics*/_italics_, `inline code` and ``` code blocks inside the plain-text parts of a human message (links and @mention chips keep working); the web renders it, and chat-list previews strip the markers. AI replies keep full Markdown."
status: merged
milestone: M5
branch: task/T-1225-light-markdown-web
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1225: Light Markdown for human messages (shared + web)

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-12 that human messages render **light Markdown**: bold, italics, inline code, code blocks and links. Headings, tables, images, lists and quotes stay plain text. AI replies keep full Markdown, as today.

What the code does today:
- **The shared rule** `shouldRenderMarkdown` (`packages/chat-core/src/markdown.ts:10-22`) is true only for incoming AI messages. Every other message renders through the plain path.
- **On web, that plain path** is `LinkText` (`apps/web/src/components/message/MessageTextBody.tsx:56-58`, `apps/web/src/components/LinkText.tsx:1-48`).
  - `LinkText` splits the text into @mention chips by **character ranges** (`splitMentions`, `packages/chat-core/src/mentions.ts:121`), then makes links (`splitLinks`, `packages/chat-core/src/links.ts:60`).
  - So human messages can't go through `react-markdown`: changing the text would break the mention ranges.

### What to build
1. **A chat-core parser, in the new file `packages/chat-core/src/light-markdown.ts`**, exported from `packages/chat-core/src/index.ts`. Pure and total; it never throws.
   - **`splitCodeBlocks(text): { kind: 'text' | 'code'; text: string; start: number }[]`.** A block that opens and closes with a line starting with ```` ``` ```` is `code`: its `text` is the inner lines, and a language tag on the opening fence is dropped. An unclosed fence stays plain text. `start` is the offset in the original text, so the caller can shift mention ranges.
   - **`parseLightInline(text): { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }[]`.** It covers `**bold**`, `*italic*`, `_italic_` and `` `code` ``.
     - Markers need a non-space character right inside them (`** x**` stays literal).
     - `_` italics only at word edges, so `snake_case_name` stays literal.
     - Unmatched markers stay literal (`2 * 3`).
     - Nesting isn't required; inside `code` nothing else is parsed.
   - **`lightToPlain(text): string`.** The same text with those markers removed and fences dropped (keeping the code), for one-line previews.
2. **Web rendering** (`LinkText.tsx`):
   - add an optional `formatted?: boolean` prop. When it's true, first split with `splitCodeBlocks`. A `code` block renders as `<pre class="…"><code>` (monospace; use the existing `md` code styles if they fit, and cite them), with no links or mentions inside.
   - each `text` block keeps today's mention-then-link pipeline, with mention ranges shifted by the block's `start`. Each plain (non-link, non-mention) piece goes through `parseLightInline`: `bold` → `<strong>`, `italic` → `<em>`, `code` → `<code class="…">`.
   - `MessageTextBody.tsx:56-58` passes `formatted` on the plain path, which covers every human message and your own messages. AI messages keep the `MarkdownText` path unchanged.
3. **Previews:**
   - the chat-list row (`apps/web/src/components/ChatListItem.tsx:54-58`) and the topic row (`apps/web/src/components/TopicRow.tsx:33`) show `lightToPlain(body)` for a message that isn't full Markdown, so `**hi**` previews as "hi";
   - the AI preview path is unchanged.
4. **Tests** (message text pipeline; keep to these 2), in a new `packages/chat-core/src/light-markdown.test.ts`:
   - `parseLightInline('a **b** _c_ `d` snake_case 2 * 3')` gives the expected kinds, and `snake_case` and `2 * 3` stay literal;
   - `splitCodeBlocks` with one closed and one unclosed fence returns the right kinds and starts.

### Out of scope (note in the Report)
- **Mobile:** next task (T-1226). It uses this parser.
- **Push notification text** on the server still shows the raw markers.

### Read first
`AGENTS.md`, `packages/chat-core/src/markdown.ts`, `packages/chat-core/src/mentions.ts`, `packages/chat-core/src/links.ts`, `apps/web/src/components/LinkText.tsx`, `apps/web/src/components/message/MessageTextBody.tsx`, `apps/web/src/components/ChatListItem.tsx:40-70` and `apps/web/src/components/TopicRow.tsx:20-45`.

### Allowed files
`packages/chat-core/src/light-markdown.ts`, `packages/chat-core/src/light-markdown.test.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/components/LinkText.tsx`, `apps/web/src/components/message/MessageTextBody.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/index.css`, `work/T-1225-light-markdown-web.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/light-markdown.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on the local web mock:** a message with `**bold** _it_ `code` @mention https://x.y` and a fenced block renders formatted, and the mention chip and the link still work.

---

## Report (written by the worker when done)

### What I did
- New parser `packages/chat-core/src/light-markdown.ts` (exported from `index.ts`):
  `splitCodeBlocks` (fenced blocks with `start` offsets; unclosed fence stays text),
  `parseLightInline` (`**bold**`, `*italic*`/`_italic_` with word-edge rule, `` `code` `` wins over nesting),
  `lightToPlain` (markers stripped, one line).
- `LinkText.tsx`: optional `formatted` prop. Code blocks render as `<pre><code>`
  (Tailwind classes matching the `.md` code look, `index.css:441-471`, cited in
  the component comment); text blocks keep the mention-then-link pipeline with
  ranges shifted by block `start`; plain pieces go through `parseLightInline`
  (`<strong>`/`<em>`/`<code>`). Default `formatted={false}` keeps PinnedBanner/PinsPanel unchanged.
- `MessageTextBody.tsx:58` passes `formatted` on the plain (human) path; AI `MarkdownText` path unchanged.
- `ChatListItem.tsx` / `TopicRow.tsx`: non-Markdown previews show `lightToPlain(body)`; AI preview path unchanged.
- New `packages/chat-core/src/light-markdown.test.ts` with exactly the 2 spec tests.

### Files changed
`packages/chat-core/src/light-markdown.ts` (new), `light-markdown.test.ts` (new),
`packages/chat-core/src/index.ts` (+1 export line), `apps/web/.../LinkText.tsx`,
`apps/web/.../message/MessageTextBody.tsx` (+`formatted`), `ChatListItem.tsx`,
`TopicRow.tsx`. `apps/web/src/index.css` untouched (reverted a first draft that
added utilities there, to respect the 400-line acceptance rule; all touched
source files are ≤400 lines).

### Commands and real results
- `pnpm install`: done, 11.1s.
- `pnpm --filter @zilar/chat-core exec vitest run src/light-markdown.test.ts --reporter=dot`: 2 passed.
- Edge-case spot check via node strip-types: `** x**`, unmatched `**bold`/`` `code ``,
  `snake_case_name`, `2 * 3` all stay literal; `` `a **b**` `` keeps inner markers; fenced code kept in previews.
- `pnpm gate` (from repo root): `gate: 8 changed file(s) against main` /
  `PASS install (frozen) (1.2s)` / `PASS format (1.2s)` / `PASS lint (0.8s)` /
  `PASS typecheck (3.4s)` / `PASS effect (0.9s)` / `PASS tests @zilar/chat-core (1.0s)` /
  `SKIP tests @zilar/web (no nearby test files)` /
  `scope: every changed file is inside the Allowed files` /
  `migration: every added migration continues from the base` / `GATE PASS`.
  Single tests run while working: only `src/light-markdown.test.ts` (no web tests exist near the change).

### Deviations / notes
- Out of scope as noted: mobile (T-1226) and server push text (raw markers remain).
- Security checklist: rendering-only change, no secrets, no routes, no deletes/updates, no audit entries; nothing applies.
- Acceptance (lead's local web mock check) not run by me: no mock running in this worktree; typecheck+gate green.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:**
  - chat-core `light-markdown.ts` (`splitCodeBlocks`, `parseLightInline`, `lightToPlain`) with 2 tests;
  - `LinkText` `formatted` keeps the mention-then-link pipeline, with ranges shifted per block;
  - previews use `lightToPlain`.
- **The lead's check on the local web mock** (Marta DM and Dev team General):
  - `**bold** _it_ `code`` renders bold, italic and code;
  - the link works;
  - `snake_case`, `2 * 3` and `** x**` stay literal;
  - a fenced block renders as code, with `**1**` literal;
  - `**hey** @ana … _this_ `fix`` keeps the @ana chip in place;
  - the AI reply still renders full Markdown.
- **The follow-up (next web task):** pinned snapshots (`PinnedBanner.tsx:103`, `PinsPanel.tsx:201`) still show raw markers.
