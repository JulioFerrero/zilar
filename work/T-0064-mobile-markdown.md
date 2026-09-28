---
id: T-0064
title: Mobile renders Markdown in AI replies (safe subset, no new dependency), plain previews in the chat list
status: todo
milestone: M2
branch: task/T-0064-mobile-markdown
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0049, T-0056]
estimate: 1 day
---

# T-0064: Markdown in AI replies on mobile

## Spec (written by Claude, do not edit)

### Goal

On the web, AI replies render Markdown (T-0049): bold, italic, inline code, code blocks, lists, links, quotes. On mobile the same replies show raw `**text**` and backticks, which looks broken. Bring the same safe subset to the Expo app. There is **no Markdown library on mobile and none may be added**: write a small pure parser and render its output with React Native `Text` and `View`.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/components/MarkdownText.tsx` and `MarkdownText.test.tsx` (the safe subset and what the tests cover)
- `packages/chat-core/src/markdown.ts` (read only): `shouldRenderMarkdown(chat, message, currentUserId)` decides **which** messages render as Markdown. Use it as is. `markdownToPlain` builds the plain previews.
- `apps/mobile/src/components/chat/message-bubble.tsx` (where `LinkText` renders the body, the generating caret, the draft reveal, `textColor`), `link-text.tsx`, `src/lib/links.ts` (`safeLinkTarget`)
- `apps/mobile/src/components/chat/chat-list-item.tsx` (the preview line)
- `docs/design/ui-style.md` §5 (bubbles) and §3 (Geist, Geist Mono for code)

### Allowed files (under `apps/mobile/`)
- `src/lib/markdown.ts` (new: the pure parser), plus `src/lib/markdown.test.ts` (new)
- `src/components/chat/markdown-text.tsx` (new), plus a test
- `src/components/chat/message-bubble.tsx`, `chat-list-item.tsx`, plus their tests
- `src/mock/**`: an AI reply with Markdown in a mock chat, for screenshots
- `screenshots/T-0064/**`
- `work/T-0064-mobile-markdown.md`

**Not allowed:** `apps/web/**`, `apps/server/**`, `packages/**`, `docs/**`, other mobile files (list them in the Report if you need one). No new dependencies.

### What to build

**1. The parser (`lib/markdown.ts`).** `parseMarkdown(text): Block[]`, pure and total (it never throws, for any input, including a half-written draft). Blocks:
- paragraph, heading (levels 1–6, rendered a little larger and 600 weight, never bigger than 20 px), fenced code block (``` or ~~~; an unclosed fence at the end of the text is a code block, so a streaming draft does not flicker), blockquote, bullet list, numbered list (keep the number), horizontal rule.
- Inline nodes inside paragraphs, headings, quotes and list items: text, bold, italic, strike, inline code, link (`[label](url)` and bare `https://…` URLs).
- **Safety:** links only for `http:`, `https:` and `mailto:` (validate with `URL`; anything else, including `javascript:`, `data:` and relative links, stays plain text). Images `![alt](url)` render as the alt text only. Raw HTML is plain text.
- An unmatched marker stays as literal text (a lone `*` in `2 * 3`, a partial `**bold`), like `markdownToPlain` does.
- Cap the work: inputs over 20,000 characters render as plain paragraphs.

Tests (many, table-driven): each block kind, nesting (bold inside a list item, a link inside a quote), unclosed fence, unmatched markers, `javascript:` / `data:` / relative links, an image, raw `<script>`, an empty string, a 20,001-character input, and a large fuzz-style loop of random strings that only asserts "does not throw".

**2. The renderer (`markdown-text.tsx`).** `MarkdownText({ text, color })` renders the blocks with RN `Text`/`View` only:
- body text 15/20 Geist in `color`; bold = `Geist_600SemiBold`; italic via an italic style; strike via `textDecorationLine`; inline code in Geist Mono on a `#0c0c0c` chip; code blocks in a recessed well (the `--well` recipe already available through `src/lib/depth.ts`; check how other components use it) with horizontal scroll and no wrapping; quotes with a `#333` left bar; list markers aligned; block gap 6 px.
- Links open through `safeLinkTarget` + `Linking.openURL`, like `LinkText`.
- Wrap it in `React.memo` on `text` and `color`, so a reveal frame with unchanged text does not re-parse.
- Text stays selectable where `LinkText` allows it today.

**3. Wire it in.**
- `message-bubble.tsx`: when `shouldRenderMarkdown(...)` is true for the message, render `MarkdownText` instead of `LinkText`. The generating caret, the recessed generating color and the same-node swap from T-0056 must keep working (a draft renders Markdown while it grows; the caret goes after the last block). Human messages and your own messages stay on `LinkText`.
- `chat-list-item.tsx`: the preview uses `markdownToPlain` for AI chats and AI group replies, exactly as the web list does (check `apps/web/src/components/ChatListItem.tsx`).
- Add a mock AI reply containing a heading, bold, a list, a code block, a quote and a link to one mock chat so the states can be screenshotted.

### Integration / visual check
- No host input automation. Do not touch Julio's simulators (`A3E0C081`, `DB167CD4`), Metro on 8081, or the web ports 3000/3188/5173. If you need the simulator, follow the existing `boot:ios` flow (`apps/mobile/README.md`) with its own Metro, and stop it at the end.
- Screenshots (max ~8, downscaled with `sips -Z 900` before viewing; a session can hold at most 30 images): the Markdown reply in a DM, a draft mid-reveal, the chat list preview. Save under `screenshots/T-0064/`.
- If a simulator run is not possible, say so in the Report and rely on the component tests. Do not fake screenshots.

### Acceptance criteria
- [ ] `parseMarkdown` never throws (fuzz test) and the safety cases above pass.
- [ ] An incoming AI reply renders bold/italic/code/lists/quotes/links; human and own messages are unchanged.
- [ ] The draft reveal and same-node swap from T-0056 still pass their tests.
- [ ] List previews are plain text.
- [ ] No new dependencies, no `any`, no `@ts-ignore`.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Tables, task-list checkboxes, images, syntax highlighting, LaTeX.
- Web changes and copy-to-clipboard buttons on code blocks.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
