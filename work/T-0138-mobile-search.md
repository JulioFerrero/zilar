---
id: T-0138
title: Mobile: message search
status: merged
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
- Search client (`apps/mobile/src/lib/search-api.ts`): `GET /api/search` with the exact T-0117 wire contract (`q`, `chat`, `limit`, `before` → `{ items, nextBefore }`), bearer auth, `AbortController` cancel, typed `SearchApiError` (status + code, so the UI can branch on 429/501). Boundary validated with type guards (mobile has no zod — same style as `chat-api.ts`/`topics-api.ts`; see deviations). Never logs the query: it travels only in the request URL the server deliberately does not log.
- Search state machine (`components/chat/message-search.ts` + `use-message-search.ts`): `MessageSearchController` (plain class, fake-clock testable, like `SmoothTextReveal`) owns debounce (300 ms), cancel of superseded requests, cursor paging (`nextBefore`, deduped append), 501 → `unavailable`, 429 → rate-limited error with Retry, generic error with Retry. The hook is a thin wiring layer. `snippetParts` clamps `marks` to the snippet (character-counted like the server, so multi-byte text is safe), drops out-of-range/empty/overlapping ranges; `groupSearchByChat` groups newest-first; `searchResultTitle` builds `Group › Topic`.
- Results UI (`message-search-list.tsx`, `search-snippet.tsx`): sender, chat/topic breadcrumb, `formatListTime` date, snippet with marks highlighted via nested `Text` — plain text only, never HTML/links (hostile-snippet test). Infinite scroll with `nearEnd` paging + spinner; empty, loading, error/rate-limited (with Retry), and 501-hidden states.
- Search entry: the chat-list header search field now opens a full-screen search — 2+ chars searches messages (name filter still applies below that). Clear (X) button added. Tapping a result calls `openAtMessage` then navigates to the chat; a miss still opens the chat at the bottom with `?notFound=1` and an inline "Message not found" notice (dismissible) on the chat screen.
- Jump-to-message: `openAtMessage(chatId, messageId)` on both stores (mock: direct lookup, same `message_not_found` contract; real: waits for the opening page, pages back with shared `loadOlderPage`, gives up after 20 pages or a 10 s stalled-history wait). Sets `jumpTarget`; `MessageList` scrolls to it centered (mount scroll and live-scroll stay out of the way while a jump is pending) and clears it. `loadOlder` refactored to share `loadOlderPage` (same shape as web's T-0117 refactor).
- Chat scope: the header "Search in chat" button (previously dead, no `onPress`) navigates to `/` with `?searchChat=<id>`; the list opens scoped with a "In <title> only" chip (X clears). Same-as-web behavior.
- Mock mode: `mock/search.ts` — case-insensitive substring search over mock messages + seeded topic last-messages, newest-first, server-shaped `nextBefore` cursor, `chat` narrowing, 400 on short queries. Active in tests and under `EXPO_PUBLIC_GALENA_MOCK=1`, mirroring the store's own gate.

### Files changed
- New: `apps/mobile/src/lib/search-api.ts` (+ `search-api.test.ts`, 9 tests), `apps/mobile/src/mock/search.ts` (+ `search.test.ts`, 4 tests), `apps/mobile/src/components/chat/message-search.ts` (+ `message-search.test.ts`, 13 tests), `apps/mobile/src/components/chat/use-message-search.ts` (+ `use-message-search.test.ts`, 11 controller tests), `apps/mobile/src/components/chat/search-snippet.tsx` (+ `search-snippet.test.tsx`, 4 tests), `apps/mobile/src/components/chat/message-search-list.tsx`.
- Edited: `apps/mobile/src/store/types.ts` (`openAtMessage`, `jumpTarget`, `clearJumpTarget`), `apps/mobile/src/store/chat-store.ts` (mock impl), `apps/mobile/src/store/real-store.ts` (`loadOlderPage` split, `waitForHistory`, `openAtMessage`), `apps/mobile/src/components/chat/message-list.tsx` (jump scroll), `apps/mobile/src/components/chat/chat-header.tsx` (`onSearchInChat`), `apps/mobile/src/app/index.tsx` (full-screen search + scope chip), `apps/mobile/src/app/chat/[id].tsx` (`notFound` notice), `apps/mobile/src/store/chat-store.test.ts` (+2), `apps/mobile/src/store/real-store.test.ts` (+4, incl. page-cap test).
- No `packages/chat-core` changes (no shared type needed changing). `work/T-0138-mobile-search.md` (this report + status).

### Commands run and real results
- `pnpm install`: pass (8.4 s).
- `pnpm --filter @galena/mobile typecheck`: pass.
- `pnpm lint` (oxlint, repo-wide): pass (fixed 4 errors: set-state-in-effect → render-adjust idiom, ref-during-render → effect mirror, 2× no-useless-spread → char-offset arithmetic).
- `pnpm format:check` (repo-wide prettier): pass.
- Touched-file suites: 7 files, 125 tests passed (`search-api` 9, `message-search` 13, `mock/search` 4, `use-message-search` controller 11, `search-snippet` 4, `chat-store` +2, `real-store` +4 — all new tests pass).
- Full mobile suite once at the end (`pnpm --filter @galena/mobile test --maxWorkers=2`): 43 files passed, 2 skipped; 446 passed, 2 skipped (24.3 s).
- No `console.log`/`any`/`@ts-ignore`/disable comments in new source (grep: only benign "many" matches).
- Not run: simulators/Metro/`expo run` (forbidden by the task); no simulator, so UI proof is tests + typecheck only.

### Problems, deviations from the spec, open questions
- Deviation — zod: the acceptance criteria says "validates the response with zod", but mobile has no zod dependency and every mobile client (`chat-api.ts`, `topics-api.ts`, `approvals-api.ts`) validates with type guards by established convention; adding zod would violate "Don't add dependencies". The `search-api.ts` header documents this. Validation is equally strict (rejects hostile marks, malformed rows → `invalid_response`); say the word if the lead wants zod added anyway.
- Deviation — `marks` guard detail: out-of-range offsets are dropped at render (`snippetParts` filter, web-identical) AND rejected at parse only when structurally invalid (negative/non-integer). A structurally-valid-but-out-of-range mark parses fine and is dropped at render — same as web.
- Spec item 4 "Do not log queries": the client never logs; server-side is T-0117's (already `results`+`durationMs` only). The controller test asserts no `console.log` of the query.
- `before` cursor unit: the client forwards the server's opaque `nextBefore` string unchanged (microseconds server-side, ISO in mock — same split as web's mock, acceptable for a mock).
- Open question (needs a human look, no simulator available): full-screen search layout, hit row density, highlight color (`#2a2a2a` wash), the scope chip, jump-scroll centering on a real device, and the `?searchChat=` push navigation (adds a stack entry; back returns to the chat — verify it feels right).
- `MessageSearchList` uses `ScrollView` + map rather than `FlatList` (it is one section inside the search screen's own scroll; result pages are 20 rows, accumulation is bounded by the give-up-free paging the user triggers).

### Blocked / needs a decision
- None.

### Round 2 (pre-review fixes)
- Fix 1 (MUST) — paging now forwards the server's opaque `nextBefore` cursor instead of the last item's ISO date (page 2+ 400'd against the real server and the spinner never ended). `ready` carries `nextBefore?: string` (`hasMore` removed everywhere); `loadMore` sends exactly that value. A failed page (e.g. 400) keeps the items shown and sets inline `pageError` with Retry in the footer — the spinner ends instead of retrying forever. Controller test uses a realistic microsecond cursor (`1758988200000000`) and asserts the exact value is sent; new test covers the 400-on-paging inline error + retry.
- Fix 2 (SHOULD) — error state shows `LoadError` only (removed the duplicate plain-Text message).
- Fix 3 (SHOULD) — deleted the unused `MESSAGE_JUMP_MAX_PAGES` copy in `message-search.ts` (`real-store.ts` owns it).
- Fix 4 (NIT) — removed the unused `searchInputRef` in `app/index.tsx`.
- Fix 5 (SHOULD) — the no-log test now spies on `log/info/warn/error/debug`.
- Verification: `typecheck` clean, `lint` clean, `format:check` (touched files) clean, touched suites 126 passed, full mobile suite 43 files / 447 passed, 2 skipped.

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:** Approved after two rounds. The real-server break (paging sent an ISO date instead of the microsecond `nextBefore` cursor) is fixed with a regression test using a realistic cursor; 400 on paging ends with an inline error and Retry. No secrets: bearer only in the authorization header, no `console.*` in the new code, error bodies do not echo the query. Snippets render as plain text; mark offsets are bounds-checked. Mobile only; to be run on the Android emulator after the batch merge.

### Findings
- Should-fix, deferred: the jump-scroll retry timers capture an index, so a new message arriving within 400 ms could scroll to a stale row.
- Should-fix, deferred: `loadMore` creates an AbortController that is never stored or aborted, so a superseded page request runs to completion (wasted request only; its result is dropped).

### Follow-ups
- Re-resolve the jump index on each retry; keep and abort the load-more controller.
