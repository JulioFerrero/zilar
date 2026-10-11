---
id: T-1109
title: "Error codes: one xmppUnavailable() constructor (always 503) replaces the 33 inline HttpError(502|503, 'xmpp_unavailable', …) sites"
status: merged
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
`apps/server/src/errors.ts`, `apps/server/src/topics/service.ts`, `apps/server/src/stickers/telegram.ts`, `apps/server/src/topics/members.ts`, `apps/server/src/stickers/storage.ts`, `apps/server/src/topics/ais.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/xmpp/api.ts`, `apps/server/src/topics/room-sync.ts`, `apps/server/src/topics/roles.ts`, `apps/server/src/topics/queries.ts`, `apps/server/src/stickers/schemas.ts`, `apps/server/src/stickers/packs.ts`, `apps/server/src/stickers/favorites.ts`, `apps/server/src/invite-links/join.ts`, `apps/server/src/groups/schemas.ts`, `apps/server/src/groups/join.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/invite-links/invite-links.test.ts`, `apps/server/src/roles/roles.test.ts`, `work/T-1109-xmpp-unavailable-constructor.md`.

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

**Outcome: done, gate green.** One deviation needs the lead's eye (below): the 502→503 test fix lives in a file the Allowed-files list omitted.

### What I did
- Added `xmppUnavailable()` to `apps/server/src/errors.ts` with a one-line doc comment, returning `new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable')`.
- Replaced all 33 inline sites across the 19 files with `xmppUnavailable()`; the 9 sites that were 502 now answer 503. Each site's control flow is unchanged (`throw`, `Effect.fail`, and `error instanceof HttpError ? error : …` ternaries); Prettier collapsed the now-short ternaries onto one line, which is the repo's formatting.
- `topics/queries.ts` and `xmpp/api.ts` no longer reference `HttpError`, so their import became `import { xmppUnavailable } from '../errors';`. The other 17 files still use `HttpError` and now import `{ HttpError, xmppUnavailable }`.
- The two error-mapping contracts that name the code (`stickers/schemas.ts` `mapStickerError`, `groups/schemas.ts` `mapXmppError`) now call `xmppUnavailable()`; their declaration is unchanged and the status is 503. No other declaration of the code exists.

### Files changed (21 code files + this task file)
`apps/server/src/errors.ts`, `topics/service.ts`, `stickers/telegram.ts`, `topics/members.ts`, `stickers/storage.ts`, `topics/ais.ts`, `roles/service.ts`, `pins/service.ts`, `avatars/service.ts`, `xmpp/api.ts`, `topics/room-sync.ts`, `topics/roles.ts`, `topics/queries.ts`, `stickers/schemas.ts`, `stickers/packs.ts`, `stickers/favorites.ts`, `invite-links/join.ts`, `groups/schemas.ts`, `groups/join.ts`, `backgrounds/service.ts`, and `roles/roles.test.ts` (the deviation).

### Commands and real results
- `pnpm install` — done (1172 packages), no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts` → **1 file passed, 21 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/roles/contract.smoke.test.ts src/xmpp/token.test.ts src/invite-links/contract.smoke.test.ts src/groups/visibility.test.ts` → **5 files passed, 57 tests passed** (these are the only tests adjacent to a changed module; `topics/`, `stickers/`, `pins/`, `avatars/`, `backgrounds/` have no test files next to them).
- First `pnpm gate` failed on format for 8 files (the short ternaries); ran `pnpm exec prettier --write` on those 8, then re-ran the gate.
- Second `pnpm gate`:
```
gate: 22 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.0s)
PASS  lint  (1.2s)
PASS  typecheck  (4.2s)
PASS  effect  (1.0s)
PASS  tests @zilar/server  (15.2s)
scope: 1 file(s) outside the Allowed files:
  apps/server/src/roles/roles.test.ts
GATE PASS
```
- `grep -rn "'xmpp_unavailable'" apps/server/src | grep -v test` → only `apps/server/src/errors.ts:27`. `grep -rn "new HttpError(50[23], 'xmpp_unavailable'" apps/server/src` → no matches.
- Line counts: `topics/service.ts` 380, `stickers/telegram.ts` 399, `errors.ts` 28 — all ≤ 400.

### Deviations / needs the lead's eye
- **Spec item 3 vs Allowed files.** `apps/server/src/roles/roles.test.ts:934` asserts `setTopicRoles(...)` answers **502** (that path is `topics/roles.ts:171`, one of the 9 sites). Item 3 says to change such a test to 503, so I did (assertion + comment). That file is **not** in the Allowed files, so the gate scope report lists it as the one out-of-scope file. Without the edit the gate fails (the test expects the old status); with it the gate passes but the scope line shows. I kept the spec-mandated change and flag it here — please add `apps/server/src/roles/roles.test.ts` to Allowed files (or tell me to revert) if the scope line must be empty.
- The spec's note about a schema/contract that *declares* the code does not apply beyond the two `map…Error` functions above; there is no standalone declaration of `'xmpp_unavailable'` in the tree.

### Acceptance
- Checks pass (invite-links test + `pnpm gate` → GATE PASS).
- The grep shows `'xmpp_unavailable'` only in `errors.ts`.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:** `errors.ts` has `xmppUnavailable()` (503, 'The chat service is temporarily unavailable'), and all 33 inline sites in 19 files use it. `grep "'xmpp_unavailable'"` (without tests) now shows only `errors.ts:27`. The 9 former-502 sites in `topics/*` answer 503, which `chat-core/ai-errors.ts:38` shows as "unavailable".
- **The follow-up, resolved by the lead:** `roles/roles.test.ts:934` moved from 502 to 503, as spec step 3 asked. The lead had left that file out of the Allowed list, and added it.
- **Tests:** the lead ran `roles/roles.test.ts` and `invite-links/invite-links.test.ts` on the branch: 43 green. The gate passed.
- **The pin codes are unchanged on purpose:** `pin_limit` is for pinned messages and `too_many_pins` for pinned chats.
