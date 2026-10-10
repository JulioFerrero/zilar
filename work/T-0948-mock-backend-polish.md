---
id: T-0948
title: "Mock backend polish: real-format AI JIDs (ai-<id>@zilar.test) so AI markdown renders, read markers clear unread, and no double delay on fallback routes"
status: todo
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

## Review (written by Claude)
