---
id: T-0064
title: Mobile renders Markdown in AI replies (safe subset, no new dependency), plain previews in the chat list
status: review
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

**1. The parser — `apps/mobile/src/lib/markdown.ts` (+ `markdown.test.ts`)**
- `parseMarkdown(text): Block[]` and `parseInline(text): InlineNode[]`, pure and total
  (the fuzz loop never throws). Blocks: paragraph, heading 1–6, fenced code (``` and
  `~~~`; an unclosed fence at the end is a code block), blockquote, bullet list,
  numbered list (the source number is kept), horizontal rule.
- Inline: text, bold, italic, strike, inline code, links (`[label](url)` and bare
  `https://…`) and image alt text. Raw HTML stays plain text.
- Safety: a link only passes when `new URL(...)` parses it with an `http:`, `https:` or
  `mailto:` protocol, so `javascript:`, `data:`, `vbscript:` and relative links stay
  text. An unmatched marker (a lone `*` in `2 * 3`, a partial `**bold`) stays literal.
  Inputs over 20,000 characters come back as one plain paragraph, so a runaway draft is
  never parsed.

**2. The renderer — `apps/mobile/src/components/chat/markdown-text.tsx` (+ test)**
- `MarkdownText({ text, color })` renders with RN `Text`/`View` only, wrapped in
  `React.memo` on `text` and `color`. Body 15/20 Geist in `color`; bold
  `Geist_600SemiBold`; italic via `fontStyle`; strike via `textDecorationLine`; inline
  code in Geist Mono on a `#0c0c0c` chip; code blocks in the `well` recipe (from
  `lib/depth.ts`) inside a horizontal `ScrollView` (no wrapping); quotes with a `#333`
  left bar; aligned list markers; 6 px block gap; headings ≤ 20 px.
- Links open through `safeLinkTarget` + `Linking.openURL`, like `LinkText`.

**3. Wiring**
- `message-bubble.tsx`: when `shouldRenderMarkdown(chat, message, currentUserId)` is
  true, the body renders `MarkdownText`; the generating caret, recessed color,
  `generating` label and the T-0056 same-node swap are untouched, and the caret/meta
  follow the last block. Human and own messages keep `LinkText`.
- `chat-list-item.tsx`: the preview body runs through `markdownToPlain` when
  `shouldRenderMarkdown` is true for the last message.
- Mock: added a rich Markdown AI reply (heading, bold, italic, list, code, quote, link)
  to the `marketing-ai` DM, and made the T-0056 draft/final text Markdown so the
  generating bubble also exercises the renderer.

### Files changed
- `apps/mobile/src/lib/markdown.ts` (new), `apps/mobile/src/lib/markdown.test.ts` (new)
- `apps/mobile/src/components/chat/markdown-text.tsx` (new),
  `apps/mobile/src/components/chat/markdown-text.test.tsx` (new)
- `apps/mobile/src/components/chat/message-bubble.tsx`, `chat-list-item.tsx`
- `apps/mobile/src/mock/messages.ts`, `apps/mobile/src/mock/drafts.ts`
- `work/T-0064-mobile-markdown.md`

No other files changed; no dependencies added; no `any`, no `@ts-ignore`.

### Commands run and real results
```
pnpm install                     # Done in 7.3s using pnpm v10.32.1
pnpm format:check                # All matched files use Prettier code style!
pnpm lint                        # exit 0
pnpm typecheck                   # Tasks: 9 successful, 9 total
pnpm test                        # Test Files 25 passed | 2 skipped (27)
                                 # Tests 244 passed | 2 skipped (246)
                                 # (new: markdown.test.ts 26, markdown-text.test.tsx 9)
pnpm build                       # Tasks: 2 successful, 2 total; Exported iOS + Android bundles
```
The T-0056 reveal tests (`use-smooth-text.test.ts`, 11) still pass. The first two check
runs surfaced an unused test helper and an unused renderer parameter in `lint` (fixed);
no check was ever bypassed.

### Problems, deviations from the spec, open questions
- **Where `shouldRenderMarkdown` is decided.** `MessageBubble` gets no `chat` prop and
  `message-list.tsx` is not in the Allowed files, so the rule is evaluated inside
  `message-bubble.tsx` against the store's chat for `message.chatId` (a boolean zustand
  selector, so it does not re-render on unrelated store updates). It calls the shared
  `shouldRenderMarkdown` as the spec asks without editing a file outside the list.
  If you prefer an `isAiChat` prop passed from `MessageList`, that needs `message-list.tsx`
  allowed.
- **Component test approach.** The mobile package has no React Native testing library
  and Vitest has no `@/` alias, so `markdown-text.tsx` uses relative imports
  (`../lib/...`, as `lib/format.ts` already does) and the test stubs `react-native`,
  then walks the resolved element tree by calling `MarkdownText.type({ text, color })`.
  That exercises the real component without a new dependency or a simulator. `LinkText`
  and the other chat components keep the `@/` alias.
- **`mailto:` links.** The parser accepts `mailto:` as the spec says, but the mobile
  `safeLinkTarget` only opens http/https. A `mailto:` link therefore renders as plain
  text (no dead tap target); changing that would need `lib/links.ts`, which is not in
  the Allowed files.
- **Group AI previews.** The list preview also converts an incoming AI group reply
  (what `shouldRenderMarkdown` covers, the spec's "AI group replies"). The web list's
  own condition is only `chat.isAI`; for AI chats the result is identical.
- **Inline nesting.** Emphasis is a flat leaf model, so `**a *b* c**` keeps the inner
  markers literal. The spec's nesting cases (bold inside a list item, a link inside a
  quote) are supported.
- **Visual check: no simulator run, no screenshots.** `screenshots/T-0064/` was not
  created and no images were faked. The only available simulator is Julio's
  `iPhone 17 Pro (DB167CD4-…)`, which the task forbids touching; a new device needs a
  full native prebuild/`pod install`/`expo run:ios`, and the chat screen still sits
  behind `RequireAuth`, so reaching it needs a temporary auth bypass in files outside
  this task's Allowed files (what T-0056 did and reverted). I relied on the component
  tests, which the spec allows. To check by eye: `pnpm --filter @galena/mobile start`
  with `EXPO_PUBLIC_GALENA_MOCK=1` (add `EXPO_PUBLIC_GALENA_MOCK_DRAFT=stream|final`
  for the generating/final reply) and open the `marketing-ai` DM or `dev-ai`.

### Blocked / needs a decision
- None. The one design note is above: if you want the bubble to receive the chat as a
  prop instead of reading the store, allow `message-list.tsx`.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
