---
id: T-1044
title: "Mock backend C1: chat-prefs (pin, mute, archive), chat-background and pins domains in @zilar/mock-backend"
status: todo
milestone: M5
branch: task/T-1044-mock-backend-prefs-pins
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.5 day
---

# T-1044: Mock backend C1, chat prefs and pins

## Spec (written by Claude, do not edit)

### Why
This is the first part of mock wave 2: task C in `docs/audit/mock-plan.md` §4. Read the plan and "Julio's answers", where Q3 puts C in the second wave.

Mobile mock mode has no request fallback (`apps/mobile/src/mock/backend.ts:8-10`): a route the shared backend lacks answers 404. The lead saw this in mock phone smokes on 2026-10-10:
- Pin, Mute and Archive in the chat-actions sheet answer "Could not save. Try again.";
- every chat shows "Could not load pins."

### What to build
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `src/domains/index.ts`, as T-0942 set up. Each answers its contract group with the same bodies and mutations as the web mock.
   - **`chat-prefs`:** `GET /chat-prefs` and `PUT /chat-prefs/:chatJid` (pinned, muted until, archived), plus `GET` and `PUT /chat-background`.
     - Contract: `packages/api-contract/src/chat-prefs.ts:99-110`.
     - Web mock: `apps/web/src/mock/api.ts:2502-2530` (chat-prefs) and `:2508`, `:2634-2684` (chat-background).
     - Mobile cross-check: `apps/mobile/src/mock/chat-prefs.ts`.
   - **`pins`:** `GET /pins`, `POST /pins` and `DELETE /pins/:id`.
     - Contract: `packages/api-contract/src/pins.ts:91-102`.
     - Web mock: `apps/web/src/mock/api.ts:2916-2984`.
     - Mobile cross-check: `apps/mobile/src/mock/pins.ts`.
     - Seed one pinned message in the Ana DM (`ana@zilar.test`), using a real message id from `packages/mock-backend/src/domains/messages/threads/ana.ts`.
2. **Read-only access to the rest:** read other domains through the combined `MockData`, as `domains/routines/routes.ts:10` does, and do not edit their files.
3. **Size:** keep every file under 400 lines.
4. **No app file changes and no tests.** Prove it in the Report with a throwaway script against `createMockBackend()`:
   - `PUT /chat-prefs/ana@zilar.test {pinned:true}`, then `GET /chat-prefs`, decoded with the contract schema;
   - `GET /pins?chat=…` for the Ana DM, decoded;
   - `POST` a pin and `DELETE` it.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts`, one existing domain (`routines/`), the web mock ranges and contract files above, and the two mobile mock files.

### Allowed files
`packages/mock-backend/**`, `work/T-1044-mock-backend-prefs-pins.md`.

T-1045 (folders, backgrounds and media) and T-1046 (stickers and GIFs) work in the same package in parallel. Touch only your own domain folders and your lines in `src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded proof for prefs and pins.

The lead then runs a mobile mock smoke: Pin on a chat, and the Ana DM's pin bar.

---

## Report (written by the worker when done)

## Review (written by Claude)
