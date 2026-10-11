---
id: T-1109
title: "Error codes: one xmppUnavailable() constructor (always 503) replaces the 33 inline HttpError(502|503, 'xmpp_unavailable', …) sites"
status: todo
milestone: M5
branch: task/T-1109-xmpp-unavailable-constructor
model: auto
effort: default
depends_on: [T-1103]
estimate: 0.15 day
---

# T-1109: One `xmpp_unavailable` error

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, simplify-plan item 2.8: "Unify (503…)".

**What the lead read** in `apps/server/src`:
- `'xmpp_unavailable'` is built inline at 33 sites in 19 files. The message is always 'The chat service is temporarily unavailable'.
- The status is 503 at 21 sites and **502 at 9:**
  - `topics/ais.ts:90,172`;
  - `topics/members.ts:142,232,245`;
  - `topics/room-sync.ts:94`;
  - `topics/roles.ts:171`;
  - `topics/service.ts:151,325`.
- **The files:** `topics/service.ts` (4), `stickers/telegram.ts` (4), `topics/members.ts` (3), `stickers/storage.ts` (3), `topics/ais.ts`, `roles/service.ts`, `pins/service.ts` and `avatars/service.ts` (2 each), and one each in `xmpp/api.ts`, `topics/room-sync.ts`, `topics/roles.ts`, `topics/queries.ts`, `stickers/schemas.ts`, `stickers/packs.ts`, `stickers/favorites.ts`, `invite-links/join.ts`, `groups/schemas.ts`, `groups/join.ts` and `backgrounds/service.ts`.
- **Clients:** `packages/chat-core/src/ai-errors.ts:38` treats **503** as "unavailable", and no client checks 502.
- **`HttpError`** is in `apps/server/src/errors.ts:5`.
- **The pin codes stay as they are:** `pin_limit` (`pins/service.ts:120`) is about pinned messages and `too_many_pins` (`chat-prefs/service.ts:144`) is about pinned chats.

### What to build
1. **In `apps/server/src/errors.ts`,** add `export function xmppUnavailable(): HttpError { return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable'); }` with a one-line doc comment.
2. **Replace every inline `new HttpError(502|503, 'xmpp_unavailable', …)`** in the 19 files with `xmppUnavailable()`. Keep each site's control flow (`throw`, `Effect.fail` or a ternary) as it is.
   - Confirm afterwards with `grep -rn "'xmpp_unavailable'" apps/server/src | grep -v test`, which must show only `errors.ts`.
   - A schema or contract that **declares** the code as an error type (for example `stickers/schemas.ts`, `groups/schemas.ts`) keeps declaring it. Only the status in a declaration moves to 503, if one says 502.
3. **Tests:**
   - `apps/server/src/invite-links/invite-links.test.ts` mentions the code, so run it;
   - run the nearest tests of the changed modules (`ls apps/server/src/<module>/*.test.ts`) and paste the results;
   - if a test expects 502 for one of the 9 sites, change it to 503.
4. **No other files change.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/errors.ts`, and the 19 files (`grep -rln "'xmpp_unavailable'" apps/server/src`).

### Allowed files
`apps/server/src/errors.ts`, `apps/server/src/topics/service.ts`, `apps/server/src/stickers/telegram.ts`, `apps/server/src/topics/members.ts`, `apps/server/src/stickers/storage.ts`, `apps/server/src/topics/ais.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/xmpp/api.ts`, `apps/server/src/topics/room-sync.ts`, `apps/server/src/topics/roles.ts`, `apps/server/src/topics/queries.ts`, `apps/server/src/stickers/schemas.ts`, `apps/server/src/stickers/packs.ts`, `apps/server/src/stickers/favorites.ts`, `apps/server/src/invite-links/join.ts`, `apps/server/src/groups/schemas.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/invite-links/invite-links.test.ts`, `work/T-1109-xmpp-unavailable-constructor.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/invite-links/invite-links.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The grep shows `'xmpp_unavailable'` only in `errors.ts`.

---

## Report (written by the worker when done)

## Review (written by Claude)
