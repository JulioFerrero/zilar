---
id: T-0142
title: Smarter message search: prefixes and typo tolerance
status: todo
milestone: M5
branch: task/T-0142-smarter-search
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0117]
estimate: 1.5 days
---

# T-0142: Smarter message search: prefixes and typo tolerance

## Spec (written by Claude, do not edit)

### Why
Julio tried the Android search: a message that says "heello" is not found by "hello". Search today (T-0117) is exact whole-word full text (`to_tsvector('simple')` with `websearch_to_tsquery`): no prefixes ("hel" does not find "hello"), no typo tolerance, no accent folding. A Telegram-like chat needs search that forgives. Read `AGENTS.md` first, including the security checklist, and `work/T-0117-message-search.md` (Spec, Report, Review).

### Design (decided by the lead: no database extension)
No `pg_trgm`, no new extension, no schema change and no migration: the archive database is ejabberd's and an extension would need a superuser step on every existing install. The archive query is already bounded (the caller's own scope, the 12-month cutoff, at most `SEARCH_MAX_CANDIDATES` rows), so fuzzy matching can run in the Node server over those bounded candidates.

### What to build
1. Prefix matching: the LAST term of the query matches as a prefix (`to_tsquery` with `:*`, built from sanitized tokens, never string-concatenated SQL; a query with only operators/punctuation still answers an empty list, not a 500). Earlier terms stay whole words.
2. Accent and case folding for matching: "cafe" finds "café", "HELLO" finds "hello" (fold on both sides; keep the original text in the snippet).
3. Typo tolerance as a second pass: when the exact/prefix pass returns fewer rows than the page limit, run a bounded second query for the same scope (same permission scoping, same cutoff, same cap, newest first, no text filter) and score each candidate message in code: a message matches when every query term is within edit distance 1 (terms of 4 to 7 characters) or 2 (8+ characters; terms of 1 to 3 characters must match exactly or by prefix) of some word in the message (Damerau-Levenshtein, so a transposition counts as one edit). Exact and prefix hits rank before fuzzy ones; fuzzy ones keep newest-first order. De-duplicate against the first pass, apply the same edit/retraction handling as today, and the same cursor semantics (`nextBefore`) so paging stays correct.
4. Marks: the returned snippet must highlight the word(s) that matched, also for fuzzy matches (compute offsets in code for those; keep the existing `marks` wire shape `Array<[number, number]>`, offsets guarded against the snippet length). Snippets stay plain text (no markdown, no HTML).
5. Wire contract unchanged: the route path, params, limits and response shape do not change; clients (web and mobile) keep working without changes. Add an optional `match: 'exact' | 'fuzzy'` field to each result only if you can do it without breaking the current client schemas (they must ignore it); otherwise skip it.
6. Cost and safety: the second pass runs only when the first is short, never for a query shorter than 3 characters, reads at most `SEARCH_MAX_CANDIDATES` rows, and the per-user search rate limiter counts it as one request. The query text is never logged. Nothing new may see messages the caller may not already see (same scope builder, same 404-parity rules).

### Tests (real behaviour, no real network)
- "hello" finds "heello", "helo", "hlelo" (transposition), "hel" finds "hello" (prefix), "cafe" finds "café", "HELLO" finds "hello".
- Non-matches: "hello" does not find "yellow"; a 2-character term does not go fuzzy; a 5-character term does not match at distance 2.
- Exact hits rank before fuzzy hits; paging across the two passes returns each message once and `nextBefore` continues correctly.
- Permission scoping: a fuzzy candidate in a room the caller is not in, a private topic they cannot see, or a DM they are not part of never appears (reuse the T-0117 scoping tests with typo queries).
- Marks: offsets point at the matched word for exact, prefix and fuzzy hits; out-of-range offsets are impossible by construction (test with emoji and multi-byte text).
- Query edge cases: only punctuation, SQL metacharacters, 100-character query, unicode.

### Read first
`AGENTS.md`, `work/T-0117-message-search.md`, `work/T-0138-mobile-search.md` (Review), `apps/server/src/search/routes.ts`, `apps/server/src/search/service.ts`, `apps/server/src/search/search.test.ts`.

### Allowed files
`apps/server/src/search/**`, `docs/SERVER_CONFIG.md` (only a short note on matching behaviour), `work/T-0142-smarter-search.md`. Not allowed: schema, drizzle, web, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2 src/search
```
(Touched files and their neighbours only; the lead runs the full suites per batch.)

## Report (written by the worker)

## Review (written by Claude)
