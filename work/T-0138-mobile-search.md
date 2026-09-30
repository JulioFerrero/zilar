---
id: T-0138
title: Mobile: message search
status: planned
milestone: M5
branch: task/T-0138-mobile-search
model: meta/muse-spark-1.3-contributor
depends_on: [T-0112]
estimate: 1 day
---

# T-0138: Mobile: message search

## Spec (written by Claude, do not edit)

### Why
Web can search messages across everything the user may see (T-0117). Mobile has no search. Mobile is the smaller share of the work (about 20%), so keep it small and match how the mobile app already does lists, sheets, stores and its mock (`EXPO_PUBLIC_GALENA_MOCK`). Read `AGENTS.md` first, including the security checklist. Nothing here can be run in a simulator by the worker, so tests and typecheck carry the proof; say in the Report what still needs a human look.

### What to build
1. A search entry at the top of the chat list (search field that opens a full-screen search). Debounce input (about 300 ms), minimum query length as the server requires, cancel the in-flight request when the query changes.
2. Results (`GET /api/search`, see the server route and web `searchMessages` for the wire contract): sender, chat/topic name, date, snippet with the matched ranges highlighted (`marks` are offsets; guard against out-of-range offsets), infinite scroll with the returned cursor. Empty, loading, error and rate-limited states.
3. Tapping a result opens that chat or topic and scrolls to the message when it is loaded; if it is older than what is loaded, load history until found or give up after a small cap and open at the bottom. Filters: a chat scope chip when opened from inside a chat (search this chat only), same as web.
4. Snippets are text, never rendered as markdown or links. Do not log queries.
5. Mock mode returns believable results.

### Read first
`AGENTS.md`, `work/T-0117-message-search.md` (Spec, Report, Review), `apps/server/src/search/routes.ts`, the web `searchMessages` in `apps/web/src/lib/api.ts` and its search UI for behaviour, `apps/mobile/src/components/chat/message-list.tsx`.

### Allowed files
`apps/mobile/**`, `packages/chat-core/src/**` only if a shared type must change (say so in the Report), `work/T-0138-mobile-search.md`. Not allowed: server, web, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2
```
(Affected tests while working; the full mobile suite once at the end. Do NOT start simulators, Metro, or `expo run`; Julio's simulators are off limits.)

### Acceptance criteria
- [ ] Search client validates the response with zod and handles cursor paging, cancel and rate-limit answers (tests).
- [ ] Mark highlighting is safe for bad offsets and multi-byte text (tests).
- [ ] Result tap navigation and jump-to-message have tests, including the give-up cap.
- [ ] Queries are not logged; snippets render as plain text (test).
- [ ] Mock mode covers it.

### Out of scope
Web changes, server changes, search filters beyond chat scope, semantic search.

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
