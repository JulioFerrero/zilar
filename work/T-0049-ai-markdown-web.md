---
id: T-0049
title: Web renders Markdown in AI replies (safe subset, streaming-friendly), plain previews in the chat list
status: planned
milestone: M2
branch: task/T-0049-ai-markdown-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0047]
estimate: 1 day
---

# T-0049: Markdown in AI replies (web)

## Spec (written by Claude, do not edit)

### Goal

AI replies are written in Markdown, but the web app shows them as raw text: `**bold**`, `- lists`, `` `code` ``, and fenced code blocks all appear literally. Julio sees this in his AI chat every day. This task renders Markdown **in AI replies only**, safely. It works while the reply is still streaming, and it fits the D24 look. The chat list preview shows the same reply as clean plain text.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: §2 tokens, §3 typography, §5 Messages
- `apps/web/src/components/MessageBubble.tsx`, `LinkText.tsx`, `MessageList.tsx`, `ChatListItem.tsx`
- `packages/chat-core/src/links.ts`: the existing safe-link rules (http and https only)
- `work/T-0045-smooth-drafts.md` and `work/T-0047-redesign-chat-panel.md`: the smooth reveal, the same-node swap, the generating look, and the caret. All must keep working.
- `apps/web/src/mock/chats.ts` and `messages.ts`: the mock AI chat

### Allowed files
- `apps/web/package.json` and the root `pnpm-lock.yaml`: only for the dependencies below
- `apps/web/src/components/MarkdownText.tsx` (new), plus `MarkdownText.test.tsx` (new)
- `apps/web/src/components/MessageBubble.tsx`, plus its tests
- `apps/web/src/components/ChatListItem.tsx`, plus its test: the preview only
- `apps/web/src/index.css`: styles for Markdown content inside bubbles
- `apps/web/src/mock/messages.ts`: add **one** Markdown-rich AI reply to the mock AI chat, for screenshots
- `packages/chat-core/src/markdown.ts` (new), `markdown.test.ts` (new), and the one export line in `packages/chat-core/src/index.ts`
- `work/T-0049-ai-markdown-web.md` and `work/screenshots/T-0049/**`

**Not allowed:** the store, the server, mobile, and `docs/**`.

### Allowed dependencies
- `react-markdown` and `remark-gfm` (latest versions compatible with React 19), in `apps/web` only.
- Nothing else: no syntax highlighter and no `rehype-raw`.

### What to build

**1. Where Markdown renders.**
- Render Markdown only for **incoming messages in chats where `chat.isAI` is true**. That includes the live draft and the final message.
- Everything else stays plain text through `LinkText`: human DMs, groups, your own messages.
- Put this decision in one small, tested function (e.g. `shouldRenderMarkdown(chat, message, currentUserId)`).

**2. `MarkdownText` component** (react-markdown + remark-gfm).
- **Supported:**
  - paragraphs, **bold**, *italic* and ~~strike~~;
  - inline code and fenced code blocks;
  - ordered and unordered lists, including nested ones;
  - blockquotes, headings (h1–h3 all render at modest sizes: 16/15/14 px, weight 600, never huge), horizontal rules;
  - links and GFM tables;
  - task lists (render the checkboxes read-only, disabled).
- **Safety (must):**
  - No raw HTML: react-markdown's default skips it. Don't add `rehype-raw`, and add a test that `<script>` and `<img onerror>` in the text don't render as elements.
  - Links go through a `urlTransform` that allows only `http:`, `https:` and `mailto:`. Anything else (`javascript:`, `data:`, `vbscript:`, relative links) renders as plain text, not a link. Every link gets `target="_blank" rel="noopener noreferrer"`.
  - Images in Markdown (`![x](url)`) render as their alt text or the link text, **never** as `<img>`. A remote image would leak the reader's IP.
- **Look (D24, dark incoming card):**
  - body 14 px with 1.5 line height; paragraphs spaced 8 px;
  - links `#ededed` underlined;
  - inline code: Geist Mono 12.5 px on `--well`, a 1 px `--edge` border, 4 px radius, 1 px/4 px padding;
  - code blocks: the **well** look (recessed), Geist Mono 12.5 px, 10 px radius, 10/12 px padding, horizontal scroll inside the block (the bubble never grows wider than its max width), no wrapping;
  - blockquote: a `#333` 2 px left bar with muted text;
  - tables: 1 px `--border` cells, a `--surface` header, horizontal scroll inside the bubble;
  - lists with a 20 px indent, 2 px between items.
  Put these styles in `index.css`, scoped under one class (e.g. `.md`), using the tokens and never raw colors where a token exists.
- **Streaming:**
  - Partial Markdown (an unclosed `**`, an open code fence) must render without errors or layout jumps worse than plain text.
  - Memoize parsing on the text, so a reveal frame with unchanged text doesn't re-parse.
  - Measure one realistic case in the Report: a 4,000-character reply with a code block, revealed by `useSmoothText`. Give the parse and render time per update. If one update costs more than ~4 ms, say so. Don't invent an optimization; report it.
- **Caret and meta:**
  - The generating caret stays at the end of the text. If it can't sit inline in the last block, place it right after the last block and say so.
  - The time and meta sit at the bottom right after the content, as for multi-line text today.

**3. The same-node swap** (T-0045, T-0047): the draft → final message swap keeps the same bubble node, and the reveal doesn't replay. Keep every existing test green, and add one where the draft and final text contain Markdown.

**4. Chat list preview.**
- Add `markdownToPlain(text)` in `@galena/chat-core`, so mobile can reuse it later. It strips the emphasis markers, the inline code backticks, the heading `#`s, and the list and quote markers; it keeps link text and drops the URLs; it collapses code fences to their content. It's a pure string function, with no dependencies.
- `ChatListItem` uses it for AI chats' last-message preview only.
- Unit tests cover each rule, partial Markdown, and text that merely *contains* `*` (e.g. `2 * 3`), which must survive.

### Tests (Vitest and Testing Library, no network)
- `MarkdownText`:
  - each supported element renders the expected tag;
  - the safety cases (raw HTML, `javascript:`, `data:`, a Markdown image, a relative link);
  - links get `target` and `rel`;
  - partial Markdown doesn't throw.
- `shouldRenderMarkdown`: an AI chat incoming message → true; your own message, a human DM, a group → false.
- `MessageBubble`: an AI reply renders Markdown, a human DM renders the literal `**`, and the Markdown draft → final swap keeps the same node.
- `markdownToPlain`: the rules above.

### Visual check (you do it, then report)
Use the mock store (`?mock=1`) and open the mock AI chat with your new Markdown reply (a heading, a list, inline code, a code block wider than the bubble, a table, a quote and a link). Also include a human DM with a literal `**` to show it stays plain.

Screenshot at 1440×900 and at 390×844. Render the generating state with Markdown through the test seam, as in T-0047. Save the screenshots to `work/screenshots/T-0049/` and look at them yourself. **Stop any dev server you start.**

### Acceptance criteria
- [ ] Every check below passes.
- [ ] Markdown renders only in AI chats' incoming messages; the safety tests pass.
- [ ] Streaming and the same-node swap still work; the reveal doesn't replay.
- [ ] The chat list shows plain previews for AI chats.
- [ ] Only the Allowed files changed, and only the two allowed dependencies were added.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web --filter=@galena/chat-core
pnpm build
```

### Out of scope
- Mobile rendering (it can reuse `markdownToPlain` later).
- Syntax highlighting, a copy button on code blocks, math.
- Markdown in human messages.

## Report (written by the worker when done)

## Review (written by Claude)
