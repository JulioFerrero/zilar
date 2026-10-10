---
id: T-1062
title: "Mock sweep W1+W2 (web): delete the mock/api.ts routes the shared backend already answers (tools, chats, stickers, GIFs, chat-prefs, pins, AI memory, contacts, AIs, search)"
status: merged
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

### What I did

Deleted the `mockRequest` branches (and their dead helpers) for the families whose
routes the shared `@zilar/mock-backend` already answers, stopping at the table rows
that fit the ~800-line size cap (spec item 4). Deleted rows:

- `toolRoutes` (tools and routines) plus its call in `mockRequest`, and the dead
  helpers `toolDetailRow`, `routineRow`, `findTool`, `findRoutine`, `toolAiIds`.
- `GET /chats` and its helper `chatEntries`.
- sticker packs, sticker panel, sticker favorites, sticker file GET and the
  Telegram import, plus `mockStickerFileUrl`, `findMockSticker`, `headerOf`,
  `invalidRequest`, `touchPack`, `createMockStickerPack`, `patchMockStickerPack`,
  `deleteMockStickerPack`, `uploadMockSticker`, `deleteMockSticker`,
  `importMockTelegramPack`, `favoriteRows`, and the now-unused `randomUUID`.
- GIFs.

Kept rows 8-11 (chat-prefs, chat background, pins/ai-memory/contacts, AIs/search)
because deleting them plus their helpers would exceed the cap; listed below.

Removed the now-unused imports `mockChats`, `mockDemoStickerArt`, `mockGifItems`
and the types `ChatEntry` (from `@/lib/api`). No other file changed.

### Files changed

- `apps/web/src/mock/api.ts` (deletions only, plus the import trimming)
- `work/T-1062-web-mock-delete-covered-routes-1.md` (this report + status)

### Probe (spec item 1)

Throwaway vitest file `packages/mock-backend/src/__t1062-probe.test.ts` (created,
run, then deleted; not committed). It called `createMockBackend({ delayMs: 0 }).http(path, init)`
with a fresh backend per line, so no request saw another's mutations. Run:
`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1062-probe.test.ts`
→ 1 test passed. Every probe below returned a `Response`; no line returned `undefined`.

```
GET    /ais/ai-dev-1/tools                                        backend=200
GET    /ais/nope-ai/tools                                         backend=404
GET    /groups/g-devteam/tools                                    backend=200
GET    /groups/g-devteam/routines                                 backend=200
GET    /ais/ai-dev-1/routines                                     backend=200
GET    /tools/tool-mock-prices                                    backend=200
GET    /tools/tool-mock-prices/versions                           backend=200
GET    /tools/tool-mock-prices/versions/1                         backend=200
GET    /tools/tool-mock-prices/runs                               backend=200
POST   /tools/tool-mock-prices/revert                             backend=200
POST   /tools/tool-mock-prices/run                                backend=200
DELETE /tools/tool-mock-notes                                     backend=204
DELETE /routines/routine-mock-standup                             backend=204
POST   /routines/routine-mock-morning/pause                       backend=200
POST   /routines/routine-mock-standup/resume                      backend=200
GET    /tools/nope                                                backend=404
GET    /tools/nope/versions/1                                     backend=404
DELETE /routines/nope                                             backend=404
POST   /routines/nope/pause                                       backend=404
GET    /chats                                                     backend=200
GET    /sticker-packs                                             backend=200
POST   /sticker-packs                                             backend=201
GET    /sticker-packs/discover                                    backend=200
PATCH  /sticker-packs/11111111-1111-4111-8111-111111111111        backend=200
DELETE /sticker-packs/11111111-1111-4111-8111-111111111111        backend=200
POST   /sticker-packs/11111111-1111-4111-8111-111111111111/stickers backend=201
DELETE /sticker-packs/11111111-1111-4111-8111-111111111111/stickers/21111111-1111-4111-8111-111111111111 backend=200
POST   /sticker-packs/import/telegram                             backend=200
PUT    /sticker-panel                                             backend=200
PUT    /sticker-panel/11111111-1111-4111-8111-111111111111        backend=200
DELETE /sticker-panel/11111111-1111-4111-8111-111111111111        backend=200
GET    /stickers/21111111-1111-4111-8111-111111111111/file        backend=200
PUT    /sticker-panel/                                            backend=404
GET    /stickers/nope/file                                        backend=404
GET    /sticker-favorites                                         backend=200
PUT    /sticker-favorites                                         backend=200
DELETE /sticker-favorites?sticker_id=21111111-1111-4111-8111-111111111111 backend=200
PUT    /sticker-favorites                                         backend=404
GET    /gifs/search?q=cat                                         backend=200
GET    /gifs/trending                                             backend=200
POST   /gifs/search                                               backend=404
```

