---
id: T-0049
title: Web renders Markdown in AI replies (safe subset, streaming-friendly), plain previews in the chat list
status: merged
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
- Add `markdownToPlain(text)` in `@zilar/chat-core`, so mobile can reuse it later. It strips the emphasis markers, the inline code backticks, the heading `#`s, and the list and quote markers; it keeps link text and drops the URLs; it collapses code fences to their content. It's a pure string function, with no dependencies.
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
pnpm exec turbo test --force --filter=@zilar/web --filter=@zilar/chat-core
pnpm build
```

### Out of scope
- Mobile rendering (it can reuse `markdownToPlain` later).
- Syntax highlighting, a copy button on code blocks, math.
- Markdown in human messages.

## Report (written by the worker when done)

### What I did

**1. Where Markdown renders — `packages/chat-core/src/markdown.ts`**
- Added `shouldRenderMarkdown(chat, message, currentUserId)`, the single decision point: `chat.isAI && message.senderId !== currentUserId`. `MessageBubble` calls it; everything else (human DMs, groups, your own messages) still goes through `LinkText`. The draft uses the same path (its `senderId` is `chat.id`, and the AI's own messages use that id, so it is never "own").

**2. `MarkdownText` — `apps/web/src/components/MarkdownText.tsx` (new)**
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1. Wrapped in `React.memo`, so a reveal frame with unchanged text does not re-parse.
- Safety: no `rehype-raw` (raw HTML is skipped by default); `urlTransform` returns `''` unless the URL parses with `http:`, `https:` or `mailto:`, so `javascript:`, `data:`, `vbscript:` and relative links render as plain text; a custom `a` renderer adds `target="_blank" rel="noopener noreferrer"`; `img` renders the alt text (never an `<img>`).

**3. `MessageBubble` — `apps/web/src/components/MessageBubble.tsx`**
- Incoming AI text renders `<div class="md …"><MarkdownText text={text} /><span class="md-tail">caret + meta</span></div>`; every other message keeps the existing `<p><LinkText/>…</p>` (unchanged). The generating caret and the `visible`/`invisible` meta float live in `md-tail`, so the same-node swap and the reveal keep working.

**4. Styles — `apps/web/src/index.css`**
- One `.md` block: body 14/1.5, paragraphs 8 px apart, links `--foreground` underlined, inline code Geist Mono 12.5 px on `--well` with a 1 px `--edge` border, 4 px radius, 1/4 px padding; code blocks are the well look (Geist Mono 12.5, 10 px radius, 10/12 px padding, `overflow-x: auto`, `white-space: pre`), blockquote a `#333` 2 px bar with muted text, tables 1 px `--border` cells with a `--surface` header inside a `display: block; overflow-x: auto` wrapper, lists a 20 px indent with 2 px between items, headings 16/15/14 px at 600. Tokens are used where they exist; the two literals (`#333` bar) match ui-style.md §5's own values.

**5. Chat list preview — `ChatListItem.tsx` + `markdownToPlain`**
- `markdownToPlain(text)` in `chat-core` is pure and dependency-free: it drops fenced-code fences (keeping the code literally), heading `#`s, quote and list markers, horizontal rules, emphasis/strike markers, inline-code backticks, keeps link text, drops link URLs, and collapses whitespace to one line. `ChatListItem` applies it to `previewBody(last)` only when `chat.isAI`. Rules that don't match are left alone, so `2 * 3`, `snake_case` and a partial `**bold` survive.

**6. Same-node swap** kept: no key or ordering changes; `MessageList`'s `draft-${turnId}` key is untouched. Added a test where both the draft and the final text contain Markdown.

**7. Mock data — `apps/web/src/mock/messages.ts`**
- `c-devai` gained one Markdown-rich AI reply (`dai-7`): an h2 and h3, bold, inline code, a nested list, a fenced bash block wider than the bubble, a GFM table, a blockquote and a link. `c-ana`'s `ana-3` now reads `Amazing. Which **entrance**?` so a human DM shows literal `**`.

### Files changed
- `packages/chat-core/src/markdown.ts` (new), `markdown.test.ts` (new), `index.ts` (one export line)
- `apps/web/src/components/MarkdownText.tsx` (new), `MarkdownText.test.tsx` (new)
- `apps/web/src/components/MessageBubble.tsx`, `MessageContent.test.tsx`, `MessageList.test.tsx`
- `apps/web/src/components/ChatListItem.tsx`, `ChatListItem.test.tsx`
- `apps/web/src/index.css`, `apps/web/src/mock/messages.ts`
- `apps/web/package.json` + root `pnpm-lock.yaml` (the two allowed dependencies)
- `work/T-0049-ai-markdown-web.md`, `work/screenshots/T-0049/**`

