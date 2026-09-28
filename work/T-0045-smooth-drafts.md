---
id: T-0045
title: Web — smooth draft reveal and a "still generating" look (gray until complete), continuing into the final message without a snap
status: review
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

### What I did

**1. `useSmoothText` — `apps/web/src/lib/useSmoothText.ts` (+ test)**
- `useSmoothText(target, options) => { text, done }`. `text` is always a prefix of `target`. A frame loop advances it; the hook reconciles the target in `useLayoutEffect` before paint, so a target that restarted (a tool call shrank the cumulative text, T-0043 quirk 2) resumes at the longest common prefix instead of flashing.
- Speed: on each target change `velocity = max(60 chars/s, remaining / 0.35 s)`, so the backlog of one update is cleared in ~350 ms (the test measures ≤ 400 ms) while a slow stream still moves at ≥ 60 chars/s. A single frame never advances more than 100 ms worth, so a background-tab stall doesn't flush everything at once.
- Reduced motion (`options.reducedMotion` or the `prefers-reduced-motion` media query) shows `target` at once and schedules no frame.
- Seams for tests: `options.frames` (a `FrameScheduler` with `request`/`cancel`) and `options.reducedMotion`. Tests inject a manual scheduler and drive frames with chosen timestamps; no real `requestAnimationFrame` is used.
- `options.animate` (false for messages never seen as a draft) and `options.initial: 'zero' | 'full'`: the chat UI uses `'full'` so a bubble paints its first target at once and only animates later growth. That is what makes a remount (switching chat and back) render a finished reply normally instead of replaying its reveal. Defaults keep the spec semantics (`animate: true`, `initial: 'zero'`).

**2. One bubble from the first draft to the final text — `store.ts` / `realStore.ts` / `MessageList.tsx`**
- New store state `finishedDraftMessages: Record<messageId, turnId>`, set in `handleMessage` in the **same** `set` that removes the draft and adds the final message (rule (a)). Capped at `FINISHED_TURNS_MAX` (50, insertion order) by `rememberFinishedDraftMessage`. Cleared in `stop()` and in `signOut()`.
- `MessageList` keys each bubble with the draft's `draft-${turnId}` whenever the message has an entry, so React reuses the same component instance and the reveal state carries over. The synthetic draft already used that key.
- `MessageBubble` gained `revealTurnId`; `revealing = revealTurnId !== undefined && !draft`. The text reveal continues from the shown length up to the full final text; `generating` stays true until `done`, then the bubble becomes a normal message (menu, ticks, time visible again). No extra store state was needed to end the reveal: `done` comes from the hook, and `initial: 'full'` handles remounts.
- Messages loaded from history have no entry, so `animate` is false and they render normally (tested).

**3. The generating look — `MessageBubble.tsx` / `index.css`**
- Text uses the new `--bubble-in-generating` token (no hex in the component); the incoming bubble background uses `bg-bubble-in/90`, a subtle ~10 % dim toward the chat background. The bubble keeps its normal `--bubble-in` colour and tail geometry, and the tail stays consistent.
- The caret shows only while `generating` and is `motion-reduce:animate-none`; time/meta are `invisible` (same width reserved, as in T-0043). Actions and the context menu are hidden until done.
- Bubbles that were ever live get `transition-[color,background-color] duration-[400ms] ease-out motion-reduce:transition-none`; history messages get no transition.

**4. Scrolling — `MessageList.tsx`**
- Kept the per-draft-event pin and added a `ResizeObserver` on the content column; when the user is at the bottom it sets `scrollTop = scrollHeight` on every height change (frame by frame). If the user scrolled up, nothing moves them. `ResizeObserver` is guarded (absent in jsdom).

### Files changed
- `apps/web/src/lib/useSmoothText.ts` (new), `apps/web/src/lib/useSmoothText.test.ts` (new)
- `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.ts`
- `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageList.test.tsx`
- `apps/web/src/index.css`
- `work/T-0045-smooth-drafts.md`

No other files touched (`git status` confirms). No new dependencies.

### Color tokens (before / after)
| | Normal incoming text | While generating (text) | While generating (bubble) |
|---|---|---|---|
| Light | `--foreground` `#000000` | `--bubble-in-generating` `#707579` | `bg-bubble-in/90` (`color-mix(in oklab, #ffffff 90%, transparent)`) |
| Dark | `--foreground` `#f5f5f5` | `--bubble-in-generating` `#8ba0b2` | `bg-bubble-in/90` (`color-mix(in oklab, #182533 90%, transparent)`) |

Transition: `transition-[color,background-color] duration-[400ms] ease-out`. The dark gray is lighter than the light gray because the dark bubble is darker; both keep text contrast on the bubble above 4.5:1.

### Tests added
- `useSmoothText.test.ts` (6): grows monotonically and stays a prefix; clears a 500-char backlog within `SMOOTH_CATCH_UP_MS + 50`; keeps ≥ 60 chars/s minimum; restarts at the longest common prefix on a shrink; reduced motion shows the target at once (no frame scheduled); `initial: 'full'` paints the first target and animates later growth.
- `realStore.test.ts` (3): the swap records `messageId → turnId`; the record caps at 50 (oldest dropped); `stop()` and `signOut()` clear it.
- `MessageList.test.tsx` (4): the draft has the generating text class and caret; after the swap with longer text the **same DOM node** (asserted via the new `data-draft-turn`) keeps revealing from the draft part and keeps the generating look, then drops caret/class when complete; a history message never has the generating look; reduced motion shows the full text at once.

### Commands (real results)
```bash
pnpm install                                        # Done in 10.9s, 910 packages (pnpm 10.32.1)
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/web   # Test Files 32 passed (32); Tests 194 passed (194)
pnpm build                                          # Tasks: 2 successful, 2 total; web built in ~0.5s
```

### Problems / notes
- **Live visual check not done by me** (no browser here); only the automated checks above. The steps for the lead are below.
- **Dimming choice.** I dim the bubble via `bg-bubble-in/90` instead of an `opacity` on the bubble container, because a container opacity would also fade the text and push contrast under 4.5:1 (and the CSS tail uses `--bubble-in` directly, which the spec's "only add tokens" rule for `index.css` keeps me from re-plumbing).
- **Reveal after a remount.** `initial: 'full'` means switching away from a chat and back mid/post reveal shows the already-shown text immediately and only animates remaining growth; it never replays a finished reveal or re-shows an empty bubble. This is an option on the hook, not a change to the default semantics.
- **The `finishedDraftMessages` entry is kept for the session** (capped at 50) so the bubble key stays stable after the reveal; the look is already normal because `done` is true.
- No open questions; no deviations from the acceptance criteria.

### Live check (for the lead, with Julio's permission)
1. Open an AI DM and ask for a longer answer. Expect: the bubble appears and the text flows smoothly (not in 150 ms chunks); while writing the text is gray, the bubble slightly dimmed, and a caret blinks; when the final message arrives the **same** bubble carries on from where the draft was up to the full text and fades to the normal black/white look over ~0.4 s — no snap.
2. Repeat in the light and in the dark theme (`prefers-color-scheme`).
3. While it writes, scroll up: nothing pulls you down. Scroll back to the bottom and it stays pinned as the rest arrives.
4. Optionally throttle the network so the final message carries a large missing tail, to confirm the whole tail is revealed smoothly.

## Review (written by Claude)
