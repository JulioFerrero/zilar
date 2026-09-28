---
id: T-0056
title: Mobile shows AI reply drafts — SSE over XHR (bearer), smooth reveal, recessed generating bubble, same-node swap to the final message
status: planned
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

## Review (written by Claude)