`git status` shows no other tracked file changed.

### Tests added
- `MarkdownText.test.tsx` (14): paragraphs/bold/italic/strike, inline + fenced code, ordered/unordered/nested lists, blockquote/headings/hr, GFM table, read-only disabled task checkboxes, links with `target`/`rel`, `mailto:` allowed, `javascript:`/`data:`/relative rendered as plain text, a Markdown image as alt text with no `<img>`, raw `<script>`/`<img onerror>` not rendered, and partial Markdown not throwing.
- `markdown.test.ts` (11): `shouldRenderMarkdown` (AI incoming true; own/human/group false) and every `markdownToPlain` rule, plus `2 * 3`, `snake_case`, partial `**bold`, an unclosed fence and an unterminated link.
- `MessageContent.test.tsx` (3): an incoming AI reply renders Markdown tags; a human DM and your own AI-chat message keep literal `**`.
- `MessageList.test.tsx` (1): a Markdown draft → final message keeps the same DOM node, keeps the generating look while revealing, and ends with the completed `<strong>`.
- `ChatListItem.test.tsx` (2): an AI preview shows `Deployed to staging`; a human preview keeps `a **bold** word`.

### Commands (real results)
```bash
pnpm install                                        # Done in 3.5s; +96 packages (pnpm 10.32.1). Peer warning: apps/mobile @types/react-dom 19.3.0 wants @types/react ^19.3.0, found 19.2.18 (pre-existing, in mobile, untouched)
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/web --filter=@zilar/chat-core
                                                    # chat-core: 6 files, 61 tests passed; web: 35 files, 226 tests passed; Tasks 2 successful
pnpm build                                          # Tasks: 2 successful, 2 total; web built in ~0.9s
```

### Streaming cost (measured, as asked)
Temporary harness (deleted afterwards), `MarkdownText` on a 3,591-character reply with a fenced code block, rendered 30 times after 5 warm-ups in jsdom on this machine:
- parse + render per update: **5.2–5.7 ms** (repeated runs: 5.72 ms, 5.24 ms).
- A reply of that size is revealed in ~45 `useSmoothText` updates, so a full reveal costs roughly 0.23–0.26 s of main-thread work spread over ~1.5 s. **One update is over the ~4 ms bar**, and I did not invent an optimization. The per-update cost is dominated by the parse of the whole cumulative text, which `React.memo` cannot skip because the text genuinely changes each frame. Worth a follow-up if it shows on real hardware; in jsdom the number is pessimistic, so I would measure the real app before optimizing.

### Visual check
Served this worktree's Vite on `localhost:5231` with a throwaway mock auth server (in the approved temp dir, outside the repo) answering `/api/auth/get-session`, and opened the app with `?mock=1` in Chrome through the DevTools MCP. Screenshots in `work/screenshots/T-0049/`, all looked at:
- `ai-markdown-1440.png` — Dev AI at 1440×900: heading, bold, inline code, nested list, the code block **clipped with horizontal scroll inside the bubble** (the bubble does not grow), the GFM table, the quote and the link. The list preview reads `Review summary I read both PRs and left n…` (plain).
- `ai-markdown-390.png` — the same chat at 390×844: fits the max width, scrolls inside the code block and the table.
- `human-dm-literal-1440.png` — Ana (a human DM): the message text is literal; the DOM for `Amazing. Which **entrance**?` is `<span>Amazing. Which **entrance**?</span>` with no `<strong>` (the line is in the scrolled-up part of the history, so I asserted it in the DOM rather than the viewport).
- `generating-390.png`, `generating-1440.png` — a live Markdown draft set through the same store seam the tests use (`store.setState({ drafts … })`, reached through the React root; no repo file was edited for it). The bubble is recessed, the caret sits right after the last block (the code block) with the `generating` label below, and the list shows `writing…`.

Both dev servers were stopped (`lsof -ti :5231`, `:4321` show no LISTEN).

