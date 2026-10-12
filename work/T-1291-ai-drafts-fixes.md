---
id: T-1291
title: "AI live drafts: a (re)connecting client gets the current draft at once (AI-11); a late draft frame matching the final message is dropped, not shown as a duplicate (AI-13); the drafts stream ends after 10 min so a revoked session stops receiving (AI-19); tested"
status: todo
milestone: M5
branch: task/T-1291-ai-drafts-fixes
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1291: AI live-draft fixes

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-11** (P2, `:223`): the drafts hub sends only live events (`apps/server/src/drafts/hub.ts`, 156 lines), and a new subscriber gets nothing until the next frame (`apps/server/src/drafts/api.ts`, 130 lines). A phone back from the background mid-turn shows the old text.
- **AI-13** (P2, `:240`, suspected): if the final XMPP message arrives before the first SSE frame, that frame renders below the final message until `DRAFT_END_FALLBACK_MS` (5 s) in `packages/client-core/src/store/polling.ts` (233 lines).
- **AI-19** (P2, `:247`): the session is checked only when the stream opens, and the stream never ends on its own, so a revoked session keeps getting the owner's drafts.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-11:** the hub keeps the latest frame per (owner, chat) while a turn is open, and clears it on end. A new subscriber is sent those frames at once on connect.
2. **AI-13:** in `polling.ts`, `handleDraftEvent` drops a draft frame whose text equals the chat's newest AI message body, or whose turn already finished (cite how a finished turn is known).
3. **AI-19:** the SSE response ends after 10 minutes; both clients already reconnect (cite where), and the reconnect re-runs the session check.
3b. **PERF-9** (`docs/audit/performance-audit.md:201`): both clients open the drafts stream unconditionally (`packages/client-core/src/store/polling.ts`), one long-lived stream per tab or phone even with no AI. Open it only when the user has at least one AI chat (an AI-kind chat in `state.chats`; cite the field), and open it when the first one appears.
4. **Tests** (auth and the message pipeline), up to 3:
   - a late subscriber gets the latest frame (in a new `apps/server/src/drafts/hub.test.ts`, or the nearest existing test);
   - a duplicate late frame is dropped (`packages/client-core/src/store/*.test.ts`, nearest);
   - the stream closes after the cap (a fake clock), only if simple.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:223-260`), `apps/server/src/drafts/hub.ts`, `apps/server/src/drafts/api.ts` and `packages/client-core/src/store/polling.ts`.

### Allowed files
`apps/server/src/drafts/*.ts`, `packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/*.test.ts`, `work/T-1291-ai-drafts-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/drafts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