Kept rows, probed for completeness (not deleted, see reasons):

```
GET    /chat-prefs                                                backend=200
PUT    /chat-prefs/dev-team%40rooms.zilar.test                    backend=200
PUT    /chat-prefs/whatever                                       backend=200
PUT    /chat-prefs/whatever (unknown field)                       backend=400
GET    /chat-background                                           backend=200
PUT    /chat-background                                           backend=200
PUT    /chat-background (preset + image)                          backend=400
GET    /pins?chat=g-devteam                                       backend=200
POST   /pins                                                      backend=201
POST   /pins (missing fields)                                     backend=400
DELETE /pins/nope                                                 backend=404
GET    /ai-memory?chat=x&ai=y                                     backend=200
DELETE /ai-memory/facts/nope                                      backend=404
POST   /ai-memory/clear                                           backend=200
GET    /contacts                                                  backend=200
GET    /ais                                                       backend=200
POST   /ais                                                       backend=201
GET    /ais/ai-dev-1                                              backend=200
PATCH  /ais/ai-dev-1                                              backend=200
DELETE /ais/ai-marketing                                          backend=204
POST   /ais/ai-dev-1/stop                                         backend=200
POST   /ais/ai-dev-1/resume                                       backend=200
PUT    /ais/ai-dev-1/machine                                      backend=200
GET    /ais/ai-dev-1/approval-rules                               backend=200
GET    /ais/nope                                                  backend=404
DELETE /ais/nope                                                  backend=404
GET    /search?q=hello                                            backend=200
```

### Branches kept, and why

- **chat-prefs (`GET`, `PUT`) and chat background (`GET`, `PUT`)** — the backend
  covers all of them (probe above), but deleting the branches plus the shared
  `2500-2678` block would push the change over the ~800-line cap (spec item 4).
- **pins (`GET`/`POST`/`DELETE`), ai-memory (`GET`, facts `DELETE`, clear `POST`),
  contacts `GET`** — backend covers them; same size-cap reason.
- **AIs (`GET`/`POST`/`GET :id`/`PATCH`/`DELETE`/`stop`/`resume`/`machine`/`approval-rules`)
  and search `GET`** — backend covers them; same size-cap reason.
- **`PUT /me/handle` (`me` branch)** — not covered by the backend (`me/routes.ts`
  serves only `/me`); the audit marks it 1b, so it stays.
- **backgrounds, chat-folders** — covered by the backend since T-1045, but they are
  not in this task's table (audit §1b/1c) and are left for a later slice.

### Size

`git diff --numstat` for `apps/web/src/mock/api.ts`: **754 deletions, 2 insertions
(756 changed lines)** — the two insertions are the trimmed import lines. Inside the
~800 budget.

### Commands and real results

- `pnpm install` → done, no errors (one pre-existing mobile peer-dependency warning).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1062-probe.test.ts`
  → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` → **GATE PASS**; summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.5s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/web  (2.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed `format` (I ran `prettier --write` on `api.ts`) and the
  second failed `lint` on one now-unused `segments` declaration (I removed it); the
  third run above is green.

### Deviations / open questions

- Per spec item 4, I stopped at the rows that fit the size cap: rows 1-7 (tools,
  chats, stickers, GIFs) are done; rows 8-11 are listed above as left for a follow-up.
- No functional behavior change is expected: the shared backend answers all deleted
  routes (probe above), and the web dispatcher already tries it first.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** 754 lines deleted from `apps/web/src/mock/api.ts`: `toolRoutes` and its call, `GET /chats`, every sticker branch (packs, panel, favorites, Telegram import) and GIFs. Two import lines were trimmed. Nothing else changed.
- **Kept on purpose:** the worker probed chat-prefs, chat background, pins, AI memory, contacts, AIs and search as covered, but kept them for the ~800-line cap; they are the next slice. `PUT /me/handle` is not covered and stays.
- **Why the deletions are safe:** `backend.ts` `dispatch` asks `createMockBackend().http` first, and the worker's probe got a `Response` from the backend for every deleted method and path. So those branches could not run.
- **The lead's web check** (`?mock=1`, branch on port 5199 and main on 5196):
  - the chat list, Ana's chat and My AIs (Dev-1, QA-1, Marketing AI) load;
  - the sticker panel lists Recent, Cats and Moods;
  - the sticker thumbnails are broken images on **main too**. The `<img src="/api/stickers/<id>/file">` request goes to the dev server, which answers 404, and never reaches the mock dispatcher. The board follow-up on blank mock stickers now covers web too.
- **Check:** the gate passed, including the `@zilar/web` tests.