### Notes and choices
- **Caret placement.** When the reply ends in a paragraph, the floated time/meta sit on that paragraph's last line (a CSS `p:has(+ .md-tail) { display: inline }` plus the `md-tail` span). When it ends in a list, table or code block, the caret and the time sit on the row right after the last block; the spec allows that. In the generated `ai-markdown-1440.png` the time is on the row after the final link paragraph, which is the small layout difference I chose to keep.
- **`previewText` unchanged.** The spec says `ChatListItem` uses `markdownToPlain`; `previewText` (used by mobile and tests) is untouched, so this stays a web-only change.
- The 404 console error in the browser is `/api/clipboard` from the mock store — pre-existing and unrelated.
- No deviations from the acceptance criteria; no open questions.

## Round 2 (review fixes)

Applied the three items from the lead's pre-review. `PREREVIEW.md` is left untracked and uncommitted, as asked.

**1. should-fix — `ChatListItem.tsx` own-message preview.** The preview now mirrors `shouldRenderMarkdown` exactly: it calls `markdownToPlain` only when `chat.isAI && last !== undefined && last.senderId !== store.currentUserId`. Your own `a **bold** word` in an AI chat now previews literally, as the bubble shows it.
```tsx
const body =
  chat.isAI && last !== undefined && last.senderId !== store.currentUserId
    ? markdownToPlain(rawBody)
    : rawBody;
```
Tests: `ChatListItem.test.tsx` gained "keeps literal markers in your own AI-chat preview" (asserts `a **bold** word` is shown and `a bold word` is not), next to the existing incoming-AI and human-DM cases.

**2. nit — `markdownToPlain` intra-word asterisks.** `stripInline`'s `*` rule is now `/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g`, the `_` rule's lookaround idea: an intra-word `*` is left literal, a word-boundary one still strips. Checked directly against `markdownToPlain`:
```
"foo*bar*baz"   -> "foo*bar*baz"
"a*b*c"         -> "a*b*c"
"2 * 3 * 4"     -> "2 * 3 * 4"
"say *hi* now"  -> "say hi now"
"**bold** and *it*" -> "bold and it"
"snake_case_name"   -> "snake_case_name"
```
Tests: `markdown.test.ts` gained "does not treat an intra-word asterisk as emphasis" and a `2 * 3 * 4` case in the existing marker test.

**3. nit — `vbscript:` link test.** `MarkdownText.test.tsx` gained "renders a vbscript: link as plain text" (`[x](vbscript:msgbox(1))` → no `<a>`, text `x`). Code was already correct.

### Round 2 commands (real results)
```bash
pnpm format:check                                   # FAILS, and only on PREREVIEW.md: "[warn] PREREVIEW.md / Code style issues found". Every file I changed passes ("All matched files use Prettier code style!"). PREREVIEW.md is the lead's untracked pre-review artifact, outside the Allowed files; I left it as-is rather than reformat or ignore it. Fixing it would mean deleting/formatting the lead's file or editing .prettierignore (not allowed).
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/web --filter=@zilar/chat-core
                                                    # chat-core: 6 files, 62 tests passed (was 61); web: 35 files, 228 tests passed (was 226); Tasks 2 successful
pnpm build                                          # Tasks: 2 successful, 2 total
```

### Round 2 scope
Only these five files changed, all Allowed: `apps/web/src/components/ChatListItem.tsx` + `.test.tsx`, `apps/web/src/components/MarkdownText.test.tsx`, `packages/chat-core/src/markdown.ts` + `.test.ts`, and this task file. `git status` shows no other tracked change and `PREREVIEW.md` stays untracked.

## Review (written by Claude)


**Verdict: approved, merged.**

- The round 1 pre-review had one should-fix (preview stripping on your own messages) and two nits (intra-word `*`, a `vbscript:` test). All three were fixed in round 2 with tests. I accept the round 2 nits: the dead `own` ternary in the Markdown branch, task-list and table markers kept in previews, and the edited `MessageContent` / `MessageList` tests, which is where the swap tests already lived.
- Safety: no `rehype-raw`, links limited to http, https and mailto (anything else renders as text), Markdown images shown as alt text only, raw HTML not rendered. The tests cover all of it.
- Live check (branch on localhost:5174 in Julio's Helium, against the live server): his real "deep test" replies render headings, bold, nested lists and paragraphs in the D24 look, and the list preview is plain text. After Vite's one-time dependency bundling, a hard reload paints in about 1.2 s. Switching chats has no long tasks, and scrolling up (loading history) had one 60 ms task.
- Streaming cost: 5 ms per update in jsdom; accepted. The live streaming look needs a sent message, so it waits for Julio.
