---
id: T-1901
title: "Plan (docs only): a smoother app — why opening a chat waits ~1.3 s on a cold web load and what the phone waits on, which local caches exist and their gaps (web has no message cache; does the phone cache cover topics and cards?), and a sweep of every place on web and phone where content pops in or a banner/spinner pushes content; ordered fix tasks; write docs/plan/smooth-app.md"
status: merged
milestone: M5
branch: task/T-1901-smooth-app-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1901: Plan a smoother app (docs only)

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:** "i will love also the connection with the app to be smoother, like, not only ui… there is a lot of this things, also now cards test is slow to load in like 500ms or higher". Two of his examples are already being fixed: the connection line (T-1898) and the Settings profile spinner (T-1899). This task finds **the rest** and plans fast opens. Docs only, no code.

### Facts (read or measured by the lead on 2026-10-17)
- **Web, cold load** of the "cards test" topic on chat.zilar.app (Chrome, paint and resource timings):
  - first contentful paint at 0.21 s (the chat list from cache);
  - `/api/xmpp/token` starts at 0.33 s and ends at 0.41 s;
  - the topic's messages and card photos appear at about 1.3 s (`card-media` requests at 1.31 s, the image painted at 1.36 s).

  A warm switch between chats takes 72 ms with no long tasks. So the wait is connect + history, not rendering.
- **Web caches:** only the chat list (`apps/web/src/store/chatListCache.ts`, localStorage, 200 chats). No message cache.
- **Phone caches:**
  - `apps/mobile/src/store/offline-cache.ts` (T-1313) keeps the newest 50 messages of the 30 most recent chats in one JSON file, so a cold start opens a chat at once;
  - the chat list cache is `apps/mobile/src/lib/chat-list-cache.ts` (PERF-12).
- **The shared client store** is `packages/client-core/src/store/` (`connect.ts`, `lifecycle.ts`, `history.ts`, `online.ts`, `pins.ts`, …).

### What to answer (cite `file:line`)
1. **Cold-open timeline, web and phone:** what runs in order from launch to "messages of the open chat painted"? Cover:
   - session/me;
   - the XMPP token;
   - WebSocket connect, SASL, bind, roster;
   - MUC joins (all rooms, or only the open one?);
   - the MAM page for the open chat.

   What waits on what that doesn't need to? For example: is the open chat's history requested before all room joins finish, and could the token fetch start in parallel with the session?
2. **The resume timeline (phone):** what happens when the app comes back from the background? Is the status set to `connecting` even when the stream resumes quickly? Which screens re-fetch on every focus (the `useFocusEffect` loaders)?
3. **Cache gaps:**
   - **web:** propose a message cache like the phone's (the storage, its size, what is never stored: no tokens, no media bytes; sign-out clears it);
   - **phone:** check whether `offline-cache.ts` covers topic rooms and messages with card blocks (`payload` blocks), and whether it is actually read on a cold open of a topic.
4. **The jump sweep, both apps:** list every place where content pops in and moves other content, each with `file:line`, what moves, and a fix. Look for:
   - a spinner or `null` replaced by taller content;
   - a banner inserted above a list;
   - images without a reserved size;
   - lists that re-sort after load;
   - counts or badges that appear late.

   Search `ActivityIndicator`, `Spinner`, `loading ?`, `return null`, and conditional rows at the top of lists. Skip T-1898 and T-1899.
5. **An ordered task list,** each ≤ 45 worker minutes, with its files, web and phone twins together. Mark any new dependency "needs Julio". Put the biggest felt wins first: instant chat open from cache, then the jumps.

### Steps
1. Write `docs/plan/smooth-app.md`, under 240 lines.
2. Don't change any code.

