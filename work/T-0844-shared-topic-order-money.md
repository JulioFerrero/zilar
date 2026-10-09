---
id: T-0844
title: "One topic order and one money format in chat-core, used by web and mobile; mobile search debounce 250 ms like web"
status: todo
milestone: M5
branch: task/T-0844-shared-topic-order-money
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0844: One topic order and one money format in chat-core, used by web and mobile; mobile search debounce 250 ms like web

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Drift bugs A-F1c, A-F1d and A-F1e in `docs/audit/simplify-2026-10-09/A-web-mobile.md`.
- **Topic order:** web sorts pinned first, then General, then recency (`apps/web/src/store/store.ts:552-571`). Mobile sorts General first, then recency, and ignores pins (`apps/mobile/src/lib/topics.ts:136-147`).
- **Money:** web uses `Intl.NumberFormat` currency ("€0.02", `apps/web/src/lib/format.ts:29`). Mobile prints `${currency} ${amount.toFixed(2)}` ("EUR 0.02", `apps/mobile/src/lib/chat.ts:29`).
- **Search debounce:** web waits 250 ms (`apps/web/src/lib/useMessageSearch.ts:8`), mobile 300 ms (`apps/mobile/src/components/chat/message-search.ts:22`).

Web is the reference for all three.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Move the web topic ordering function and the web money formatter into `packages/chat-core` (new files `packages/chat-core/src/topics.ts` and `packages/chat-core/src/money.ts`), export them from `packages/chat-core/src/index.ts`, and add unit tests there. Copy the web code's behaviour exactly.
2. Make web import them (delete the web copies, keeping any web re-export that other web files import, so no import changes elsewhere).
3. Make mobile use them in place of its own versions, so mobile gets pinned-first order and "€0.02". Update the mobile tests that pinned the old mobile behaviour (allowed here, because this is the intended fix) and say which in the Report.
4. Set the mobile search debounce to 250 ms.
5. Check that Hermes supports `Intl.NumberFormat` with `style: 'currency'` (Expo SDK, Hermes has Intl). If you cannot confirm it from the repo or node_modules, keep a fallback to the old string when `Intl.NumberFormat` throws, and say so.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`packages/chat-core/src/**`, `apps/web/src/store/store.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/store/*.test.ts`, `apps/mobile/src/lib/topics.ts`, `apps/mobile/src/lib/topics.test.ts`, `apps/mobile/src/lib/chat.ts`, `apps/mobile/src/lib/chat.test.ts`, `apps/mobile/src/components/chat/message-search.ts`, `apps/mobile/src/components/chat/message-search.test.ts`, `apps/mobile/src/components/chat/use-message-search.test.ts`, `work/T-0844-shared-topic-order-money.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/lib/format src/store/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/topics src/lib/chat src/components/chat/message-search src/components/chat/use-message-search
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: On the phone, a pinned topic is listed first and AI costs show "€0.02".

---

## Report (written by the worker when done)

## Review (written by Claude)
