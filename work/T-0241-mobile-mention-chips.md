---
id: T-0241
title: "Mobile: mentions in message bubbles render as chips, and a mention of me stands out"
status: planned
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

## Review (written by Claude)
