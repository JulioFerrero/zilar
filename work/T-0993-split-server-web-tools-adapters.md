---
id: T-0993
title: "Size split T55: apps/server/src/web-tools/adapters.ts (606 lines) into web-tools/{shared,fetch-adapter,wikipedia-adapter,price-adapter,feed-adapter,search-adapter}.ts; one withWebRateLimit"
status: todo
milestone: M5
branch: task/T-0993-split-server-web-tools-adapters
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0993: Split `web-tools/adapters.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/web-tools/adapters.ts` is 606 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #51 (task T55). The new files go in `apps/server/src/web-tools/`:
- `shared.ts`;
- `fetch-adapter.ts`, `wikipedia-adapter.ts`, `price-adapter.ts`, `feed-adapter.ts`, `search-adapter.ts`.

`adapters.ts` keeps `buildWebToolsAdapters`, the deps types and every export it has today. The folder already holds `feed.ts`, `guarded-fetch.ts`, `html.ts`, `prices.ts` and `search.ts`; leave them as they are.

The in-file Dedup is in scope: the five `checkWebRateLimit` preambles become one `withWebRateLimit(state, fn)`.
- **The rate limit:** it must run before every fetch, exactly as now, with the same limit and the same error.
- **The proof:** the Report quotes each `execute` before and after.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #51, and `apps/server/src/web-tools/adapters.ts`.

### Allowed files
`apps/server/src/web-tools/adapters.ts`, `apps/server/src/web-tools/shared.ts`, `apps/server/src/web-tools/fetch-adapter.ts`, `apps/server/src/web-tools/wikipedia-adapter.ts`, `apps/server/src/web-tools/price-adapter.ts`, `apps/server/src/web-tools/feed-adapter.ts`, `apps/server/src/web-tools/search-adapter.ts`, `work/T-0993-split-server-web-tools-adapters.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
