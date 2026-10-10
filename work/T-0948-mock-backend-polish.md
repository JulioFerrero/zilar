---
id: T-0948
title: "Mock backend polish: real-format AI JIDs (ai-<id>@zilar.test) so AI markdown renders, read markers clear unread, and no double delay on fallback routes"
status: merged
milestone: M5
branch: task/T-0948-mock-backend-polish
model: auto
effort: default
depends_on: [T-0946]
estimate: 0.5 day
---

# T-0948: Mock backend polish

## Spec (written by Claude, do not edit)

### Why
The lead checked web mock mode (`?mock=1`) in Chrome after T-0946 and found three issues.

1. **AI messages show raw markdown.** In the Dev team's General, Dev-1's "## Checkout fix ready … **PR #42**" shows its `##` and `**`.
   - Web renders markdown for a group message only when `isAiJid(message.senderId)` (`apps/web/src/components/` `shouldRenderMarkdown`, line 21).
   - `isAiJid` (`packages/protocol/src/jid.ts:35-38`) is true only when the JID's local part starts with `ai-`.
   - The mock seed uses `dev-1@ai.zilar.test`, `qa-1@ai.zilar.test` and `marketing@ai.zilar.test` (`packages/mock-backend/src/data/people.ts:26-28` and the domain seeds). That is the old web mock's id scheme, not the real one.
   - The real server's AIs look like `ai-<id>@zilar.test`: T-0940's `POST /ais` already mints `ai-ai-mock-1@zilar.test`.
2. **Unread does not clear.** A room reply that arrives while General is open leaves an unread badge on General.
   - The fake core's `markDisplayed` (`packages/mock-backend/src/xmpp/core.ts`) only emits `displayed`.
   - Find what the real store uses to clear unread, and make the fake core do the same. The candidates: the server's read marker, a `displayed` echo, or the `/chats` unread count. Read `packages/client-core/src/store/` (`reads.ts`) and the web store's read flow.
3. **Fallback routes pay the 150 ms delay twice:** `backend.http` waits before returning `undefined` (`packages/mock-backend/src/http.ts:29`), then the old `mockRequest` waits again (`apps/web/src/mock/backend.ts:45-53`). Wait only when a route matches.

### What to build
1. **AI JIDs:** every seeded AI JID becomes `ai-<name>@zilar.test`: `ai-dev-1@zilar.test`, `ai-qa-1@zilar.test`, `ai-marketing@zilar.test`. Update every file that names them: `people.ts`, the `ais`, `chats` and `messages` seeds and threads, groups, topics, audit, approvals and tools. Grep for `@ai.zilar.test` until nothing is left. Keep the AI row ids (`ai-dev-1`, …) as they are.
2. **Unread:** the fix from item 2 in Why, in `packages/mock-backend/src/xmpp/` (and the `chats` domain if the count lives there).
3. **The delay:** only for a matched route.
4. **No tests.** Prove items 1–3 in the Report:
   - grep output showing no `@ai.zilar.test` left;
   - a throwaway script showing `isAiJid` is true for a seeded Dev-1 message's sender;
   - what clears unread, and the script output that shows it;
   - timings for one served route and one unserved route.

### Read first
`AGENTS.md`, `packages/protocol/src/jid.ts`, `packages/mock-backend/src/**`, `apps/web/src/mock/backend.ts`, `packages/client-core/src/store/reads.ts`, and the web component holding `shouldRenderMarkdown` (grep for it).

### Allowed files
`packages/mock-backend/**`, `apps/web/src/mock/backend.ts`, `work/T-0948-mock-backend-polish.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm --filter @zilar/web typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the four proofs.
- The lead re-checks `?mock=1` in Chrome: Dev-1's markdown renders, and a reply in the open chat leaves no unread badge.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0948-mock-backend-polish`. Items 1 and 3 are done
and green; item 2 is dropped (see below). Only Allowed files are changed (gate
confirms).

### What I did

**Item 1 — AI JIDs (done).** Every seeded AI JID is now `ai-<id>@zilar.test`:

- `data/people.ts`: `ai-dev-1@zilar.test`, `ai-qa-1@zilar.test`, `ai-marketing@zilar.test`;
- `domains/ais/seed.ts`: the same three `jid`s;
- `domains/chats/seed.ts`: the two AI DMs (`ai-dev-1@…`, `ai-marketing@…`);
- `domains/groups/seed.ts`: the three `ai(...)` JIDs + the header comment;
- `domains/approvals/seed.ts`: `requestedBy: 'ai-dev-1@zilar.test'`;
- `domains/messages/threads/shared.ts`: `JIDS.dev1/qa1/marketing`;
- `domains/messages/threads/index.ts`: the two AI-DM thread keys;
- `domains/messages/threads/dev-ai.ts`, `marketing-ai.ts`: the header comments.

AI row ids (`ai-dev-1`, …) are unchanged. `grep -rn '@ai\.zilar\.test' packages/mock-backend/src` → no output.

**Item 3 — double delay (done).** `packages/mock-backend/src/http.ts`: the
150 ms `delay` moved from before matching to just before returning a matched
`Response`. An unserved path returns `undefined` at once, so `mockRequest`
(the web fallback) pays its own delay only once.

**Item 2 — dropped (lead's decision).** Unread is client state, so no mock
change can clear it: the store clears it in `handleMessage` only when the chat
is active and visible, and the fake core's reply already triggers that. The
badge the lead saw came from their automation tab counting as hidden (a reply
in the open, visible chat already leaves none); the refocus fix is a store task.

### Files changed

`packages/mock-backend/src/{data/people.ts, domains/ais/seed.ts,
domains/approvals/seed.ts, domains/chats/seed.ts, domains/groups/seed.ts,
domains/messages/threads/{dev-ai.ts,index.ts,marketing-ai.ts,shared.ts},
http.ts}` and `work/T-0948-mock-backend-polish.md`.

### Commands and real results

Grep (item 1): `grep -rn '@ai\.zilar\.test' packages/mock-backend/src` → no output.

Throwaway probe `packages/mock-backend/src/probe.test.ts` (deleted before the
gate), run with `pnpm --filter @zilar/mock-backend test --maxWorkers=2
--reporter=dot src/probe.test.ts` (`Test Files 1 passed`), stdout:

```text
1. seeded Dev-1 sender: ai-dev-1@zilar.test -> isAiJid: true
3. served /api/chats ~ 152.9 ms; unserved /api/sticker-packs ~ 1.1 ms
```

`pnpm gate` (repo root):

```text
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (0.6s)
PASS  effect  (0.5s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```


## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit and 2 follow-ups.**
- **Item 1:** every seeded AI JID is `ai-<name>@zilar.test`, so `isAiJid` is true and AI markdown renders. No `@ai.zilar.test` is left in `packages/mock-backend`; the old ids remain in `apps/web/src/mock/ids.ts`, which the deletion sweep removes.
- **Item 3:** only a matched route waits, so a fallback route pays one delay.
- **Item 2 was dropped,** as agreed: unread is client state, and the visible-open case already clears it. The refocus case is T-0950, a store task.
- **Check:** the gate passed.