### Allowed files
- `docs/plan/smooth-app.md`
- `work/T-1901-smooth-app-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan answers 1–5** with citations.
- **The jump list** names every case found, with a fix.
- **The task list** is ordered by how much it improves what people feel.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
Wrote `docs/plan/smooth-app.md` (237 lines, docs only, no code changed) answering the five
questions with `file:line` citations:

1. **Cold-open timeline, web and phone.** Session gate → cached chat list (FCP) → boot's four
   parallel fetches → token → XMPP connect (SASL/bind inside `@xmpp/client`) → `online` →
   `joinGroups` → `groupsJoined` → MAM page → previews. The two blocking findings: the XMPP
   token is requested only after `getMe`/`getChats`/`getContacts`/prefs settle
   (`packages/client-core/src/store/lifecycle.ts:199-208` → `connect.ts:116`), and the open
   topic's MAM can only start after **every** room join finishes, one round trip per group
   **and per topic** (`connect.ts:171-173`, `history-core.ts:99-102`,
   `apps/web/src/store/effects/groupMembers.ts:139-153`,
   `apps/mobile/src/store/effects/groups.ts:202-221`). Previews (4-way MAM) then start right
   behind the open page (`connect.ts:174`, `previews.ts:17-28`).
2. **Resume (phone).** The store never sets `connecting`; `suspend()` leaves `offline` and the
   library reports `reconnecting` during the wake, and an away shorter than the 10 s grace is
   trusted as `online` (`packages/client-core/src/store/lifecycle.ts:142-186`,
   `packages/xmpp-core/src/core-effect/suspend.ts:82,91-107`). Every room is rejoined on
   resume (`lifecycle.ts:177`). Listed all 12 `useFocusEffect` loaders that flip to a loading
   state, plus the chat screen refetching the open chat's first page on every focus
   (`use-chat-screen.ts:98-110` → `effects/history.ts:283-312`).
3. **Cache gaps.** Web: a concrete message-cache proposal (new `messageCache.ts`,
   localStorage `zilar:messages`, versioned, 50 messages × 30 chats + ~1.5 MB byte cap, never
   tokens/media bytes/`sending`/`failed`/`local-*`/`blob:` urls, cleared in `resetUserState`).
   Phone: the offline cache **does** cover topics (topic rows are ordinary chat rows) and card
   blocks (`StructWithRest` keeps `payload`/`card`), and it **is** read on a cold topic open;
   the gaps are the 30-row window taken in display order and the async hydrate racing a
   notification deep link.
4. **Jump sweep.** 13 cases with citations and a fix each (web: pin banner, contact-request
   rows, chat-list retry row, message skeleton, topic people avatars, AI status line; phone:
   pin banner, request header, archived bar, message skeleton, cold chat-screen swap, AI
   status line, focus loaders). Also lists what I checked and found fine (image heights, unread
   divider anchor, fixed version banner, folder tabs, recency re-sorting).
5. **Ordered tasks.** 10 tasks, each ≤ 45 worker minutes, with both apps' files and the tests
   to run, largest felt win first (web message cache → per-room history gate → token prefetch →
   previews → phone cache coverage → then the jumps). No task needs a new dependency.

### Files changed
- `docs/plan/smooth-app.md` (new)
- `work/T-1901-smooth-app-plan.md` (status + this Report)

### Checks run
`pnpm gate` from the repo root (real output):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (3.0s)
PASS  format  (2.1s)
PASS  lint  (1.8s)
PASS  typecheck  (2.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test file was run: the change is documentation only and the gate reported no source
files changed, so it skipped the test step by design.

### Notes for the lead
- The web timings quoted are the ones in the Spec (yours, 2026-10-17); I ran no timings. No
  phone timing was measured, so the phone sections describe ordering/blocking, not
  milliseconds.
- Everything else is code reading on this branch; line numbers match the branch at `ca05d6375`.
- The biggest single win is #2 in the task list (per-room history gate): it is a shared-code
  change touching both apps and their bindings of `groupsJoined`, so it may deserve a slightly
  larger estimate than 45 min if the reviewer prefers one task per app.
- Task #9 deliberately excludes the two screens T-1899 is already fixing (`me.tsx`,
  `(tabs)/settings.tsx`).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `0cc2c0220`.
- **The key finding:** a group or topic page waits for every room join, which run one after another (`connect.ts:171-173`, `history-core.ts:99-102`). So opening any topic gets slower the more topics a person has. The web has no message cache. The token waits behind the boot fetches.
- **The plan:** the jump sweep lists W1–W6 and P1–P7 with fixes, and the 10 ordered tasks have files.
- **The three nits** are doc wording. The lead takes the double `getMe` into task 3.
- **First wave:** tasks 1, 2, 5 and 8 in parallel. Tasks 3+4 follow task 2 (all touch `connect.ts`). Tasks 6–7 follow task 1 (`chatListCache`).

