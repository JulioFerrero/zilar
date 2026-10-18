---
id: T-1976
title: "Mock backend: add GET /routines (Settings › Routines) — the web page shows 'No mock route for /api/routines'"
status: merged
milestone: M5
branch: task/T-1976-mock-my-routines
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-1976: Mock `GET /routines`

## Spec (written by Claude, do not edit)

### Why
The lead's web sweep (2026-10-18) found that in mock mode, `/settings/routines` shows an error instead of the seeded routines: "No mock route for /api/routines", with a Retry button. Julio's rule (2026-10-10) is that the mock mirrors the real API on one shared fake backend.

### Facts (read by the lead on 2026-10-18)
- **The contract.** `packages/api-contract/src/routines.ts:51-53`:
  - `listMine` is `GET /routines`, and its success is `Schema.Array(MyRoutine)`.
  - `MyRoutine` (`:34-43`) is every `Routine` field plus `aiName`, `aiAvatarUrl?`, `chatName` (the topic name, the group name for a General topic, or `null` for a personal chat) and `chatJid` (nullable).
- **The real server's version** is in `apps/server/src/routines/api.ts` (around `:65`). Read it for which routines count as "mine": those of the AIs the caller owns.
- **The mock domain.** `packages/mock-backend/src/domains/routines/routes.ts` (101 lines):
  - `handleRoutines` handles `GET /ais/:id/routines`, `/groups/:id/routines`, `/topics/:id/routines` and per-routine pause, resume and delete.
  - It maps rows with `routineRow(data, row)`.
  - At `:43` it returns `undefined` when `head === 'routines'` and there's no id, which gives "No mock route".
- **Seeds and state:** `packages/mock-backend/src/domains/routines/seed.ts` and `state.ts`.

### Steps
1. **Add the route.** In `routes.ts`, before `:43`, handle `GET /routines` (`head === 'routines'`, no id). Return the non-deleted routines of the AIs the mock user owns, each as `routineRow(...)` plus `aiName`, `aiAvatarUrl`, `chatName` and `chatJid`.
   - Resolve these from the mock's AIs, groups, topics and chats data, the same way the real server does.
   - Where the mock has no room JID, use `null`.
2. **If the file would pass 400 lines,** put the mapping in a small new `packages/mock-backend/src/domains/routines/mine.ts`.
3. **No tests:** mock code, not a crucial area.

### Allowed files
- `packages/mock-backend/src/domains/routines/routes.ts`
- `packages/mock-backend/src/domains/routines/mine.ts`
- `work/T-1976-mock-my-routines.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The page shows routines.** The lead opens `/settings/routines?mock=1` on web and sees the seeded routines, with their AI and chat names, instead of the error. On the phone, `/settings/routines` lists them too.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- Added `GET /routines` to `packages/mock-backend/src/domains/routines/routes.ts`, before the
  existing "`routines` needs an id" fallthrough, so `/api/routines` no longer answers "No mock route".
- The new `myRoutineRows` returns every non-deleted routine of an AI that exists in the mock's AI
  table. The mock has a single user, so every AI in `data.ais` is theirs (same assumption as the
  seeded AI DM chats). It skips a routine whose AI (or whose topic) cannot be resolved, mirroring the
  server's visibility filter.
- Each row is `routineRow(...)` plus `aiName` and `aiAvatarUrl` from `data.findAi(aiId)` (the same
  source `topics/view.ts` uses for AI avatars), and `chatName`/`chatJid` from `routineChat`:
  - group routine: the topic's `chatJid`, named by the topic name, or by `data.findGroup(...).title`
    when the topic is its General (`Standup notes` → `Dev team`);
  - personal routine (`topicId === null`): `chatName: null`, `chatJid` the AI's own DM JID. Every
    mock topic has a room JID, so `null` is only used for a personal chat's name, as in the contract.
- Sorted running first, then title, then id, like the real server's `listMine`, since the page groups
  Running/Paused.
- No `mine.ts`: the file is ~179 lines, well under 400. No tests, per the spec.

Files changed:
- `packages/mock-backend/src/domains/routines/routes.ts`
- `work/T-1976-mock-my-routines.md`

### Checks run

- `pnpm install` from the repo root: done, no errors (one pre-existing peer-dependency warning for
  `@types/react-dom` in `apps/mobile`).
- `pnpm gate` (first run): **GATE FAIL** on `format` only — Prettier wanted to reflow one line in
  `routes.ts`. Fixed with `pnpm exec prettier --write packages/mock-backend/src/domains/routines/routes.ts`.
- `pnpm gate` (second run): **GATE PASS**, summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (4.8s)
  PASS  format  (0.8s)
  PASS  lint  (1.8s)
  PASS  typecheck  (8.0s)
  PASS  effect  (3.3s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files run: the spec says no tests, and the gate found no nearby test files.
- Runtime smoke check (not a test) with `tsx -e` in `packages/devtools`, calling `handleRoutines`
  with the default seed: `GET /api/routines` answered `200` with the two seeded routines, active
  first; `chatName` was `"Checkout button hidden on Safari"` for `t-devteam-bug` and `"Dev team"` for
  the General topic, and the JIDs were `t-devteam-bug@rooms.zilar.test` and
  `dev-team@rooms.zilar.test`. With a personal routine added (`ai-qa-1`, `topicId: null`), it
  answered `chatName: null` and `chatJid: ai-qa-1@zilar.test`, sorted after the active ones by title.
  I did not open `/settings/routines` in a browser or on the phone; the acceptance check is the
  lead's.

### Notes for the lead

- Ownership is not modelled in the mock: all `data.ais` are treated as the viewer's. That matches the
  single-user mock seed and the AI DM chats in `/chats`. If the mock ever gains other people's AIs,
  this filter needs an owner field.
- `chatJid` uses the mock's `topic.chatJid` directly, so the group room JID is the same one `/chats`
  and the XMPP fake use; personal routines use `ai.jid`, like the server.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean. At 1440 px in the web mock (`9c127b7fd`), `/settings/routines` lists the seeded routines under RUNNING (Morning prices) and PAUSED (Standup notes), each with its AI and chat names, instead of "No mock route for /api/routines".
