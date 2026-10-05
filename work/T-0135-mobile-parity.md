---
id: T-0135
title: Mobile: chat preferences and pinned messages
status: merged
milestone: M5
branch: task/T-0135-mobile-parity
model: meta/muse-spark-1.3-contributor
depends_on: [T-0112, T-0113, T-0114]
estimate: 2 days
---

# T-0135: Mobile parity for chat preferences and pins

## Spec (written by Claude, do not edit)

### Why
Web has per-user mute/archive/pin for chats and topics (T-0113) and pinned messages (T-0114); mobile has neither. The server APIs exist. Mobile is the smaller share of the work (about 20%), so keep this small and match how the mobile app already does lists, sheets and stores. Read `AGENTS.md` first. Nothing here can be run in a simulator by the worker (Julio's simulators are off limits), so tests and typecheck carry the proof; say what still needs eyes.

### What to build
1. **Chat prefs on mobile**: use `/api/chat-prefs` (see `apps/server/src/chat-prefs/routes.ts` and the web `lib/api.ts` client for the shapes). Long-press (or the existing row action) on a chat or topic row opens an action sheet: Mute (1 hour, 8 hours, 1 week, always, unmute), Pin, Archive. Pinned chats sort first, muted rows show a muted icon and no unread badge sound/emphasis, archived chats leave the list and appear under an "Archived" entry at the bottom of the chat list. Follow the same rules the web store applies (a muted group's topics follow the group).
2. **Pinned messages on mobile**: a pinned banner under the chat header (latest pin, tap to jump to it, "n pins" opens a list sheet), and Pin/Unpin in the message action sheet for people who may pin (same rule as web: DM either side; groups and topics owner/admin). Use `/api/pins` (see `apps/server/src/pins/routes.ts`); the message snapshot is display-only text (max 300).
3. Mock mode: mobile has a mock (`EXPO_PUBLIC_ZILAR_MOCK`); extend it so both features work without a server.
4. Fix the small T-0112 should-fix items that are mobile-side: mock `addTopicAi` must not throw; a store test passes a chat JID where a group id belongs (fix the fake `getGroup` to catch it); `createTopic` must not report failure when only the follow-up chat-list re-read fails; a filtered group shows "1 topics" (pluralize); the new-topic sheet keeps the previous name.

### Read first
`AGENTS.md`, `work/T-0113-chat-prefs.md`, `work/T-0114-pinned-messages.md`, `work/T-0112-topics-mobile.md` (Report and Review), `apps/mobile/` (existing store, lists, sheets, mock).

### Allowed files
`apps/mobile/**`, `packages/chat-core/src/**` only if a shared type must change (say so in the Report), `work/T-0135-mobile-parity.md`. Not allowed: server, web, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2
```
(Affected tests while working; full mobile suite once at the end. Do NOT start simulators, Metro, or `expo run`.)

### Acceptance criteria
- [ ] Mute, pin and archive work in the store for chats and topics, with tests; the list ordering and Archived entry have render tests.
- [ ] Pinned banner, pin list and pin/unpin have render and store tests.
- [ ] Mock mode covers both.
- [ ] The T-0112 items in point 4 each have a test.

### Out of scope
Search on mobile, stickers, push, anything on web.

---

## Report (written by the worker when done)

### What I did
- **Chat prefs on mobile** (spec point 1): new `lib/chat-prefs-api.ts` (list/put `/api/chat-prefs`, hand-written guards, `{ prefs: null }` defaults-delete answer) and `lib/chat-prefs.ts` (mute durations 1h/8h/1d/1w/forever with the 2126 far-future stamp, `applyChatPrefs` merge with expired-mutes-read-unmuted and group-General-mute-inherits-to-topics, `sortChatPinnedFirst`, `sortArchivedLast`, `archivedChats`/`unarchivedChats`/`unmutedChats`). Both stores gained `setChatPref` (optimistic with rollback on failure; mock goes through the in-memory mock API and re-merges truth). Real store loads prefs at boot and on every list refresh (a prefs failure reads as unchanged rows, never a list failure); `mergeChatEntries`/`applyTopicRow` no longer preserve a local `muted` flag (server rows are authoritative).
- **Chat list** (`app/index.tsx` + new pure `lib/chat-list.ts` row model): pinned chats/topics float first (a group counts as pinned when any topic is), archived chats leave the main list for an "Archived (n)" entry at the bottom (expandable, rows unarchive from the same sheet), long-press on chat/group rows opens the new `ChatActionsSheet` (Pin/Unpin, Mute durations + Unmute, Archive/Unarchive, inline save error). Pin icon on pinned rows; muted rows keep the muted icon + grey badge. Folder unread totals (`lib/filter.ts`) exclude muted chats.
- **Topics screen**: long-press sheet upgraded to Pin/Unpin, Mute durations, per-user Archive/Unarchive, plus the manager "Archive topic for everyone" kept separate (renamed from "Archive topic" so the two archives are never confused). Group rows resolve to the General topic row for group mute/pin.
- **Pinned messages** (spec point 2): new `lib/pins-api.ts` (`GET /api/pins?chat=`, `POST /api/pins`, `DELETE /api/pins/:id` echoing the row) with display-only snapshot helpers (text max 300, kind labels; retracted originals read "Message deleted"). Both stores gained `pins`/`refreshPins`/`pinFor`/`canPin`/`pinMessage`/`unpinMessage`/`pinsError`/`dismissPinsError`: load on open, focus + 60 s poll while open, optimistic pin/unpin with restore on failure. `canPin`: DM either side; topics owner/admin via the loaded group detail (creator edge server-enforced only, as on web). `PinnedBanner` under the header (sender + text/kind label, tap jumps when loaded, "n pins" opens the list, 1-of-N cycling, "Message not found" + load-error inline), `PinsSheet` list with jump and per-row-disabled unpin, Pin/Unpin in the message action sheet via bubble → list → chat screen wiring.
- **Mock mode** (spec point 3): `mock/chat-prefs.ts` (in-memory prefs with defaults-delete) and `mock/pins.ts` (seeds: one text pin in the Ana DM, one photo pin in Viernes) wired into the mock store, including pins selectors and `canPin` (DMs + Dev-team topics, viewer owns the group). Mock stores reset prefs/pins/caches on creation so tests never leak.
- **T-0112 should-fix items** (spec point 4): mock `addTopicAi` no longer throws (in-memory no-op); fake `getGroup` in the topics store test now throws for a non-group id and the test asserts a chat JID resolves nothing; `createTopic` falls back to the created topic's chat JID when the follow-up re-read fails (no false "Could not create", no duplicate on retry); topic-count label centralised in `topicCountLabel` ("1 topic", tested); new-topic sheet remounts per open via `key` so it keeps no previous name (guarded by a real-source test).
- Render-testability: the four sheets/banner are pure views (no hooks; screens own the small UI state), tested with the direct-call stub pattern (`reaction-chips.test.tsx` precedent). Snapshot helpers live in dependency-free `lib/pin-snapshot.ts` because Vitest cannot resolve `@/` (or `better-auth` via `auth.ts`) for component modules — the `@/` imports in the four tested components were rewritten to relative paths.

### Files changed
- New: `apps/mobile/src/lib/{chat-prefs,chat-prefs-api,pins-api,pin-snapshot,chat-list}.ts` (+ tests), `apps/mobile/src/mock/{chat-prefs,pins}.ts`, `apps/mobile/src/components/chat/{chat-actions-sheet,pinned-banner,pins-sheet}.tsx` (+ tests), `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `apps/mobile/src/store/{real-store.prefs-pins,mock-prefs-pins}.test.ts`.
- Edited: `apps/mobile/src/store/{types,chat-store,real-store}.ts`, `chat-store-provider.tsx` (injects the prefs/pins API clients), `apps/mobile/src/app/{index.tsx,chat/[id].tsx,group/[id].tsx}`, `components/chat/{chat-list-item,group-list-item,topic-sheets,message-actions-sheet,message-bubble,message-list}.tsx`, `lib/{filter,topics}.ts` (+ tests), `lib/hooks-guard.test.ts` (real-source checks), `store/real-store.topics.test.ts` (fake getGroup + re-read-failure test), `work/T-0135-mobile-parity.md`.

### Commands run and real results
- `pnpm install`: pass (8.6s).
- `pnpm format:check`: pass for all owned files (the only remaining warn is the lead's untracked `PREREVIEW.md`, which I must not edit).
- `pnpm lint`: pass (oxlint clean; fixed 5 unused-var errors first: unused `Pin`/`PinKind`/`createChatPrefsApi` imports and an unused sheet-action param).
- `pnpm typecheck`: pass (turbo 10/10).
- Affected tests while working (each `pnpm --filter @zilar/mobile test --maxWorkers=2 <paths>`): all passed per batch (3 lib files 21 passed; prefs-pins store 10 passed; mock prefs-pins 7 passed; chat-list + chat-prefs 12 passed; 4 render suites 17 passed; topics/hooks-guard suites 31 passed).
- Full suite once at the end: `pnpm --filter @zilar/mobile test --maxWorkers=2` → 48 files passed, 2 skipped; 467 passed, 2 skipped (was 403 passed at T-0112; +64 new tests, zero regressions).
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|as any` in new/changed non-test source: no hits.
- No simulator, Metro, or `expo run` started (per spec; Julio's simulators off limits).

### Problems, deviations from the spec, open questions
- Banner jump at an unloaded message shows "Message not found": mobile has no history-paging seam (`openAtMessage`), so far-back pins cannot be jumped to yet — said here as specced for things that need eyes. Same for the pins 60 s poll (no realtime channel, matching web).
- The prefs/pins API clients are constructed in `chat-store-provider.tsx` and injected via `RealStoreDeps`, not default-constructed in `real-store.ts`: the default construction imports the token storage, which hangs under Vitest (Node) and stalled every older boot test. Behaviour on device is identical; tests inject fakes.
- "Filtered group shows 1 topics": no such string existed verbatim (`group-list-item` already singularised); centralised the rule in `topicCountLabel` with a test so it cannot regress.
- Mock `pins()` reads an in-memory cache (module-level, reset per store); mock `canPin` treats Dev-team topics as pinnable (viewer is owner in the mock detail). Mock pins key by client chat id, like the web mock.
- Security checklist: no secrets/tokens in code or logs (no logging added); no server changes so scoping/404/rate-limit/audit behaviour is untouched; `canPin` gates before any pin write client-side and the server still enforces; no new routes; no message text in errors (snapshots stay in pin rows only).
- Needs eyes (no simulator run): long-press sheets on chat/group/topic rows, mute durations + unmute, pin/archive flows, Archived entry expand/unarchive, pinned banner cycling/jump/list/unpin in mock mode, and the same against the real server once T-0113/T-0114 APIs are deployed.

### Round 5 — pre-review round 4 (two should-fix)
3. `TopicRow` showed no pin/muted icons while `ChatListItem`/`GroupListItem` do. Added the same Pin (labelled "Pinned chat") and VolumeX (labelled "Muted chat") icons after the AI badge, same sizes/colors; the muted grey unread badge was already there via `TopicUnreadBadge`. New `topic-row.test.tsx` (direct-call stub pattern): default row has neither icon, muted+pinned row has both, muted unread badge renders its count.
4. `MessageList` subscribed `state.pins(chat.id).map(...)` while the screen subscribed the same pins, re-rendering the whole list on every publish. The screen now selects `pins(chatId)` once and passes a `useMemo`'d `pinnedIds` prop down; the list no longer subscribes to pins. The store's pins publish was unified to a single revision bump (`publishPins`/`publishOptimisticPins`, replacing the double-`set`: the second no-op set is gone). New store test asserts a republish re-fires selectors with equal data. (Nits 1 and 5 from the review were already consistent with this shape — the revision counter replaces the replace-always-notify reliance, and the double-set is removed — so no extra change needed.)
- Re-ran (touched files + neighbours only): real-store prefs-pins, topic-row, topic-actions-sheet, topics-screen, chat-store (48 passed). `pnpm format:check` clean for tracked files (only untracked `PREREVIEW.md` warns), `pnpm lint` clean, `pnpm typecheck` 10/10. No full suite (lead runs it on main).

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** Approved after five rounds; the final round (TopicRow pin/muted icons, one memoized `pinnedIds` array replacing the double pins subscription, one revision bump per pins publish) read by me directly. Verified through the packets: mock pins load on open, optimistic pref writes merge into the full row set in both stores (kept fields survive), failed writes re-merge instead of restoring a stale snapshot, the pins poll stops when the chat closes, pin deny paths are tested, per-user archived topics hide behind an Archived toggle like web, mock pins prepend like the server. No secrets in the new clients (bearer only in the authorization header). Mobile only; to be run on the Android emulator after the batch merge.

### Findings
- Spec deviation noted by the worker: an extra "1 day" mute duration (harmless, additive).

### Follow-ups
- Mobile chat prefs and pins need a live look on a device/emulator (not run in a simulator by the worker).
