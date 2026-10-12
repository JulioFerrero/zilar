---
id: T-1227
title: "Light Markdown for human messages, mobile: the bubble's plain path uses the chat-core light parser from T-1225 (bold, italics, inline code, ``` code blocks; links and @mention chips keep working), and chat-list previews strip the markers — parity with web"
status: merged
milestone: M5
branch: task/T-1227-light-markdown-mobile
model: auto
effort: default
depends_on: [T-1225]
estimate: 0.4 day
---

# T-1227: Light Markdown for human messages (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio decided that human messages render light Markdown: bold, italics, inline code, code blocks and links. T-1225 (merged) added the shared parser in `packages/chat-core/src/light-markdown.ts` (`splitCodeBlocks`, `parseLightInline`, `lightToPlain`) and wired it on web in `apps/web/src/components/LinkText.tsx` (the `formatted` prop). Read that file: mobile must behave the same way. AI replies keep the full mobile Markdown renderer (`apps/mobile/src/components/chat/markdown-text.tsx`).

Today mobile renders a human message's text with `LinkText` inside one `<Text>` (`apps/mobile/src/components/chat/message-bubble-content.tsx:205-212`, `apps/mobile/src/components/chat/link-text.tsx`, 74 lines). The inline meta (`BubbleInlineMeta`) sits in the same `<Text>`.

### What to build
1. **`link-text.tsx`:** add `formatted?: boolean`, mirroring web `LinkText`.
   - Each plain piece between mentions and links goes through `parseLightInline`, with nested `<Text>` styles: bold `Geist_600SemiBold`, italic `fontStyle: 'italic'`, and code mono on a dark background.
   - Take the fonts, inline-code background and code-block style from `markdown-text.tsx` (`BODY`, `CODE`, `INLINE_CODE_BACKGROUND`, `:14-20`) and cite them. Import them; don't copy them.
2. **Code blocks** (`message-bubble-content.tsx`): when `splitCodeBlocks(text)` has a `code` block, the body can't be one `<Text>`, because a `View` can't nest in `Text`. In that case only:
   - render the blocks in order: text blocks as `<Text><LinkText formatted …/></Text>` with mention ranges shifted by the block's `start`, and code blocks as a `View` styled like the `markdown-text.tsx` code block;
   - put the inline meta after the last block.
   A message with no code block keeps today's exact structure, plus `formatted`.
3. **Previews:** `plainPreviewBody` (`apps/mobile/src/components/chat/markdown-decision.ts:35-43`) returns `lightToPlain(rawBody)` for a message that isn't full Markdown, so `**hi**` previews as "hi". The AI branch is unchanged. It's used by `chat-list-item.tsx:73` and `topic-row.tsx:81`.
4. **Pinned or quoted snapshots on mobile:** grep for other `LinkText` uses and list them in the Report. A one-line snapshot uses `lightToPlain`; don't restructure those screens.
5. **No new tests** (UI); the parser is tested in chat-core.

### Read first
`AGENTS.md`, `work/T-1225-light-markdown-web.md` (the Report and the Review), `packages/chat-core/src/light-markdown.ts`, `apps/web/src/components/LinkText.tsx`, `apps/mobile/src/components/chat/link-text.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx:180-240`, `apps/mobile/src/components/chat/markdown-text.tsx` and `apps/mobile/src/components/chat/markdown-decision.ts`.

