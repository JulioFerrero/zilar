---
id: T-0045
title: Web — smooth draft reveal and a "still generating" look (gray until complete), continuing into the final message without a snap
status: planned
milestone: M2
branch: task/T-0045-smooth-drafts
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0043]
estimate: 1 day
---

# T-0045: Make the AI's writing feel smooth

## Spec (written by Claude, do not edit)

### Goal

T-0043 shows AI reply drafts. Julio saw it live and said: "that needs to be smoother, gray if its not completly generated, maybe change the color of the [bubble] if its not generated".

What happens today:
- The text grows in chunks, one every ~150 ms, because the server throttles drafts.
- When the final message arrives, any missing text appears **at once**. In the live check, the last 40% of a reply snapped in.
- The draft looks exactly like a finished message, so you can't tell it's still being written.

What to build:
1. **Smooth reveal.** The visible text catches up with the latest draft text steadily, frame by frame, instead of in chunks.
2. **Continue into the final message.** When the final XMPP message replaces the draft, the reveal carries on from where it was up to the full text. It never snaps. Only when the reveal reaches the end does the bubble look finished.
3. **A "still generating" look.** While the reply is being written or revealed, the text is **gray** (muted) and the bubble slightly dimmed. When it's complete, both fade to the normal look (a ~400 ms color transition). The blinking caret stays while generating.

T-0044 (server, in parallel) makes sure the last draft carries the complete text before the final message. Your code must also work when it doesn't (older server), and in that case reveal the rest of the final message smoothly.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0043-web-reply-drafts.md`: the whole file, including the Review and its live-check numbers
- `apps/web/src/store/realStore.ts`: the draft handling (`handleDraftEvent`, `handleDraftEnd`, `handleMessage`'s draft swap, `drafts` state)
- `apps/web/src/components/MessageList.tsx`, `MessageBubble.tsx` (the `draft` prop, `DraftCaret`), `lib/useDelayed.ts` for hook style
- `apps/web/src/index.css`: the bubble color tokens, light and dark
- `docs/design/ui-style.md`

### Allowed files
- `apps/web/src/store/**`, plus tests
- `apps/web/src/components/MessageList.tsx`, `MessageBubble.tsx`, plus tests
- `apps/web/src/lib/useSmoothText.ts` (new), plus its test
- `apps/web/src/index.css`: only to add tokens for the generating look, if you need them (light **and** dark)
- `work/T-0045-smooth-drafts.md`

Everything else is off-limits, including `apps/server/**`.

### Allowed dependencies
None. Use `requestAnimationFrame` and CSS transitions.

### What to build

**1. `useSmoothText(target: string, options)`** returns `{ text, done }`:
- `text` is a prefix of `target` that grows every animation frame until it equals `target`.
- **Speed adapts to the backlog.** It catches up within about 300–400 ms of the latest update, and it has a minimum speed so a slow stream still moves, e.g. at least ~60 chars/s while there is a backlog. It never exceeds the target.
- If `target` changes to something that doesn't start with the shown text (the cumulative text restarted, see the T-0043 quirk 2), restart from the longest common prefix.
- **`prefers-reduced-motion: reduce`:** no animation; `text` is `target` immediately.
- **Tests:** inject the clock and frame scheduler (options or a small seam) so tests use fake timers, not real `requestAnimationFrame`.

**2. One bubble from the first draft to the final text.** The draft bubble and the final message that replaces it must be the **same React component instance**, so the reveal state carries over:
- when the store swaps a draft for its final message (T-0043 rule (a)), it records which message finished which turn. For example, `finishedDraftMessages: Record<messageId, turnId>` in state, capped the same way as the finished-turn set and cleared on `stop()` and `signOut()`;
- `MessageList` keys that message's bubble with the same key the draft used, e.g. `draft-${turnId}`;
- that final bubble keeps revealing (from the shown length up to the full final text) and in the generating look until `done`. After that it is a normal message: actions menu, ticks and time as usual.
- **Messages loaded from history** (no draft this session) render normally, with no animation.

**3. The generating look** (in `MessageBubble`, driven by a prop such as `generating`):
- the text color is a muted gray that fits the incoming bubble in light and dark themes (use or add tokens, no hard-coded hex in components);
- the bubble is slightly dimmed, subtly: it must stay readable and look intentional, not disabled;
- the blinking caret shows only while generating;
- the time and meta stay invisible while generating (keeping the width, as today);
- when generating ends, the colors transition over ~400 ms (`transition-colors`). There is no transition for messages that were never generating.

**4. Scrolling.** While the user is at the bottom, the list stays pinned to the bottom as the revealed text grows, frame by frame, not just per draft event. A `ResizeObserver` on the content, or pinning in the same effect that grows the text, both work. If the user scrolled up, nothing moves them.

### Tests (Vitest and Testing Library, fake timers, no network)
- **`useSmoothText`:**
  - grows monotonically to the target;
  - catches up within the time bound;
  - respects the minimum speed;
  - restarts at the common prefix when the text shrinks;
  - reduced motion shows the target at once.
- **Store:** the swap records `messageId → turnId`; the record is capped and cleared on `stop()` and `signOut()`.
- **UI:**
  - the draft bubble has the generating look and caret;
  - after the store swaps in a final message with **longer** text, the **same DOM node** (`data-message-id` can change, but assert on a ref or a stable attribute you add) keeps revealing and keeps the generating look until the text is complete, then drops it;
  - a history message never has the generating look;
  - reduced motion shows the full text at once.

### Live check (the lead does it, with Julio's permission)
Give exact steps in the Report:
- ask the AI for a longer answer: the text flows smoothly, gray and dim while writing, and turns normal once complete with no snap at the end;
- repeat in the light and dark themes;
- scroll up while it writes: nothing pulls you down.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] No snap: the final text always finishes revealing from where the draft was.
- [ ] Generating vs finished is clearly visible and tasteful in both themes; include before/after color tokens in the Report.
- [ ] No `any`, no `@ts-ignore`.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Server changes (T-0044).
- Mobile.
- A stop button.

## Report (written by the worker when done)

## Review (written by Claude)
