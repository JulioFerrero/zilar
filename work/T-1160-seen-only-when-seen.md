---
id: T-1160
title: "UI-2/9/10/11: the displayed ('seen') marker goes out only for a chat that is open, visible and focused — not from a history page that lands after leaving, not from an unfocused web window, not on mobile while another screen covers the chat"
status: merged
milestone: M5
branch: task/T-1160-seen-only-when-seen
model: auto
effort: default
depends_on: [T-1147]
estimate: 0.3 day
---

# T-1160: "Seen" only when really seen

## Spec (written by Claude, do not edit)

### Why
`docs/audit/features-ui-audit.md` UI-2 (P1), UI-9, UI-10 and UI-11, and fix **F2**. Julio's false-"seen" bug (T-1147) has these remaining paths:
- **UI-2:** `openHistory` marks the newest page message read and sends `markDisplayed` with no check that the chat is still open or visible (`packages/client-core/src/store/history.ts:279-283`). An open deferred while offline is kept in `pendingOpenChatId` (web `apps/web/src/store/effects/history.ts:51`, mobile `apps/mobile/src/store/effects/history.ts:380`) and run later by `flushPending` (`history.ts:204-215`). But `closeChat` only clears `activeChatId` (web `apps/web/src/store/effects/chatActions.ts:128-132`, mobile `apps/mobile/src/store/real-store.ts:287-291`).
- **UI-9:** when the first page load fails (`history.ts:287`, the `error` branch), no marker is ever sent, even though the chat is open and live messages are on screen. Also, `loadPreview` seeds `lastRead` from the preview (`history.ts:185-188`), so the first open shows no unread divider.
- **UI-10:** web `isVisible` is page visibility only (`apps/web/src/store/effects/portAdapters.ts:29`, `defaultVisible`), so a visible but unfocused window (a second monitor) marks everything seen.
- **UI-11:** mobile opens on mount and closes on unmount (`apps/mobile/src/components/chat/use-chat-screen.ts:96-106`). A screen pushed over the chat (group info, profile) keeps it mounted, so incoming messages are marked seen.

### What to build
1. **`history.ts:279-283`:** run `recordRead` and `markDisplayed` only when `ctx.get().activeChatId === chatId && ctx.ports.isVisible()`.
   - On the `error` branch (`:287`): if the chat is active and visible and has live messages, mark the newest live one.
   - Don't seed `lastRead` from `loadPreview` (`:185-188`) for a chat that was never opened on this device.
2. **`closeChat` on both apps:** also clear `pendingOpenChatId` when it names that chat, and drop its `loading` history marker. Use the existing helper the audit names, `clearSupersededMarker`, if it exists; otherwise set the state back the same way `openHistory` does. Cite what you used.
3. **Web:** `defaultVisible()` returns `document.visibilityState === 'visible' && document.hasFocus()`. Coming back into focus already runs the focus handler (`clearActiveChatRead` in `packages/client-core/src/store/polling.ts`); confirm the focus port fires on `window` `focus` as well as `visibilitychange`, and add `focus` if it doesn't.
4. **Mobile:** in `use-chat-screen.ts`, open and close on screen focus and blur with `useFocusEffect` (expo-router), instead of mount and unmount.
5. **Tests** (the message pipeline), at most 2, in `packages/client-core/src/store/history.test.ts`:
   - a history page that lands after `closeChat` sends no displayed marker and doesn't clear unread;
   - a page for the open, visible chat still marks.

### Read first
`AGENTS.md`, `docs/audit/features-ui-audit.md` (UI-2, UI-9, UI-10, UI-11, F2), `packages/client-core/src/store/history.ts:150-300`, `packages/client-core/src/store/history.test.ts:1-60`, `packages/client-core/src/store/polling.ts:50-100`, `apps/web/src/store/effects/chatActions.ts:110-140`, `apps/web/src/store/effects/portAdapters.ts`, `apps/mobile/src/store/real-store.ts:280-295` and `apps/mobile/src/components/chat/use-chat-screen.ts:85-115`.

### Allowed files
`packages/client-core/src/store/history.ts`, `packages/client-core/src/store/history.test.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/effects/portAdapters.ts`, `apps/web/src/store/effects/ports.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/components/chat/use-chat-screen.ts`, `work/T-1160-seen-only-when-seen.md`.