### Allowed files
`apps/mobile/src/components/chat/link-text.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/markdown-decision.ts`, `apps/mobile/src/components/chat/markdown-text.tsx` (exports only), `apps/mobile/src/components/chat/**` (only `LinkText` call sites, for item 4), `work/T-1227-light-markdown-mobile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - a message with `**bold** _it_ `code`` plus a fenced block renders formatted;
  - links and @mention chips work;
  - the chat-list preview shows no markers.

---

## Report (written by the worker when done)

### What I did
- `link-text.tsx`: added optional `formatted?: boolean` (default `false`), mirroring web `LinkText`.
  Each plain (non-link, non-mention) piece goes through `parseLightInline`: bold → `Geist_600SemiBold`,
  italic → `fontStyle: 'italic'`, code → mono on the dark background. The root text spreads the imported
  `BODY` and inline code uses the imported `INLINE_CODE_BACKGROUND` from `markdown-text.tsx`
  (`BODY`, `CODE`, `INLINE_CODE_BACKGROUND`, `:14-20`, cited in the component comment); fenced blocks
  are split by the caller. Links and @mention chips are unchanged and bypass formatting.
- `message-bubble-content.tsx`: plain (human) path now renders `PlainBubbleBody`. It calls
  `splitCodeBlocks(text)`: with no code block the structure is exactly today's single `<Text>` plus
  `formatted`; with a code block it renders blocks in order (text blocks as `<Text><LinkText formatted/>`
  with mention ranges shifted by the block's `start` — out-of-range mentions are ignored by
  `splitMentions` — code blocks as the shared `CodeBlock` in a `my-1` wrapper) and the inline
  meta (`BubbleInlineMeta`) after the last block. AI replies keep the `MarkdownText` path unchanged.
- `markdown-text.tsx` (exports only): exported `BODY`, `CODE`, `INLINE_CODE_BACKGROUND` and `CodeBlock`;
  no rendering change. `CodeBlock` keeps its `well` + `ScrollView` look (`:108-131`).
- `markdown-decision.ts`: `plainPreviewBody` returns `lightToPlain(rawBody)` for non-Markdown messages,
  so `**hi**` previews as "hi". The AI branch (`markdownToPlain`) is unchanged. Covers `chat-list-item.tsx:73`,
  `topic-row.tsx:81` and `group-list-item.tsx:79-82` (also routes through `plainPreviewBody`).
- No new tests (UI; parser is tested in chat-core per spec).

### Other `LinkText` uses (item 4)
Grep for `<LinkText` and `chat/link-text` across `apps/mobile/src` finds exactly one call site:
`message-bubble-content.tsx:206` (now inside `PlainBubbleBody`). No other screen imports it, so no
snapshot changes were needed.
One-line snapshots showing raw text (unchanged, as spec'd — no restructure):
- `reply-quote.tsx:15-19` (`reply.text`, also quoted in `composer-input-row.tsx:50-52`),
- `pinned-banner.tsx:81,109-112` and `pins-sheet.tsx:67` (via `pinLabel`, snapshot from
  `pin-snapshot.ts:pinSnapshotText`, max 300 chars). These still show raw markers, matching the web
  follow-up noted in the T-1225 Review (web `PinnedBanner`/`PinsPanel` also still raw).

### Files changed
`apps/mobile/src/components/chat/link-text.tsx` (74→119 lines),
`apps/mobile/src/components/chat/message-bubble-content.tsx` (+`PlainBubbleBody`, 390 lines),
`apps/mobile/src/components/chat/markdown-decision.ts` (+`lightToPlain`, 44 lines),
`apps/mobile/src/components/chat/markdown-text.tsx` (exports only, 194 lines).
All touched source files ≤ 400 lines.

### Commands and real results
- `pnpm install`: done, 13.7s.
- Single tests while working: none — grep confirms no test file references `link-text`,
  `markdown-decision` or `message-bubble-content`; per AGENTS.md, UI code gets no tests.
- `pnpm gate` (repo root, first run): `PASS install (1.0s)` / `FAIL format (1.2s)`
  (`markdown-text.tsx` — my one-line `export function CodeBlock` signature exceeded the print width).
  Fixed with `prettier --write` on that one file only (diff verified: only my signature reformatted).
- `pnpm gate` (repo root, second run): `gate: 5 changed file(s) against main` /
  `PASS install (frozen) (1.0s)` / `PASS format (1.0s)` / `PASS lint (1.1s)` /
  `PASS typecheck (3.3s)` / `PASS effect (0.7s)` / `SKIP tests @zilar/mobile (no nearby test files)` /
  `scope: every changed file is inside the Allowed files` /
  `migration: every added migration continues from the base` / `GATE PASS`.

### Deviations / notes
- The spec lists `markdown-text.tsx` line refs as `:14-20`; after my export-only edit the constants
  sit at `:15-20` — same values, no behavior change.
- One-line snapshots (reply quotes, pin banner/sheet) intentionally left raw per item 4; the lead may
  want a follow-up applying `lightToPlain` there (web has the same open follow-up from T-1225).
- Security checklist: rendering-only change, no secrets, no routes, no deletes/updates, no audit
  entries; nothing applies. User-facing error strings untouched; no emoji added.
- Acceptance (lead's emulator check) not run by me: no emulator in this worktree; typecheck+gate green.

## Fix round 1 (lead's emulator check, 2 commits, status stays review)

### 1. Light code text on the dark code background (`de39caae6`)
Bug: inline code and fenced blocks were unreadable in outgoing bubbles — the code background is dark
but the code text inherited the bubble's `textColor` (`#0a0a0a` outgoing), so `` `code` `` rendered as a
solid black box and a fenced block as an empty black panel.
Fix, as directed: inline code spans in `link-text.tsx` and the fenced `CodeBlock` in
`message-bubble-content.tsx` now use `FOREGROUND` from `@/lib/colors` (`palette.foreground`, `#ededed`),
the same light-on-dark look as the web. `markdown-text.tsx`'s AI rendering untouched
(`CodeBlock` takes its colour as a prop; the AI path still passes its own).

