---
id: T-1065
title: "Mock sweep W1b (web): delete the mock/api.ts routes the shared backend answers that T-1062 kept, plus backgrounds and chat-folders"
status: todo
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

## Review (written by Claude)
