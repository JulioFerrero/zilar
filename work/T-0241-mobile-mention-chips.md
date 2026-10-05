---
id: T-0241
title: "Mobile: mentions in message bubbles render as chips, and a mention of me stands out"
status: merged
milestone: M5
branch: task/T-0241-mobile-mention-chips
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0227]
estimate: 0.3 day
---

# T-0241: Mention chips in mobile bubbles

## Spec (written by Claude, do not edit)

### Why
T-0227 lets the phone send mentions, and the store already keeps `message.mentions`. Mobile bubbles still show them as plain text. The web renders mentions as chips and gives a mention of me a stronger look (T-0195 audit `docs/audit/mobile-parity-gaps.md` 7.2a, follow-up of T-0227). This task is the mobile twin.

### Verified facts (do not re-derive)
- Web reference: `apps/web/src/components/LinkText.tsx` lines 1-45. It uses `splitMentions(text, mentions)` and then `splitLinks` inside the plain segments, and `isMentionOfMe(segment.jid, meJid)` picks the "mine" look. Web styles are in `apps/web/src/index.css` lines 392-411:
  - `.mention-chip`: `#ededed`, weight 600, background `rgba(255,255,255,0.08)`, radius 4, padding 0 3px;
  - in an outgoing bubble: text `#0a0a0a`, background `rgba(0,0,0,0.08)`;
  - `.mention-me`: the raised look, weight 600.
- `splitMentions`, `splitLinks` and `isMentionOfMe` are exported by `@zilar/chat-core` (`splitMentions` at `packages/chat-core/src/mentions.ts` line 128, `isMentionOfMe` at line 207, `splitLinks` at `packages/chat-core/src/links.ts` line 60). `UiMessage.mentions?: UiMention[]` is at `packages/chat-core/src/types.ts` line 64. The mobile real store fills it (`apps/mobile/src/store/real-store.ts` around line 672).
- Mobile text: `apps/mobile/src/components/chat/link-text.tsx` (whole file, about 37 lines; `LinkText({ text, color })`, links only), rendered at `apps/mobile/src/components/chat/message-bubble.tsx` line 551. `MessageBubble` gets `message` and `outgoing` (line 271). My JID: store `me?.jid` (`real-store.ts` `myJid()` lines 1513-1516 reads `get().me?.jid`).
- Nested RN `Text` cannot take a gradient, so the chips are flat backgrounds (radius and padding on nested Text are limited on Android; use background colour and weight only).

### What to build
1. `link-text.tsx`: `LinkText({ text, color, mentions?, meJid?, outgoing? })`. First split with `splitMentions`, then links inside plain segments (links behave exactly as today).
   - A mention segment is a nested `RNText` with `fontFamily: 'Geist_600SemiBold'` and a background of `rgba(255,255,255,0.08)` (or `rgba(0,0,0,0.08)` when `outgoing`).
   - A mention of me (`isMentionOfMe`) uses `rgba(255,255,255,0.18)` with foreground `#ededed` on incoming. On outgoing, my own mention of myself keeps the outgoing chip look.
   - The mention segment is not pressable.
2. `message-bubble.tsx` line 551: pass `mentions={message.mentions}`, `meJid` (read with `useChatStore((state) => state.me?.jid ?? undefined)`) and `outgoing`.
3. Tests, new file `apps/mobile/src/components/chat/link-text.test.tsx` (outside `src/app`, same render style as the other chat component tests):
   - text without mentions renders as before, links included;
   - a mention renders as its own span with the chip style;
   - a mention of me gets the stronger background;
   - an outgoing bubble uses the dark chip;
   - a link after a mention is still a link.

### Read first
`AGENTS.md`, `apps/web/src/components/LinkText.tsx`, `apps/mobile/src/components/chat/link-text.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx` (lines 240-280, 540-560), `packages/chat-core/src/mentions.ts`.

### Allowed files
`apps/mobile/src/components/chat/link-text.tsx`, `apps/mobile/src/components/chat/link-text.test.tsx` (new), `apps/mobile/src/components/chat/message-bubble.tsx`, `work/T-0241-mobile-mention-chips.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot link-text message-bubble
pnpm gate
```

### Acceptance
- On the phone, mentions show as chips and a mention of me stands out. Messages without mentions look exactly as before.
- No chat-core, web or store change. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Tapping a mention to open the profile, an "@" badge in the chat list, mention notifications.

---

## Report (written by the worker when done)

Done. Mobile bubbles now render mentions as chips, with a stronger look for a mention of me.

What I did:
- `apps/mobile/src/components/chat/link-text.tsx`: `LinkText({ text, color, mentions?, meJid?, outgoing? })`. Splits with `splitMentions` first, then `splitLinks` inside plain segments (link behavior unchanged). Mention segments are nested `RNText` with `Geist_600SemiBold` and flat backgrounds: `rgba(255,255,255,0.08)` incoming, `rgba(0,0,0,0.08)` outgoing, `rgba(255,255,255,0.18)` + `#ededed` for a mention of me via `isMentionOfMe` (incoming only; outgoing keeps the dark chip). Mention segments are not pressable.
- `apps/mobile/src/components/chat/message-bubble.tsx`: reads `meJid` via `useChatStore((state) => state.me?.jid ?? undefined)` and passes `mentions={message.mentions}`, `meJid`, `outgoing` to `LinkText` at the plain-text render path.
- `apps/mobile/src/components/chat/link-text.test.tsx` (new): 5 tests in the same stubbed-`Text` render style as the other chat component tests — plain text with links unchanged, mention chip style, mention-of-me stronger background, outgoing dark chip (even for self-mention), link after a mention stays pressable and opens via `Linking.openURL`.

Commands (real results):
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot link-text`: 5 passed. (First run failed 5/5 with `LinkText.type is not a function` — I had copied the `MarkdownText` memo-object pattern, but `LinkText` is a plain function; fixed the helper to call `LinkText(...)` directly.)
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot message-bubble`: 7 passed.
- `pnpm exec prettier --write` on my own two source files + the test (gate flagged the test file's formatting): fixed, `link-text` tests still 5 passed after.
- `pnpm gate`: GATE PASS. Summary lines: `gate: 4 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Security checklist: no secrets/tokens touched; no deletes/updates, caps, permissions, routes, or audit entries involved. No deviations from the spec; no chat-core, web, or store changes.

Blocked / needs a decision: none.

## Review (written by Claude)

**Verdict:** Approved. The first pre-review was clean, with 1 test-hardening nit: the test mocks `safeLinkTarget` as identity. I read the `link-text.tsx` diff:
- Mention segments come first, and links still go through `safeLinkTarget`.
- Chips are flat backgrounds (incoming 0.08 white, outgoing 0.08 black), and a mention of me on an incoming bubble gets 0.18 white plus `#ededed`.
- `meJid` comes from the store's `me`. In mock mode `me` is unset, so the "mine" look shows only in the real app.
