---
id: T-1044
title: "Mock backend C1: chat-prefs (pin, mute, archive), chat-background and pins domains in @zilar/mock-backend"
status: merged
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
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`, as T-0942 set up. Each answers its contract group with the same bodies and mutations as the web mock.
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

T-1045 (folders, backgrounds and media) and T-1046 (stickers and GIFs) work in the same package in parallel. Touch only your own domain folders and your lines in `packages/mock-backend/src/domains/index.ts`.

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

**What I did**

Added the two new mock-backend domains, each a folder under
`packages/mock-backend/src/domains/` plus one alphabetical line in
`domains/index.ts`, using the T-0942 module-augmentation shape: a `tables.ts`
extends the shared `MockSeed`/`MockData` from the domain's own folder, so no
shared file (`src/state.ts`, `src/data/`) had to change.

- **`chat-prefs`** — `GET /chat-prefs`, `PUT /chat-prefs/:chatJid`
  (`pinned`, `mutedUntil`, `archived` and the three background fields) and
  `GET`/`PUT /chat-background`, mirroring web's mock
  (`apps/web/src/mock/api.ts:2502-2530`, `:2634-2684`): unknown-field and
  empty-body 400s, `invalid_request` on a bad body, `mutedUntil` date parse,
  the preset+image conflict, a row back at all defaults deleted
  (`{ prefs: null }`), and the 20-pinned-chat cap with rollback.
- **`pins`** — `GET /pins?chat=…`, `POST /pins`, `DELETE /pins/:id`, mirroring
  web's mock (`apps/web/src/mock/api.ts:2916-2984`): newest-first list, required
  `chat`/`messageId`/`senderName`, `pin_exists` 409, the 20-per-chat cap, the
  snapshot trimming, and the delete echo. Seeded **one text pin in the Ana DM**
  (`chat: ana@zilar.test`, `messageId: ana-17`, `"Deal"`), a real message id from
  `domains/messages/threads/ana.ts:37`.
- Routed both through the combined `MockData` only (like
  `domains/routines/routes.ts:10`); no other domain's files were touched.

Files changed:

- added `packages/mock-backend/src/domains/chat-prefs/{index,routes,seed,state,tables}.ts`
- added `packages/mock-backend/src/domains/pins/{index,routes,seed,state,tables}.ts`
- edited `packages/mock-backend/src/domains/index.ts` (2 imports + 2 array lines, alphabetical)
- edited `work/T-1044-mock-backend-prefs-pins.md`

Every file is under 400 lines; largest is `chat-prefs/routes.ts` at 162.

**Commands and results**

- `pnpm install` — succeeded (`Done in 19.6s`).
- `pnpm --filter @zilar/mock-backend typecheck` — passed (no output).
- `pnpm gate` — ends with `GATE PASS`; full summary:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (1.0s)
PASS  lint  (1.5s)
PASS  typecheck  (9.8s)
PASS  effect  (2.0s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

(The first `pnpm gate` run failed only on format for
`chat-prefs/routes.ts`; I fixed it with
`pnpm exec prettier --write packages/mock-backend/src/domains/chat-prefs/routes.ts`
and the second run passed.) No unit tests were run beyond the gate, as the spec
says no tests; the gate reports "no nearby test files".

**Proof (throwaway script, run then deleted)**

Ran a throwaway script against `createMockBackend({ delayMs: 0 })`, decoding
every body with the contract schemas (`ChatPrefList`, `PutChatPrefResult`,
`PinList`, `Pin` via `decodeOrThrow`). Real output:

```
1a PUT /chat-prefs/ana@zilar.test {pinned:true} -> 200 {"chatJid":"ana@zilar.test","mutedUntil":null,"archived":false,"pinnedAt":"2026-10-10T20:18:54.477Z","backgroundPreset":null,"backgroundImageId":null,"backgroundDim":null,"updatedAt":"2026-10-10T20:18:54.477Z"}
1b GET /chat-prefs -> {"prefs":[{"chatJid":"ana@zilar.test","mutedUntil":null,"archived":false,"pinnedAt":"2026-10-10T20:18:54.477Z","backgroundPreset":null,"backgroundImageId":null,"backgroundDim":null,"updatedAt":"2026-10-10T20:18:54.477Z"}]}
2a GET /pins?chat=ana@zilar.test -> {"pins":[{"id":"pin-ana-1","chat":"ana@zilar.test","messageId":"ana-17","senderName":"You","text":"Deal","kind":"text","pinnedBy":"u-you","pinnedAt":"2026-10-10T19:48:54.476Z"}]}
2b POST /pins -> 201 {"id":"pin-mock-1","chat":"ana@zilar.test","messageId":"ana-21","senderName":"Ana","text":"See you tonight","kind":"text","pinnedBy":"u-you","pinnedAt":"2026-10-10T20:18:54.487Z"}
2c DELETE /pins/pin-mock-1 -> 200 {"id":"pin-mock-1","chat":"ana@zilar.test","messageId":"ana-21","senderName":"Ana","text":"See you tonight","kind":"text","pinnedBy":"u-you","pinnedAt":"2026-10-10T20:18:54.487Z"}
PROOF OK
```

**Notes / deviations**

- The DM is keyed by the unified bare JID `ana@zilar.test`, not web's `c-ana`;
  per mock-plan.md Q2 the old mock ids may change.
- `pinnedBy` is `u-you` (the shared `currentUser.id`), matching web's mock.
- No app files changed and no tests added, per the spec.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The change:** new `chat-prefs` (with `chat-background`) and `pins` domains in `@zilar/mock-backend`. Only that package changed.
- **The nits:** trailing path segments are accepted loosely. That does not affect the smoke.
- **The lead's mobile mock phone smoke:**
  - Ana's chat shows the seeded pin bar ("Jump to pinned message from You", "You: Deal") instead of "Could not load pins";
  - long-press Marta › Pin moves Marta to the top of the list with no "Could not save".
- **Check:** the gate passed.