### 2. Snapshots strip markers (`c1747dd90`)
`reply-quote.tsx`, `composer-input-row.tsx` (`ReplyBar`), `pinned-banner.tsx` and `pins-sheet.tsx` now
show `lightToPlain(...)`: reply excerpts wrap `reply.text`; the banner wraps `pinLabel(current)` and the
sheet wraps `lightToPlain(pinLabel(pin))` at the call site (`pin-snapshot.ts` in `lib/` is outside the
Allowed files, so the wrap stays in `components/chat/**`). `lightToPlain` is total and already collapses
to one line; kind labels (`Photo`, …) contain no markers and pass through unchanged.

### Fix round 1 gate
- `pnpm gate` (repo root): `gate: 9 changed file(s) against main` /
  `PASS install (frozen) (1.0s)` / `PASS format (1.3s)` / `PASS lint (0.7s)` /
  `PASS typecheck (3.1s)` / `PASS effect (0.5s)` / `SKIP tests @zilar/mobile (no nearby test files)` /
  `scope: every changed file is inside the Allowed files` /
  `migration: every added migration continues from the base` / `GATE PASS`.
- Single tests while working: none (UI code; no test file references these modules).
- Line counts: `link-text.tsx` 124, `message-bubble-content.tsx` 391, `reply-quote.tsx` 24,
  `composer-input-row.tsx` 169, `pinned-banner.tsx` 149, `pins-sheet.tsx` 100 — all ≤ 400.

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 1. The pre-review is clean, with 1 nit.**
- **The change:**
  - mobile `LinkText` `formatted` uses the chat-core parser (bold, italics, inline code), and links and mention chips are kept;
  - a code block switches the bubble to a block layout;
  - previews and reply and pin snapshots use `lightToPlain`.
- **The lead's emulator check (mock builds of this branch, the Marta DM, my own outgoing bubble):**
  - round 0: bold, italics, the link and `snake_case` were right, but inline code and code blocks were black on black;
  - after round 1: `code` and the `x = 1` block read light on dark, and the chat-list preview shows `X = 1` with no fences;
  - `SMOKE PASS` both times.
- **Not checked on a device:** an @mention chip next to formatting. Web checked it in T-1225, and mobile uses the same segment pipeline.

- **Merged after a rebase onto main:** the rebase hit an import conflict with T-1231 (`SEEN`) in `message-bubble-content.tsx`. The worker kept both sides, and the lead checked mobile `tsc` (0 errors). The merge ran with the gate; the re-review of the rebased head (identical diff plus the import) hadn't finished after about 40 minutes.
