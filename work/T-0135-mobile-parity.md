---
id: T-0135
title: Mobile: chat preferences and pinned messages
status: planned
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
3. Mock mode: mobile has a mock (`EXPO_PUBLIC_GALENA_MOCK`); extend it so both features work without a server.
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
pnpm --filter @galena/mobile test --maxWorkers=2
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
