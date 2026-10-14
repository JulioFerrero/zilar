---
id: T-1406
title: "AI status line: the AI's chat state carries a short fixed status text ('Searching the web', 'Running a command'), shown next to the typing dots in the chat header on web and mobile; never stored, never notifies; the dead aiStatus field is wired to it"
status: merged
milestone: M5
branch: task/T-1406-ai-status-line
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1406: AI status line

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AI work happens in the background and "dont spam in the chat". The design's first piece is a **status line under the AI's name**, like typing, with a short text, and no trace in history (`docs/design/agent-system.md` §4.1).

**The plan is `docs/audit/agent-ux-plan.md`** (merged): read §1.3, §2.1 and §3 "Task B". The lead's answers to its open questions are in `work/T-1398-agent-ux-plan-audit.md` (Review).

### Facts (the lead checked them on main, 2026-10-14)
- **`buildTyping`** (`packages/xmpp-core/src/stanza/build-outgoing.ts:214-224`) sends a body-less chat-state message with no store hint. MAM never archives it, and push never sees it.
- **`TypingEvent`** is at `packages/xmpp-core/src/types.ts:148-154`; the decode is in `packages/xmpp-core/src/stanza/decode.ts` (around `:139-140` and `:179`).
- **The server sends** `composing` before a turn and `paused` after: `apps/server/src/agents/dm-turn.ts:124,144` and `apps/server/src/agents/group-turn.ts:195,243`. It goes through `liveSendTyping` (`apps/server/src/agents/gateway/live.ts:143-153`).
- **The fixed stage texts** are `TOOL_STAGE_BY_TOOL`, `TOOL_STAGE_BY_ACTION` and `TOOL_STAGE_FALLBACK` (`apps/server/src/agents/tool-guide.ts:27-57`). Tool stages are reported through `reportProgress` (`apps/server/src/agents/tool-exec.ts:240`).
- **The client store** handles typing in `handleTyping` (`packages/client-core/src/store/lifecycle.ts:315`). The headers show the dots: web `apps/web/src/components/ChatHeader.tsx:137` with `TypingDots.tsx`; mobile `apps/mobile/src/components/chat/chat-header.tsx:84-90` with `typing-dots.tsx`.
- **`aiStatus` is dead:** `packages/chat-core/src/types.ts:212` (type `AiStatus` at `:23`) is read by `chat-labels.ts:27`, `ChatHeader.tsx:50` and `chat-header.tsx:84`, but nothing writes it.

### What to build
1. **Protocol** (backward compatible):
   - `buildTyping` takes an optional `status` (at most 80 chars) and adds `<stage xmlns="urn:zilar:agent:0">…</stage>` next to the chat-state element;
   - `TypingEvent` gains an optional `status`, which the decoder reads;
   - an old stanza without it still parses;
   - `XmppCore.sendTyping` (and its fake in `packages/xmpp-core/src/testing.ts`) accepts the optional status.
2. **Server:**
   - add `liveSendStatus(session, to, kind, status)` in `gateway/live.ts`, which sends `composing` with the status;
   - the turn starts with the status "Thinking";
   - each tool stage (where `reportProgress` is called today) also sends the status with the same fixed stage text;
   - `paused` at the end clears it;
   - **only fixed `TOOL_STAGE_*` texts or "Thinking", never model or tool text.**
   - Keep the progress card as it is; a later task replaces it.
3. **Clients** (web and mobile in this task, parity):
   - the store keeps the latest status per chat and AI from typing events (cleared on `paused`/`active` or after 60 s with no update);
   - the header's typing line shows "<status>…" next to the dots, for example "Searching the web…", and plain dots when there's no status;
   - **wire `aiStatus`** to it (`working` while a status or `composing` is live, else `idle`), so `chat-labels.ts` and both headers read real data;
   - **the chat-list preview line never changes** from a status.
4. **Mock mode:** the mock AI thread (`packages/mock-backend/src/domains/messages/threads/dev-team.ts` or the nearest place the fake XMPP emits typing) emits two statuses then a reply, so the lead can see it at web `?mock=1` and on the emulator.
5. **Out of scope:** the progress card and its edits, Stop, View steps, and approvals.

### Tests (message pipeline only)
- `packages/xmpp-core/src/stanza.test.ts` (or the nearest stanza test): build and parse with a status; an old stanza without one; a status over 80 chars is cut. **No UI tests.**

### Read first
`AGENTS.md`, `docs/audit/agent-ux-plan.md` §1.3, §2.1 and Task B, and the files above.

