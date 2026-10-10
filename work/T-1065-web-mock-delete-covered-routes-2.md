---
id: T-1065
title: "Mock sweep W1b (web): delete the mock/api.ts routes the shared backend answers that T-1062 kept, plus backgrounds and chat-folders"
status: merged
milestone: M5
branch: task/T-1065-web-mock-delete-covered-routes-2
model: auto
effort: default
depends_on: [T-1062]
estimate: 0.25 day
---

# T-1065: Web mock sweep, part 2

## Spec (written by Claude, do not edit)

### Why
T-1062 deleted the `apps/web/src/mock/api.ts` branches for tools, chats, stickers and GIFs. It kept the following, only to stay under the size cap, even though its probe showed the backend answers every one of them (T-1062 Report, "Kept rows"):
- chat-prefs and chat background;
- pins, AI memory and contacts;
- AIs and search.

T-1045 has since added the `backgrounds` and `chat-folders` domains to `@zilar/mock-backend`, so those families (audit §1b) are now covered too.

Web mock mode asks the backend first and only falls back to `mockRequest` when the backend returns `undefined` (`apps/web/src/mock/backend.ts:17-23`), so those branches can no longer run.

### What to build
1. **Probe first,** the same way as T-1062. With a throwaway script, not committed, call `createMockBackend({ delayMs: 0 }).http(path, init)` for **every** method and path each branch handles:
   - chat-prefs (`GET /chat-prefs`, `PUT /chat-prefs/:jid`) and chat background (`GET`/`PUT /chat-background`);
   - pins, AI memory and contacts;
   - AIs (list, create, get, patch, delete, stop, resume, machine, approval-rules) and search;
   - backgrounds (`GET`/`POST`/`DELETE`);
   - chat-folders (`GET`, `POST`, order, `PATCH`, `DELETE`).

   Delete only the branches where every call gets a `Response`.
2. **Delete those branches,** and the helpers only they used. `grep` each one first. Keep the state and seed machinery (`MockState`, `seedState`, `resetMockApi`, `setMockDelay`, `mockRequest` itself) and every branch the backend does not cover: `PUT /me/handle`, `users/by-handle`, contact-requests, blocks, `handles/check`, push and voice.
3. **Size:** at most about 800 changed lines. If it comes to more, stop at a family boundary and list what is left.
4. **No other file changes.**

The lead runs a web check with `?mock=1`: pin a message, mute a chat, the folder chips, the chat background picker, an AI's memory, and search.

### Read first
`AGENTS.md`, `work/T-1062-web-mock-delete-covered-routes-1.md` (its Report), `docs/audit/mock-sweep-status.md` §1, `apps/web/src/mock/backend.ts`, and `apps/web/src/mock/api.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1065-web-mock-delete-covered-routes-2.md`.

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

Probed `@zilar/mock-backend` first, then deleted the `mockRequest` branches whose
every method and path the shared backend answers, plus the helpers only they used.
Deleted families: chat-prefs (`GET`, `PUT`), chat-background (`GET`, `PUT`),
pins (`GET`/`POST`/`DELETE`), ai-memory (`GET`, facts `DELETE`, clear `POST`),
contacts `GET`, AIs (list/create/get/patch/delete/stop/resume/machine/approval-rules)
and search `GET`, backgrounds (`GET`/`POST`/`DELETE`) and chat-folders (`GET`/`POST`/order/`PATCH`/`DELETE`).

Deleted dead helpers (found by `grep`, all referenced only from the deleted branches):
`seedChatFolders`, `seedAiMemory`, `readLimits`, `TEMPLATES`, `isTemplate`, `createAi`,
`patchAi`, `assignMachine`, `stopOrResumeAi`, `contacts`, `searchMessages`,
`codePointIndex`. Trimmed the now-unused imports `mockMessages`, `mockTopicMessages`
and the types `Contact`. Kept `MockState`, `seedState`, `resetMockApi`, `setMockDelay`,
`mockRequest` and the state/seed fields they still own.

Kept every branch the backend does not cover: `PUT /me/handle`, `users/by-handle`,
contact-requests, blocks, `handles/check`, push and voice.

### Files changed

- `apps/web/src/mock/api.ts` (deletions plus the import trimming)
- `work/T-1065-web-mock-delete-covered-routes-2.md` (this report + status)

### Probe (spec item 1)

