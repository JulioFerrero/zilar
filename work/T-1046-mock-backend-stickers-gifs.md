---
id: T-1046
title: "Mock backend F1: stickers (packs, panel, favorites, discover, files) and GIFs (search, trending) domains in @zilar/mock-backend"
status: todo
milestone: M5
branch: task/T-1046-mock-backend-stickers-gifs
model: auto
effort: default
depends_on: [T-0949]
estimate: 0.5 day
---

# T-1046: Mock backend F1, stickers and GIFs

## Spec (written by Claude, do not edit)

### Why
This is the third part of mock wave 2: task F in `docs/audit/mock-plan.md` §4. Read the plan and "Julio's answers".

Mobile mock mode answers 404 for any route the shared backend lacks (`apps/mobile/src/mock/backend.ts:8-10`). On 2026-10-10 the lead's mobile mock smoke showed six GIF cells but no images.

### What to build
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`.
   - **`stickers`:** the `stickers` contract group (`packages/api-contract/src/stickers.ts:140-197`). That covers packs (list, create, patch, delete), stickers (upload, delete, `GET /stickers/:stickerId/file`), discover, the panel (reorder, add, remove) and favorites (list, add, remove).
     - Web mock: `apps/web/src/mock/api.ts:2326-2482`, with the same bodies and mutations.
     - Mobile cross-check: `apps/mobile/src/mock/stickers.ts` and `apps/mobile/src/components/stickers/stickers-mock.ts`.
     - The Telegram import (`POST /sticker-packs/import/telegram`) answers as the web mock does, or with a fixed contract error if the web mock has none. State which one in the Report.
     - Sticker images are inline `data:` URLs or small SVGs, so they render with no network.
   - **`gifs`:** `GET /gifs/search` and `GET /gifs/trending` (`packages/api-contract/src/gifs.ts:42-46`).
     - Web mock: `apps/web/src/mock/api.ts:2483-2501`.
     - Mobile cross-check: `apps/mobile/src/mock/gifs.ts`.
     - Each result's preview and full URL must render with no network (a `data:` URL), because the plan does not fake the `/gifs/media/:token` proxy (§3).
2. **Size:** keep every file under 400 lines.
3. **No app file changes and no tests.** Prove it in the Report with a throwaway script against `createMockBackend()`, decoding each response with its contract schema:
   - list the packs, then add and remove a favorite;
   - `GET /gifs/trending`, and show that a result's URL starts with `data:`.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts`, one existing domain (`routines/`), and the web mock ranges, mobile mock files and contract files above.

### Allowed files
`packages/mock-backend/**`, `work/T-1046-mock-backend-stickers-gifs.md`.

T-1044 (prefs and pins) and T-1045 (folders, backgrounds and media) work in the same package in parallel. Touch only your own domain folders and your lines in `packages/mock-backend/src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded sticker and GIF proof.

The lead then runs a mobile mock smoke of the sticker and GIF panels.

---

## Report (written by the worker when done)

## Review (written by Claude)