### Allowed files
`packages/xmpp-core/src/**`, `packages/client-core/src/store/*.ts`, `packages/chat-core/src/*.ts`, `apps/server/src/agents/*.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/group-turn-body.ts`, `apps/server/src/agents/gateway/contracts.ts`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/TypingDots.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/typing-dots.tsx`, `apps/web/src/store/chatListCache.ts`, `apps/mobile/src/lib/chat-list-cache.ts`, `packages/mock-backend/src/**`, `work/T-1406-ai-status-line.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; files stay at most 400 lines.
- The lead sees the status text next to the dots at web `?mock=1` and on the emulator's mock build, and the chat-list line doesn't change.
- **Live:** an AI DM turn shows "Thinking…" and then the stage texts, which vanish with the answer; reloading the chat shows nothing in history.

---

## Report (written by the worker when done)

### What I did

**Protocol (backward compatible).**
- `buildTyping` (`packages/xmpp-core/src/stanza/build-outgoing.ts`) takes an optional `status`, caps it at `MAX_STATUS_CHARS = 80` code points (empty = no element) and adds `<stage xmlns="urn:zilar:agent:0">…</stage>` next to the chat-state child. `MAX_STATUS_CHARS` is exported from the stanza barrel.
- `TypingEvent` gained optional `status` (`packages/xmpp-core/src/types.ts`) and `parseTyping` (`packages/xmpp-core/src/stanza/decode.ts`) reads the `<stage/>`, capped the same way; an old stanza without it parses exactly as before.
- `sendTyping` accepts the optional status on `XmppCore`, the Effect ops API, the Promise facade (`client.ts`) and `sendTypingEffect`. The fake in `testing.ts` needs no signature change: it is typed through `XmppCore`, so it already accepts the status and records it in `calls`.

**Server.**
- `gateway/live.ts`: `liveSendTyping` takes an optional status; new `liveSendStatus(session, to, kind, status)` sends `composing` with the status (kept in the returned session object). `liveProgressReporter.reportProgress` calls `liveSendStatus` with the same fixed stage text it puts on the card, so the card and the status stay in one place.
- "Thinking" starts the turn: the `sendTyping` bridges in `gateway/dm-turn.ts` and `gateway/group-turn-body.ts` attach `TOOL_STAGE_THINKING` (new constant in `agents/tool-guide.ts`) to the opening `composing`; `paused` carries no status, so the client clears it.
- Only fixed texts leave the server: `TOOL_STAGE_*` from `tool-guide.ts` and "Thinking". The progress card is untouched.

**Clients (web + mobile, parity).**
- `packages/client-core/src/store/typing.ts` keeps a status slot per (chat, sender) with its own 60 s clearing fiber (`STATUS_CLEAR_MS`), writes `typing[chatId] = { names, status? }` and, in the same patch, sets `ChatSummary.aiStatus` to `working` while a status or a composing state is live and `idle` otherwise. `paused`/`active` and an incoming message clear it (`removeTyper`/`clearChatTyping`). `handleTyping` passes the event's status to `setStatus`.
- Web `ChatHeader.tsx` and mobile `chat-header.tsx`: the typing line shows `<status>…` next to the dots, plain dots when there is no status. `chat-labels.ts` needs no change: it already reads the now-live `aiStatus`. The chat-list preview is never touched by a status.

**Mock.** `packages/mock-backend/src/xmpp/core.ts`: the fake room reply now emits two fixed statuses ("Searching the web", "Running a command") from the AI member before its reply (only when the replier is an AI; a human replier stays plain). The old single reply timer was factored into one tracked `emitLater` helper.

### Files changed
- `packages/xmpp-core/src/stanza/build-outgoing.ts`, `src/stanza/decode.ts`, `src/stanza.ts`, `src/types.ts`, `src/client.ts`, `src/core-effect/operations.ts`, `src/stanza.test.ts`
- `apps/server/src/agents/tool-guide.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/group-turn-body.ts`
- `packages/client-core/src/store/typing.ts`, `ctx.ts`, `incoming.ts`
- `apps/web/src/components/ChatHeader.tsx`, `apps/mobile/src/components/chat/chat-header.tsx`
- `packages/mock-backend/src/xmpp/core.ts`
- `work/T-1406-ai-status-line.md`

### Commands run (real results)
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts` -> 88 passed (1 file).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` -> 24 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` -> 13 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.incoming.test.tsx` -> 10 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.incoming.test.ts` -> 8 passed.
- `pnpm exec prettier --write` on the changed source files (format only).
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.3s)
  PASS  lint  (0.6s)
  PASS  typecheck  (4.5s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/client-core  (4.4s)
  PASS  tests @zilar/mobile  (0.9s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (5.6s)
  SKIP tests @zilar/web (no nearby test files)
  PASS  tests @zilar/xmpp-core  (0.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Problems / deviations
- **Where "Thinking" is attached.** The task facts point at `agents/dm-turn.ts`/`agents/group-turn.ts`, but `apps/server/src/agents/group-turn.ts` sits exactly at the 400-line cap and both turns call a `sendTyping` bridge that is already the wiring point. So the opening status is added at those bridges (`gateway/dm-turn.ts`, `gateway/group-turn-body.ts`) instead; the turn files are unchanged. The turn still starts with "Thinking".
- **`aiStatus` wired, not deleted.** The task allowed either. I wired it from the store, so `chat-labels.ts` and both headers read real data.
- **Two small casts.** Web and mobile each define their own `TypingState` (`{ names }`) in `apps/web/src/store/storeOptions.ts` and `apps/mobile/src/store/types.ts`, both outside the Allowed files, so `state.typing[chatId]?.status` did not typecheck. Each header reads the status through a local `TypingStatus = { status?: string }` widening. With the store types in scope this cast could be dropped; I left it because those files are not mine to edit. `gate`'s typecheck is green.
- **Mock location.** The mock has no DM auto-reply, so the statuses ride the room reply path (`scheduleReply`). To see them: open the **Dev team** room at web `?mock=1` (or the emulator's mock build) and send a message; the AI ("Dev-1") emits "Searching the web" then "Running a command", then its reply. Frequent sends cycle the replier; a human replier carries no status.
- No UI tests were added (per the spec); only the stanza pipeline tests.

### Notes for the lead
- Live check: an AI DM turn shows "Thinking…", then the fixed stage texts, and they vanish with the answer; reloading the chat shows nothing in history (the stanza is body-less with no store hint, as before).
- `agents/dm-tool-turn.ts` needed no change: every tool stage already funnels through `reportProgress`, which now also sends the status.

### Round 2 (fix round)

**Findings fixed**
- **#1 (should-fix) — any sender's `<stage/>` shown as the AI status.** `handleTyping` (`packages/client-core/src/store/incoming.ts`) now stores a status only when the sender is an AI JID (`isAiJid(event.fromJid)`, the `ai-<id>@…` convention the server already uses in `isAiSender`). A human client that sends `composing` plus arbitrary stage text is ignored on the receive path, in a DM and in a group, so the header's line cannot be spoofed. The human send path already sends no status (`actions.ts` calls `sendTyping` without one); the only change was the gate. Headers needed no change because a status now only ever comes from an AI sender.

**Nits / follow-up**
- Findings #2 (plain `composing` leaves a stale status), #3 (web/mobile dots parity) and #4 (mock `sendTyping` drops the parameter) are nits, so they were left as they are; F1 stays a follow-up.

**Tests added**
- `packages/client-core/src/store/incoming.test.ts`: "keeps an AI sender's status text" (an `ai-` sender's status is stored) and "ignores a status text from a sender that is not an AI" (a non-AI sender's status is dropped, the sender still types, and no status fiber is armed).
- Single test: `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` -> 26 passed (1 file).
- `pnpm --filter @zilar/xmpp-core exec vitest run --maxWorkers=2 --reporter=dot` (the task's Checks) -> 148 passed (4 files).

**Gate (from the repo root)**
```
gate: 19 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.7s)
PASS  lint  (0.7s)
PASS  typecheck  (2.3s)
PASS  effect  (0.7s)
PASS  tests @zilar/client-core  (4.8s)
PASS  tests @zilar/mobile  (0.9s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/server  (5.3s)
SKIP tests @zilar/web (no nearby test files)
PASS  tests @zilar/xmpp-core  (0.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round 3 (lead fix)
- **Cached `aiStatus`.** `writeChatListCache` stripped live presence (`online`, `onlineCount`, `lastSeenAt`) but kept `aiStatus`, so a reload mid-turn painted "AI · working" until the next event; both caches (web `apps/web/src/store/chatListCache.ts` and mobile's twin `apps/mobile/src/lib/chat-list-cache.ts`) now strip `aiStatus` on write too. Gate: GATE PASS.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 1 auto round plus a lead fix (aiStatus stripped from the web chat-list cache). Checked: web ?mock=1 (headless) shows 'Searching the web…' then 'Running a command…' next to the dots in Dev team › General, no page errors; phone smoke PASS (mock build); on the emulator, General shows 'Running a command…' and then back to '5 members, 5 online'; an AI DM header reads 'AI · idle'. Note: the mock replies only in groups. Live: an AI DM turn shows Thinking… and the stages.