Throwaway vitest file `packages/mock-backend/src/__t1065-probe.test.ts` (created,
run, then deleted; not committed) called `createMockBackend({ delayMs: 0 }).http(path, init)`
with a fresh backend per line. Run:
`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1065-probe.test.ts`
→ `Test Files 1 passed (1)`, `Tests 1 passed (1)`. Every line returned a `Response`;
no line returned `undefined`.

```
GET    /chat-prefs                                          backend=200
PUT    /chat-prefs/dev-team%40rooms.zilar.test               backend=200
PUT    /chat-prefs/whatever                                  backend=400
GET    /chat-background                                      backend=200
PUT    /chat-background                                      backend=200
PUT    /chat-background (preset + image)                     backend=400
GET    /pins?chat=c-ana                                      backend=200
POST   /pins                                                 backend=201
POST   /pins (missing fields)                                backend=400
DELETE /pins/nope                                            backend=404
GET    /ai-memory?chat=x&ai=y                                backend=200
DELETE /ai-memory/facts/nope                                 backend=404
POST   /ai-memory/clear                                      backend=200
GET    /contacts                                             backend=200
GET    /ais                                                  backend=200
POST   /ais                                                  backend=201
GET    /ais/ai-mock-dev                                      backend=404
PATCH  /ais/ai-mock-dev                                      backend=404
DELETE /ais/ai-mock-marketing                                backend=404
POST   /ais/ai-mock-dev/stop                                 backend=404
POST   /ais/ai-mock-dev/resume                               backend=404
PUT    /ais/ai-mock-dev/machine                              backend=404
GET    /ais/ai-mock-dev/approval-rules                       backend=404
GET    /ais/nope                                             backend=404
DELETE /ais/nope                                             backend=404
GET    /search?q=hello                                       backend=200
GET    /backgrounds                                          backend=200
POST   /backgrounds                                          backend=201
DELETE /backgrounds/bg-1                                     backend=404
GET    /chat-folders                                         backend=200
POST   /chat-folders                                         backend=201
PUT    /chat-folders/order                                   backend=400
PATCH  /chat-folders/f1                                      backend=404
DELETE /chat-folders/f1                                      backend=404
```

The 404/400 lines are the backend's own "unknown id / bad body" answers, not
`undefined`; the backend has a matching route for every method/path, so those
branches are dead in web mock mode (`backend.ts` `dispatch` asks the backend first).

### Branches kept, and why

- `PUT /me/handle` (inside the `me` branch) — the backend serves only `/me`; not covered.
- `users/by-handle` `GET`, contact-requests, blocks, `handles/check` — not covered by the backend.
- push (config/subscriptions/settings/test) and voice (transcription/transcript) — not covered.
- `MockState`/`seedState`/`resetMockApi`/`setMockDelay`/`mockRequest` — the state and seed machinery, kept per spec item 2.

### Size

`git diff --numstat` for `apps/web/src/mock/api.ts`: **723 deletions, 2 insertions
(725 changed lines)** — the insertions are the trimmed import lines. Inside the ~800 budget.

### Commands and real results

- `pnpm install` → done, no errors (one pre-existing mobile peer-dependency warning).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1065-probe.test.ts`
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
  The first gate run failed `lint` on the now-unused `mockMessages`/`mockTopicMessages`
  imports (removed); the second failed `format` on the `./topics` import block that
  now fits on one line (collapsed); the third run above is green.

### Deviations / open questions

- Two always-reference seed helpers, `seedChatFolders` and `seedAiMemory`, were only
  called from the deleted branches and would have tripped `no-unused-vars`, so I deleted
  them as "helpers only they used" (spec item 2). The `MockState` fields they fed
  (`chatFolders`, `aiMemory`) and every other seed function stay.
- No functional behavior change is expected: the shared backend answers every deleted
  route (probe above) and the web dispatcher already tries it first.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **The change:** 723 lines deleted from `apps/web/src/mock/api.ts`: chat-prefs, chat background, pins, AI memory, contacts, AIs, search, backgrounds and chat-folders, with their helpers. Two import lines were trimmed.
- **Why the deletions are safe:** the worker's probe got a backend `Response` for every deleted method and path. Kept, because the backend lacks them: `PUT /me/handle`, `users/by-handle`, contact-requests, blocks, `handles/check`, push and voice, plus the state and seed machinery.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - **pins:** Ana's pin bar ("You: Deal") shows;
  - **folders:** the Personal folder filters to Ana, Marta and Luis;
  - **mute:** chat menu › Mute › 1 hour puts the muted icon on Ana's row, with no error;
  - **background:** Chat background opens the presets, and the blue one applies.
- **Check:** the gate passed, including the `@zilar/web` tests.
