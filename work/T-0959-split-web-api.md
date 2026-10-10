---
id: T-0959
title: "Size split T1+T2: apps/web/src/lib/api.ts (1,792 lines) into lib/api/{http,chats,groups,topics,media,settings,ais,machines,stickers,people}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0959-split-web-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0959: Split web `api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/lib/api.ts` is 1,792 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T1, T2); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #1: `lib/api/http.ts`, `api/chats.ts`, `api/groups.ts`, `api/topics.ts`, `api/media.ts`, `api/settings.ts`, `api/ais.ts`, `api/machines.ts`, `api/stickers.ts`, `api/people.ts`, under `apps/web/src/`. `lib/api.ts` becomes the barrel. Every importer keeps `@/lib/api`, and with the file next to the folder, `@/lib/api` still resolves to `api.ts`.

Keep `isMockApiEnabled`, `loadMockRequest` and the mock branch of `request` exactly as they are: web mock mode depends on them (T-0946). Skip F7 (the api-contract facades); it is a separate task.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #1, and `apps/web/src/lib/api.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api/http.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/lib/api/topics.ts`, `apps/web/src/lib/api/media.ts`, `apps/web/src/lib/api/settings.ts`, `apps/web/src/lib/api/ais.ts`, `apps/web/src/lib/api/machines.ts`, `apps/web/src/lib/api/stickers.ts`, `apps/web/src/lib/api/people.ts`, `work/T-0959-split-web-api.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
- The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.
- The lead checks `?mock=1` in Chrome.

---

## Report (written by the worker when done)

## Review (written by Claude)
