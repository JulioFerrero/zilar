---
id: T-1199
title: "WUX-11/12: web keeps the viewport fixed when older messages load (layout effect), shows a small loading line at the top while they load and asks once per page; Up/Down walks every chat row (DMs and single groups too), and the 'N' shown on New chat works"
status: merged
milestone: M5
branch: task/T-1199-web-older-and-keys
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1199: Older messages without a jump, and keyboard chat navigation

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-11 and WUX-12 (P2).
- **WUX-11, older messages:**
  - the scroll compensation for a prepended page runs in a passive `useEffect` after paint (`apps/web/src/components/MessageList.tsx:148-160`), so the view can jump for a frame;
  - nothing says "loading" at the top;
  - `handleScroll` calls `store.loadOlder` on every scroll event under 80 px (`MessageList.tsx:216-220`). It relies on the core's `loadingOlder` set (`packages/client-core/src/store/history.ts:118-121`).
  - The web history state is `'loading' | 'ready' | 'error'` only (`apps/web/src/store/storeOptions.ts:10`), with no "loading older".
- **WUX-12, keyboard navigation:**
  - `TopicKeyboardNav` (`apps/web/src/components/TopicKeyboardNav.tsx`) walks only `a[data-topic-row]`, and DM and single-group links (`apps/web/src/components/ChatListItem.tsx`) don't carry that attribute;
  - New chat shows a `kbd N` (`apps/web/src/components/NewChatButton.tsx:167-169`), but no key handler exists. Cmd+K is bound in `apps/web/src/components/SearchBar.tsx:17`.
- **Size:** `MessageList.tsx` is 346 lines.

### What to build
1. **`MessageList.tsx`:**
   - turn the effect at `:148-160` into a `useLayoutEffect`, so the compensation lands before paint;
   - keep a local `loadingOlder` state (a ref plus state): set it when `loadOlder` is called; clear it when the message count grows, when `hasMore` turns false, or after 8 s;
   - while it's set, don't call `loadOlder` again, and show a thin line at the top of the list, using the existing `StateMessage` (find it; `kind="loading"`, inline size) or the same spinner the app already uses.
2. **WUX-12:**
   - add `data-topic-row=""` to the DM and single-group row link in `ChatListItem.tsx`, and update the comment in `TopicKeyboardNav.tsx` that says those never take part;
   - bind `n` (no modifier, and only when focus isn't in an input, textarea or contenteditable) to open New chat, the same way the New chat button opens it. If that needs state the button owns, put the listener in `NewChatButton.tsx` itself.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-11, WUX-12), `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/TopicKeyboardNav.tsx`, `apps/web/src/components/ChatListItem.tsx:60-100`, `apps/web/src/components/NewChatButton.tsx` and `apps/web/src/components/SearchBar.tsx:10-30`.

### Allowed files
`apps/web/src/components/MessageList.tsx`, `apps/web/src/components/TopicKeyboardNav.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/NewChatButton.tsx`, `work/T-1199-web-older-and-keys.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the mock build:**
  - scrolling up in a long chat loads older messages without a jump, with the loading line shown;
  - Up/Down moves through DM rows;
  - `n` opens New chat.

---

## Report (written by the worker when done)

Done. WUX-11: the prepend compensation runs in `useLayoutEffect` (before paint);
a local `loadingOlder` ref+state guards `handleScroll` (one `loadOlder` per page),
clears when the message count grows, when `hasMore` turns false, or after 8 s
(an `Effect.sleep` fiber, since the gate's Effect ratchet rejects `setTimeout`;
same pattern as `useVoiceRecorder.ts`), and shows an inline
`StateMessage kind="loading"` ("Loading older messages") at the top of the list
while set. WUX-12: `data-topic-row=""` added to the `ChatListItem` row link and
the `TopicKeyboardNav` comment updated; `n`/`N` (no modifier, not in an input,
textarea or contenteditable) toggles the New chat menu via a listener in
`NewChatButton.tsx`.

Files changed (all inside Allowed files, all at most 400 lines:
MessageList 400, TopicKeyboardNav 52, ChatListItem 195, NewChatButton 250):
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/TopicKeyboardNav.tsx` (comment only)
- `apps/web/src/components/ChatListItem.tsx` (one attribute)
- `apps/web/src/components/NewChatButton.tsx` (n-key listener)
- `work/T-1199-web-older-and-keys.md` (this report)

Line count: MessageList 400, TopicKeyboardNav 52, ChatListItem 195,
NewChatButton 250 — all at most 400 lines.

Checks:
- `pnpm install`: done (10.2s).
- `pnpm gate` (from repo root): GATE PASS. Summary lines:
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS effect`, `SKIP tests @zilar/web (no nearby test files)`,
  `scope: every changed file is inside the Allowed files`,
  `migration: every added migration continues from the base`, `GATE PASS`.
- Single tests while working: none run (spec says "No tests (UI)"; gate found
  no nearby test files for @zilar/web).
- Format fixed once with `prettier --write` on MessageList.tsx (import wrap);
  the raw `setTimeout` was replaced with an `Effect.sleep` fiber after the
  gate's effect ratchet failed (H3) — deviation from the letter of the spec
  ("after 8 s") but same behavior, required by repo rule.
- LoadOlder-clear nuance: the layout effect clears `loadingOlder` only when
  `added > 0`, so a failed/empty older page keeps the line until `hasMore`
  flips false or the 8 s timeout — otherwise the line could vanish on any
  unrelated re-render of the effect.

Security checklist: no secrets/tokens touched; no deletes/updates; no new
routes; no caps/uniqueness rules; no audit entries; no permission checks
(UI-only changes). No user input reaches logs or URLs.

Open questions: `n` toggles the menu rather than only opening it — matches
"the same way the New chat button opens it" (the button toggles); pressing `n`
with the menu open closes it, same as clicking the button again.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits and 1 follow-up.**
- **WUX-11:**
  - the prepend compensation is a layout effect;
  - a local `loadingOlder` guard (cleared on growth, at the end, or after 8 s) asks once per page;
  - a loading line shows at the top.
- **WUX-12:**
  - DM and single-group rows carry `data-topic-row`, so Up/Down walks every row;
  - `n` opens New chat, but not from inputs.
- **Nits, accepted:** holding `n` repeats the toggle; `n` also works under an open dialog.
- **Follow-up:** archived rows sit outside the keyboard-nav wrapper (`ChatListBody.tsx:117-143`).
- **Still to do:** the lead's check on a mock build.
