---
id: T-1074
title: "Mock sweep W5-W9 (web): dispatch answers only from @zilar/mock-backend; delete mock/api.ts and the dead seed files (index, chats, messages, topics, groups, members)"
status: todo
milestone: M5
branch: task/T-1074-web-mock-drop-old-routes
model: auto
effort: default
depends_on: [T-1072, T-1073]
estimate: 0.25 day
---

# T-1074: Web mock: drop the old hand-written routes

## Spec (written by Claude, do not edit)

### Why
The lead checked on main (2026-10-11), after T-1072 and T-1073:
- **`apps/web/src/mock/api.ts`** (1,054 lines) has only the push branches left (`:959-1035`) and the voice branches (`:1037-1045`) in `mockRequest`. T-1073 added both domains to `@zilar/mock-backend`.
- **The only importer of `mock/api.ts`** is `apps/web/src/mock/backend.ts:12`, through `mockRequest`, which is the fallback in `dispatch` (`:19-25`). No other file calls `mockRequest`, `resetMockApi` or `setMockDelay`. Note that `lib/*` imports `./api`, which is `lib/api`, a different file.
- **Dead once `api.ts` is gone** (grep for `mock/<name>` and `./<name>`):
  - `mock/index.ts` (12 lines) has no importer;
  - `mock/chats.ts` (156) is imported only by `mock/index.ts`;
  - `mock/messages.ts` (1,148) only by `mock/chats.ts` and `mock/index.ts`;
  - `mock/topics.ts` (240) only by `mock/api.ts:4` and `mock/index.ts`;
  - `mock/groups.ts` (131) only by `mock/members.ts` and `mock/index.ts`;
  - `mock/members.ts` (26) only by `mock/index.ts`.
- **Still used, so they stay:**
  - `mock/helpers.ts`: `components/StickerPanel.tsx:14` uses `mockGifItems`;
  - `mock/ids.ts`: `auth/AuthProvider.tsx:9`;
  - `mock/gate.ts`, `mock/load.ts` and `mock/backend.ts`.
- **Mobile already does this:** its `mockFetch` answers a JSON 404 when the backend has no route (`apps/mobile/src/mock/backend.ts:36-44`).

### What to build
1. **Probe first,** with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every push and voice method and path in `api.ts:959-1045`. If any call gets no `Response`, stop and report.
2. **`apps/web/src/mock/backend.ts`:** `dispatch` returns the backend's `Response`, or else a JSON 404 `{ error: { code: 'not_found', message: 'No mock route for <path>' } }`, the same shape as mobile's. Remove the `./api` import and update the file comment.
3. **Delete `apps/web/src/mock/api.ts`.**
4. **Delete the dead seed files** from Why: `mock/index.ts`, `mock/chats.ts`, `mock/messages.ts`, `mock/topics.ts`, `mock/groups.ts` and `mock/members.ts`.
   - Before deleting each one, `grep -rn` its module name across `apps/web` (`src`, `test`, `e2e`, config files), including `import(` forms.
   - Delete it only when nothing outside the deleted set imports it.
   - If something does, keep the file and say so in the Report.
5. **Clean up `mock/helpers.ts`:** after the deletions, remove the exports in it that nothing imports any more (`grep` each export). Keep `mockGifItems` and anything still used. If that would grow the change past about 300 edited lines (deletions of whole files do not count), leave `helpers.ts` alone and list the unused exports.
6. **No other file changes.**

The lead runs a web check with `?mock=1`:
- chats and Dev team › General load;
- send a message;
- Settings: Notifications (push), Profile, Machines, Approvals;
- the GIF tab in the sticker panel.

### Read first
`AGENTS.md`, `apps/web/src/mock/backend.ts`, `apps/mobile/src/mock/backend.ts`, `apps/web/src/mock/api.ts:940-1054`, and `work/T-1073-mock-backend-push-voice.md` (its Report).

### Allowed files
`apps/web/src/mock/backend.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/mock/index.ts`, `apps/web/src/mock/chats.ts`, `apps/web/src/mock/messages.ts`, `apps/web/src/mock/topics.ts`, `apps/web/src/mock/groups.ts`, `apps/web/src/mock/members.ts`, `apps/web/src/mock/helpers.ts`, `work/T-1074-web-mock-drop-old-routes.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe table and the grep for each deleted file.

---

## Report (written by the worker when done)

## Review (written by Claude)
