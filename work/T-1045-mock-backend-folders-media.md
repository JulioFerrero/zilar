---
id: T-1045
title: "Mock backend C2: chat-folders, backgrounds and media gallery domains in @zilar/mock-backend"
status: todo
milestone: M5
branch: task/T-1045-mock-backend-folders-media
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.5 day
---

# T-1045: Mock backend C2, folders, backgrounds and media

## Spec (written by Claude, do not edit)

### Why
This is the second part of mock wave 2: task C in `docs/audit/mock-plan.md` §4. Read the plan and "Julio's answers".

Mobile mock mode answers 404 for any route the shared backend lacks (`apps/mobile/src/mock/backend.ts:8-10`). On 2026-10-10 the lead saw the "Media, files and links" sheet show "Could not load media" in a mobile mock phone smoke, and the web panel show the same in Chrome.

### What to build
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `src/domains/index.ts`.
   - **`chat-folders`:** list, create, `PUT /chat-folders/order`, `PATCH /chat-folders/:id` and `DELETE /chat-folders/:id`.
     - Contract: `packages/api-contract/src/chat-folders.ts:138-154`.
     - Web mock: `apps/web/src/mock/api.ts:2736-2835`, with the same bodies and mutations.
   - **`backgrounds`:** `POST`/`GET /backgrounds`, `GET /backgrounds/:id` and `DELETE /backgrounds/:id`.
     - Contract: `packages/api-contract/src/backgrounds.ts:39-49`.
     - Web mock: `apps/web/src/mock/api.ts:2685-2735`.
     - Uploads keep the `data:` URL approach the plan names in §3 ("Not worth faking").
   - **`media`:** `GET /media`, the gallery. Contract: `packages/api-contract/src/media.ts:57`.
     - The web mock has no media route, so build it from the messages domain's seed. `packages/mock-backend/src/domains/messages/threads/ana.ts` already holds `Stage.png` and `tickets.pdf`.
     - The Ana DM's Media and Files tabs must list them, and the Links tab any URL in a seed message.
     - Read the messages state through the combined `MockData` (as `domains/routines/routes.ts:10` does), and do not edit the messages files.
2. **Size:** keep every file under 400 lines.
3. **No app file changes and no tests.** Prove it in the Report with a throwaway script against `createMockBackend()`, decoding each response with its contract schema:
   - create a folder, reorder it, patch it and delete it;
   - `GET /media` for the Ana DM, on each tab or kind the contract has.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts`, `domains/routines/` and `domains/messages/`, and the web mock ranges and contract files above.

### Allowed files
`packages/mock-backend/**`, `work/T-1045-mock-backend-folders-media.md`.

T-1044 (prefs and pins) and T-1046 (stickers and GIFs) work in the same package in parallel. Touch only your own domain folders and your lines in `src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded folder and media proof.

The lead then checks the media panel and the folder editor in mock mode.

---

## Report (written by the worker when done)

## Review (written by Claude)