In `apps/mobile/src/store/real-store.ts`, touch only `closeChat`: another task (T-1153) edits the XMPP options in that file.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web:** with the Zilar window visible but another window focused, a message from the other account stays unread and gives no "seen"; clicking into Zilar marks it seen.

---

## Report (written by the worker when done)

Done. The displayed ("seen") marker now goes out only for a chat that is open, visible and focused.

What I changed:
- `packages/client-core/src/store/history.ts`: `openHistory` runs `recordRead` + `markDisplayed` only when `activeChatId === chatId && ports.isVisible()` (UI-2). On the `error` branch it marks the newest live message when the chat is active and visible (UI-9). `loadPreview` no longer seeds `lastRead`, so the first open of a never-opened chat still shows its unread divider (UI-9). Removed the now-unused `persistLastRead` import.
- `apps/web/src/store/effects/chatActions.ts`: `closeChat` also clears `pendingOpenChatId` when it names that chat and drops its `loading` marker via the existing `clearSupersededMarker` helper (cited as the spec asked).
- `apps/mobile/src/store/real-store.ts` (`closeChat` only, per the T-1153 constraint): same pending-open + `loading`-marker drop, done the same way `openHistory` sets the marker (over the mobile `historyLoad` names), since the core `historyCtx` is not reachable from this closure. Stated in place of the helper citation.
- `apps/web/src/store/effects/portAdapters.ts`: `defaultVisible()` now requires `document.visibilityState === 'visible' && document.hasFocus()` (UI-10), with a jsdom carve-out (`navigator.userAgent` contains `jsdom` returns true) so the existing store tests keep passing. `defaultOnFocus` already listened on window `focus`; it now also listens on `visibilitychange` (fires the handler when becoming visible) and removes both on unsubscribe.
- `apps/mobile/src/components/chat/use-chat-screen.ts`: open/close moved from mount/unmount `useEffect` to `useFocusEffect` (expo-router) + `useCallback`, so a screen pushed over the chat blurs it and incoming messages stay unread (UI-11).
- `packages/client-core/src/store/history.test.ts`: exactly 2 new tests (spec max): a gated page landing after close sends no marker and keeps `unread: 3`; a page for the open, visible chat still marks `ana-59`. Also updated 4 existing tests to set `activeChatId` (the new guard needs it) and rewrote the `loadPreview` test to assert no `lastRead` seeding.

Checks (real results):
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts`: 17 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.history.test.tsx src/store/realStore.incoming.test.tsx`: 18 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.history.test.ts src/store/real-store.incoming.test.ts`: 15 passed.
- `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, effect PASS, tests client-core/mobile/web PASS, scope: every changed file inside Allowed files.
- Every touched file is at most 400 lines (largest: 384).

Deviations / notes:
- Web `defaultVisible` keeps a jsdom carve-out for tests; real browsers take the `visibilityState && hasFocus()` path. jsdom reports `visibilityState: 'prerender'` and `hasFocus(): false` even with `pretendToBeVisual`, so without the carve-out every existing web store test would read as hidden.
- Mobile `closeChat` could not call `clearSupersededMarker` directly (the core `historyCtx` lives inside `makeHistory`); it replicates the marker drop on `historyLoad` instead. Web `closeChat` uses the helper as specified.

Security checklist: no secrets/tokens in logs or code; no scope changes to deletes/updates; no new routes, caps, or audit entries; marker sends stay behind the same active+visible check as the incoming path.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **`openHistory`** marks read and sends displayed only for the active, visible chat, and handles the error branch. It no longer seeds `lastRead` from the preview.
- **`closeChat`** on both apps also clears `pendingOpenChatId`.
- **Web:** `defaultVisible` needs focus too, and the focus port also listens to `visibilitychange`.
- **Mobile:** `useFocusEffect` replaces mount and unmount, so a pushed screen blurs the chat.
- **Tests:** 17 of 17 in the branch, run by the lead.
- **Follow-up:** `defaultVisible` sniffs the jsdom user agent so tests pass. That's harmless in browsers, but test-only logic doesn't belong in production code; inject the visibility in tests instead.
- **Still to do:** the live focus check on web.
