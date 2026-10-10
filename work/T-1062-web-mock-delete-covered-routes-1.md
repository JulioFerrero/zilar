---
id: T-1062
title: "Mock sweep W1+W2 (web): delete the mock/api.ts routes the shared backend already answers (tools, chats, stickers, GIFs, chat-prefs, pins, AI memory, contacts, AIs, search)"
status: todo
milestone: M5
branch: task/T-1062-web-mock-delete-covered-routes-1
model: auto
effort: default
depends_on: [T-1059]
estimate: 0.25 day
---

# T-1062: Web mock sweep, part 1

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §1a, slices W1 and W2.
- Web mock mode sends every request to `createMockBackend().http` first, and only falls back to `mockRequest` in `apps/web/src/mock/api.ts` (4,297 lines) when the backend returns `undefined` (`apps/web/src/mock/backend.ts:17-23`).
- The audit's probe showed that the backend already answers these families, so their `mockRequest` branches are never reached (the line ranges are on main, 2026-10-10):

| Family | `api.ts` lines |
| --- | --- |
| `toolRoutes` (tools and routines) | `633-822`, and its call at `2189-2194` |
| `GET /chats` | `2317-2319` |
| sticker packs | `2326-2361` |
| sticker panel | `2367-2432` |
| sticker favorites | `2436-2464` |
| sticker import (Telegram) | `2471-2478` |
| GIFs | `2483-2498` |
| chat-prefs | `2502-2629` |
| chat background | `2633-2678` |
| pins, ai-memory and contacts | `2916-3019` |
| AIs and search | `3021-3056` |

### What to build
1. **Probe every exact method and path first.** The audit probed one request per family. Before deleting a branch, write a throwaway script (do not commit it) that calls `createMockBackend({ delayMs: 0 }).http(path, init)` for **every** method and path the branch handles. Delete only the branches where the backend returns a `Response` for every one of them. Keep the rest, and list them in the Report.
2. **Delete those branches** from `mockRequest`, and delete `toolRoutes` with its call if all of its routes are covered.
3. **Delete the helpers** that only the deleted branches used. `grep` each one first. Keep anything that remaining code still uses, including the state and seed machinery: `MockState`, `seedState` and `resetMockApi` are later slices.
4. **Size:** at most about 800 changed lines (deletions count). If the ranges plus their helpers come to more, stop at the table rows that fit, and list what is left in the Report.
5. **No other file changes.**

The lead runs a web check with `?mock=1`: the chat list, a chat, the sticker and GIF panels, an AI's page, search, and pinning a message.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md` §1, `apps/web/src/mock/backend.ts`, `apps/web/src/mock/api.ts`, and `packages/mock-backend/src/domains/index.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1062-web-mock-delete-covered-routes-1.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status, and every branch kept with the reason.

---

## Report (written by the worker when done)

## Review (written by Claude)
