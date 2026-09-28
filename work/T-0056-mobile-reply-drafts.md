---
id: T-0056
title: Mobile shows AI reply drafts — SSE over XHR (bearer), smooth reveal, recessed generating bubble, same-node swap to the final message
status: review
milestone: M2
branch: task/T-0056-mobile-reply-drafts
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0045, T-0048]
estimate: 1.5 days
---

# T-0056: Reply drafts on mobile

## Spec (written by Claude, do not edit)

### Goal

On the web, an AI reply streams in while it's written:
- a recessed gray "generating" bubble reveals the text smoothly;
- then it presses out into a normal incoming card when the final message arrives, with no jump or replay (T-0043, T-0044, T-0045, T-0047).

On mobile, the owner still waits in silence and then gets the whole reply at once. This task brings the same experience to the Expo app. The server needs no change: `GET /api/drafts/stream` accepts the mobile bearer session like every other `/api` route.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0043-web-reply-drafts.md`, `T-0044-draft-tail-flush.md`, `T-0045-smooth-drafts.md`: the event protocol, the timers, the same-node swap, the reveal rules, and the lessons in their Reviews (especially the idle-expiry fix: an idle draft is **removed without finishing the turn**)
- `apps/server/src/drafts/routes.ts` and `events.ts` (read only): the SSE format (`event: draft` with `{chatJid, turnId, text}` cumulative, `event: end` with `{chatJid, turnId, outcome}`)
- The web implementation, as the reference to port (don't import from `apps/web`):
  - `apps/web/src/lib/drafts.ts` (the stream client and parsing);
  - `apps/web/src/store/realStore.ts` (draft state: `DRAFT_IDLE_MS`, `DRAFT_END_FALLBACK_MS`, `finishedTurns`, `armDraftRemoval`, the swap in the incoming-message handler, `finishedDraftMessages`);
  - `apps/web/src/lib/useSmoothText.ts` (the reveal, `safeCut`, reduced motion, `'full'` start, the hidden-tab snap);
  - `MessageBubble.tsx` (the generating label and caret, the 400 ms transition, `revealTurnId`) and `MessageList.tsx` (the `draft-${turnId}` keys).
- Mobile: `src/store/real-store.ts`, `chat-store.ts`, `types.ts`, `src/lib/chat-api.ts` (bearer token, `API_URL`), `src/lib/session-token.ts`, `src/components/chat/message-bubble.tsx`, `message-list.tsx`, `chat-header.tsx`, `src/lib/depth.ts` (`bubbleStyle('generating')` from T-0048)
- `docs/design/ui-style.md` §5 (the generating bubble)

### Allowed files (under `apps/mobile/src/`)
- `lib/drafts.ts` (new), plus `lib/drafts.test.ts` (new)
- `lib/use-smooth-text.ts` (new), plus its test
- `store/real-store.ts`, `store/chat-store.ts`, `store/types.ts`, plus their tests
- `components/chat/message-bubble.tsx`, `message-list.tsx`, `chat-header.tsx`
- `mock/**`: a mock draft scenario for screenshots
- `apps/mobile/screenshots/T-0056/**`
- `work/T-0056-mobile-reply-drafts.md`

**Not allowed:** `apps/web/**`, `apps/server/**`, `packages/**`, `docs/**`, other mobile files. No new dependencies.

### What to build

**1. The SSE client (`lib/drafts.ts`).**
- React Native's `fetch` doesn't stream response bodies, and there's no `EventSource`. Implement a small SSE reader over `XMLHttpRequest`: RN delivers partial `responseText` in `onprogress` / `readyState 3`.
  - Send `Authorization: Bearer <token>` from the session token.
  - Parse `event:` / `data:` frames incrementally, keeping the last offset, with frames possibly split across chunks.
  - Validate each `data` with zod (the same shapes as the web), and drop invalid frames.
- Reconnect with backoff (1 s → 30 s cap, jittered) while signed in and the app is **active**. Close it when the app goes to the background (`AppState`), and reopen it on `active`.
- Never log the token or draft text.
- Test it with a fake XHR: split frames, several frames in one chunk, a bad JSON frame, reconnect, and close on background.

**2. The store: port the web draft logic exactly.**
- `drafts[chatJid] = { turnId, text }`, with the same idle and fallback timers.
- A late `draft` for a finished turn is ignored.
- `end` arms the fallback.
- The AI's final XMPP message in that DM replaces the draft **in the same update**, and the list keeps the same item key (the web's `revealTurnId` / `finishedDraftMessages` idea).
- Idle expiry removes the draft **without** marking the turn finished.
- A message from my own JID (another device) doesn't end the draft.
- Port the web tests' cases.

**3. The UI.**
- **Generating bubble:** the recessed `bubbleStyle('generating')` look with `--generating-foreground` text, a blinking caret (no blink with reduced motion), and the mono `generating` label with a pulsing dot.
- The reveal uses a port of `useSmoothText`, driven by `requestAnimationFrame` (available in RN): the same catch-up, the minimum speed, `safeCut`, the `'full'` start, and reduced motion. It **snaps** when the app returns to `active` (the equivalent of the web's hidden-tab snap).
- **Swap:** when the final message arrives, the same list item (the same key) animates over 400 ms from the recessed look to the incoming look, and the text never replays. With reduced motion, the change is instant.
- **The header:** the subtitle shows `writing…` while a draft is active in that AI chat. The chat list row shows `writing…` too, if the list has a typing preview (reuse it).
- The list stays pinned to the bottom while the draft grows, if the user is at the bottom; scrolling up doesn't jump.

### Tests (Vitest, no network)
- `drafts.ts` with a fake XHR, as above.
- The store:
  - draft → final swap in one update;
  - a late draft ignored;
  - the idle expiry doesn't finish the turn;
  - the end fallback;
  - my other device doesn't end the draft;
  - the item key is stable across the swap.
- `use-smooth-text`: the same cases as the web test, plus the `active` snap through a fake `AppState` seam.

### Visual check (you have vision)
- Follow T-0048's simulator rules **exactly**:
  - your own simulator, never Julio's `DB167CD4-…`;
  - Metro on 8082, never 8081;
  - delete your simulator and stop your Metro at the end;
  - **don't move the host mouse or keyboard** (no `cliclick`, no AppleScript key events). Julio's Mac may be in use. Navigate with mock-mode deep links (`simctl openurl`) instead.
- In mock mode, take screenshots of:
  - a draft mid-stream (recessed, caret, label);
  - the same chat after the swap;
  - the header showing `writing…`.
- Save them to `apps/mobile/screenshots/T-0056/`. There's an image budget: about 8 images.

### Acceptance criteria
- [ ] Every check below passes.
- [ ] Drafts stream over the bearer SSE client, reveal smoothly, and swap to the final message without a jump or replay.
- [ ] The timers and finish rules match the web.
- [ ] The app's background/active state closes and reopens the stream, and snaps the reveal.
- [ ] Only the Allowed files changed; no dependencies added; no host input automation.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/mobile
pnpm --filter @galena/mobile build
```

### Out of scope
- Markdown rendering on mobile (a separate task).
- Drafts in groups.
- Push notifications.

## Report (written by the worker when done)

### What I did

**1. SSE client — `apps/mobile/src/lib/drafts.ts` (+ `drafts.test.ts`)**
- `subscribeToDrafts(onEvent, options) => close` reads the SSE stream from
  `XMLHttpRequest.responseText` (React Native has no `EventSource`, and its `fetch`
  does not stream bodies). It keeps a parsed-character `offset` plus a frame buffer, so
  frames split across chunks and several frames in one chunk both parse correctly;
  `:` heartbeat lines are ignored.
- Every `data:` payload is validated against the server contract (the same shapes as
  `apps/server/src/drafts/events.ts`). The mobile app has no `zod` and this task forbids
  new dependencies, so it is a hand-written validator in the style of `chat-api.ts` /
  `auth-api.ts`. Bad JSON and wrong shapes are dropped silently; nothing throws.
- Sends `Authorization: Bearer <token>` (from `getSessionToken`) and
  `Accept: text/event-stream`. The token and draft text are never logged.
- Follows the injected `AppState` seam: the stream closes on background and reopens on
  `active`; a dropped connection reconnects with a jittered `1 s -> 30 s` backoff while
  signed in and active, and the backoff resets once a partial response arrives.

**2. Store — `store/types.ts`, `store/real-store.ts`, `store/chat-store.ts`**
- Ports the web draft logic exactly: `drafts[chatJid] = { turnId, text }`,
  `DRAFT_IDLE_MS = 60_000` (re-armed by every draft; removes the bubble **without**
  finishing the turn, so a resumed tool call shows again), `DRAFT_END_FALLBACK_MS = 5_000`
  on `end`, a finished-turn set capped at 50, and late drafts for a finished turn ignored.
- The AI's final XMPP message replaces the draft in the **same** `set` and records
  `finishedDraftMessages[messageId] = turnId`. The new `draftEntryKey` helper
  (`store/types.ts`) gives that message the same `draft-<turnId>` key the synthetic draft
  used, so the bubble and its reveal are reused. A message from my own JID (a second
  device) does not end the draft.
- `start()` opens the stream once after boot; `stop()` closes it, clears the timers and
  finished turns, and empties `drafts`/`finishedDraftMessages`. `RealStoreDeps.openDrafts`
  is the test seam, as in the web store. The mock store gained the same state plus a
  screenshot scenario (`mock/drafts.ts`, `EXPO_PUBLIC_GALENA_MOCK_DRAFT=stream|final`).

**3. UI**
- `lib/use-smooth-text.ts`: a port of the web reveal as a testable `SmoothTextReveal`
  class (the hook is a thin wrapper). Same catch-up (~350 ms), the 60 chars/s floor, the
  longest-common-prefix restart, the surrogate-pair-safe cut, reduced motion, and the
  `active` snap.
- `components/chat/message-bubble.tsx`: the recessed `bubbleStyle('generating')` look with
  `--generating-foreground` text, a blinking caret (static with reduced motion) and the
  mono `generating` label with a pulsing dot. Time and ticks stay on screen invisible while
  generating (width reserved). On the swap the incoming look fades in over the recessed
  shell over 400 ms (instant with reduced motion); the text never replays.
- `components/chat/message-list.tsx`: appends the trimmed draft as the last item, keys it
  and the final message `draft-<turnId>`, and pins to the bottom via `onContentSizeChange`
  only while the user is at the bottom.
- `components/chat/chat-header.tsx` and `components/chat/chat-list-item.tsx`: show
  `writing…` while a draft is active in that chat.

### Files changed
- `apps/mobile/src/lib/drafts.ts` (new), `apps/mobile/src/lib/drafts.test.ts` (new)
- `apps/mobile/src/lib/use-smooth-text.ts` (new), `apps/mobile/src/lib/use-smooth-text.test.ts` (new)
- `apps/mobile/src/store/types.ts`, `types.test.ts` (new), `real-store.ts`, `real-store.test.ts`,
  `chat-store.ts`
- `apps/mobile/src/mock/drafts.ts` (new)
- `apps/mobile/src/components/chat/message-bubble.tsx`, `message-list.tsx`, `chat-header.tsx`,
  `chat-list-item.tsx` (lead-allowed extra file; see below)
- `work/T-0056-mobile-reply-drafts.md`

No other files changed; no dependencies added; no host input automation.

### Tests added
- `lib/drafts.test.ts` (7): the bearer header and URL; a frame split across chunks; several
  frames plus a heartbeat in one chunk; invalid JSON/shapes/heartbeats dropped; reconnect
  with a growing jittered backoff (fake timers); close on background and reopen on active;
  `close()` aborts and stops reconnecting; no open without a token or while starting in the
  background.
- `lib/use-smooth-text.test.ts` (9): monotonic prefix growth; no half emoji; catch-up within
  the window; the minimum speed; restart at the common prefix on a shrink; reduced motion
  shows the target at once; `initial: 'full'` paints the first target then animates growth;
  the `active` snap (fake `ActiveSource`); `safeCut`.
- `store/types.test.ts` (3): `draftEntryKey` keeps a plain id, keeps the draft key for the
  finishing message, and is stable across the swap.
- `store/real-store.test.ts` (+13): opens the stream after boot; draft->message swap in one
  update with no gap/duplicate and a late draft ignored; the draft survives a message from my
  own JID; the `end` fallback; the idle expiry does not finish the turn (and a resume shows);
  a refresh re-arms the idle timer; latest text on a shrink; a new turn is not dropped by a
  stale fallback; the finished-message record and its 50 cap; stop closes the stream, clears
  the state and leaves no second stream.

### Commands (real results)
```bash
pnpm install                                        # Done in 7s using pnpm v10.32.1
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/mobile
                                                    # Test Files 23 passed | 2 skipped (25); Tests 203 passed | 2 skipped (205)
pnpm --filter @galena/mobile build                  # Exported: dist (ios + android bundles)
```

### Problems / deviations
- **No `zod` on mobile.** The spec asked for zod validation, but the mobile package has no
  zod and the task forbids new dependencies, so `drafts.ts` validates by hand, matching the
  existing `chat-api.ts` convention. The shapes are identical to the web's.
- **Two lead-allowed files.** Chat-list `writing…` needs
  `components/chat/chat-list-item.tsx`, which was not in the original Allowed list; the lead
  approved the one-line edit during the run.
- **The 400 ms swap is an opacity crossfade.** React Native has no CSS transitions, so the
  recessed shell is kept and the incoming background/border/shadow fade in over it with an
  `Animated` opacity (native driver), instant with reduced motion. The text color switches
  with `generating`, which is one frame rather than interpolated.
- **The list key is tested through `draftEntryKey`.** The component render tree is not
  unit-tested (the mobile app has no React Native testing library, and the task's Tests
  section lists only the client, the store and the reveal), so the "same key across the
  swap" is asserted on the pure helper the list uses.
- **Visual check:** done on my own simulator (see below). Because the app requires a
  session to reach the chat screen, I used the same capture-only, uncommitted mock auth
  bypass T-0048 used, plus a mock-only redirect from the list to `/chat/dev-ai`
  (`xcrun simctl openurl` on iOS 26 raises an "Open in Galena?" confirmation that cannot be
  answered without host input). Both temporary edits were reverted before this commit.

### Visual check (mine)
- Own simulator: created `Galena T-0056` (iPhone 17, `8929DF41-5296-496D-A83D-78AE441BBDD3`),
  Metro on **8082**, mock mode (`EXPO_PUBLIC_GALENA_MOCK=1`,
  `EXPO_PUBLIC_GALENA_MOCK_DRAFT=stream|final`). `boot:ios`: **PASS** (bundle loaded, JS ran,
  no errors). At the end I stopped my Metro and shut down and **deleted** only my simulator.
  Julio's `DB167CD4` stayed shut down and was never booted; Metro 8081 was untouched (its
  process is still listening).
- Screenshots in `apps/mobile/screenshots/T-0056/`:
  - `01-chat-list-writing.png` — the chat list; the **Dev AI** row shows `writing…` with the
    pulsing dot.
  - `02-draft-stream.png` — the Dev AI chat mid-reply: a **recessed** bubble (well background,
    inset shadow) with gray text, the blinking caret `▍`, and the mono `generating` label with
    its dot; the header shows `writing…`.
  - `03-after-swap.png` — the same chat after the swap: the completed reply renders as a normal
    incoming card, in the draft's place, with no caret or `generating` label.
- What I could not verify by eye: the live frame-by-frame smoothness and the 400 ms fade (the
  mock scenario is static, not a real SSE stream), and the resume/foreground snap. Those are
  covered by the unit tests; a live check against a running server is the lead's step.

### Steps for the lead (live check, with Julio's permission)
1. Open an AI DM and ask a question that needs a longer answer: the reply should grow smoothly
   in a recessed gray bubble with a caret and a `generating` label, the header should read
   `writing…`, and the final message should replace it with no jump or replay.
2. Background the app mid-reply and return: the stream should reopen and the reveal should
   snap to the latest text (no fast-forward replay).
3. Scroll up while it writes: nothing should pull the view down; scroll back to the bottom and
   it stays pinned.

## Round 2 (review fixes)

**1. `03-after-swap.png` was the wrong state — the mock scenario, not the store swap.**
Investigation: the store swap is correct, and `real-store.test.ts` already covers it
("replaces the draft with a message that arrives before end, in one update" asserts the
final message replaces the draft in the same update, with no gap or duplicate). The
screenshot was wrong because the mock `final` phase pointed `finishedDraftMessages` at
`dev-ai-09` ("Tests pass. Merge?") — an **older** message — and never added a message with
the draft's reply text, so no final reply existed to show. Fixed in `mock/drafts.ts` and
`chat-store.ts`: the `final` phase now appends a completed `dev-ai` message whose text is
the draft's full reply (`MOCK_DRAFT_FINAL_TEXT`, which extends the streamed
`MOCK_DRAFT_STREAM_TEXT`) and records it as the draft's finishing message, so the final
incoming message sits in the draft's exact place. New mock-store tests
(`chat-store.test.ts`) cover the `stream` and `final` phases. Only `03-after-swap.png` was
retaken; it now shows the completed reply in the incoming-card look.

**2. `finish()` now flushes the tail.** `apps/mobile/src/lib/drafts.ts` calls `pump()`
before closing the XHR, so a tail delivered only with readyState 4 / `onload` / `onerror`
is parsed. Test: the fake XHR pushes a partial `draft` at readyState 3 and completes with
the rest plus the `end` at readyState 4; both events are delivered.

**3. `open()` retries without a token.** A missing token or a throwing `getToken()` now
schedules the normal jittered backoff instead of going silent until an AppState cycle.
Tests: token `undefined` then present (the second attempt connects, with the bearer
header); `getToken()` throws then succeeds.

**4. Generating tail colour.** `BubbleTail` uses `WELL_BACKGROUND` while generating, so
the tail matches the recessed body instead of the darker incoming stop.

**5. `use-smooth-text` option changes.** `SmoothTextReveal.setOptions({ animate, reducedMotion })`
updates the reveal after construction, and `useSmoothText` applies it when those options
change; the `active` subscription is now always installed (its `snap()` no-ops while
animation is off). Tests: reduced motion turning on shows the target at once; animation
turning on resumes the reveal for later growth.

### Checks (Round 2, real results)
```bash
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # no output, exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/mobile
                                                    # Test Files 23 passed | 2 skipped (25); Tests 209 passed | 2 skipped (211)
pnpm --filter @galena/mobile build                  # Exported: dist (ios + android)
```
`PREREVIEW.md` (untracked) needed `prettier --write` in place to keep `format:check`
green; it is left untracked and is not in the commit.

## Review (written by Claude)
