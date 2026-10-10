---
id: T-1074
title: "Mock sweep W5-W9 (web): dispatch answers only from @zilar/mock-backend; delete mock/api.ts and the dead seed files (index, chats, messages, topics, groups, members)"
status: merged
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

### What I did

1. **Probe (throwaway, not committed).** `apps/web/src/mock/t1074-probe.test.ts`
   called `createMockBackend({ delayMs: 0 }).http(path, init)` for every push and
   voice method/path in `api.ts:959-1045` and asserted each answer `instanceof
   Response`. Every call got a `Response`; the file was deleted before the gate
   (it does not appear in the gate's diff). Script:
   `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1074-probe.test.ts`
   → `Test Files 1 passed (1) / Tests 1 passed (1)`.
2. **`apps/web/src/mock/backend.ts`:** `dispatch` now returns the shared backend's
   `Response` or, when the backend answers `undefined`, a JSON 404 with the same
   shape as mobile's `mockFetch`:
   `{ error: { code: 'not_found', message: 'No mock route for <path>' } }`, status
   404, `Content-Type: application/json`. Removed the `./api` import and rewrote
   the file comment (it no longer names `mock/api.ts`). `load.ts` still re-exports
   `dispatch` unchanged, so no other file moved.
3. **Deleted `apps/web/src/mock/api.ts`.**
4. **Deleted the dead seed files** after grepping each module name across
   `apps/web` (see the grep evidence below): `index.ts`, `chats.ts`, `messages.ts`,
   `topics.ts`, `groups.ts`, `members.ts`.
5. **Trimmed `apps/web/src/mock/helpers.ts`** to the only export anything still
   imports: `mockGifItems` (plus its private `mockGifArt` and the `MockGifItem`
   interface). Removed the now-unused `atHour`, `plusMinutes`, `waveform`, `voice`,
   `svgImage`, `progressCard`, `approvalCard`, `MockDemoStickerPack`,
   `mockDemoStickerPacks`, `mockDemoStickerArt`, `MOCK_TOPIC_NOT_FOUND` and the
   then-unused top imports (`VoiceMeta`, `Payload`, `AI_JIDS`, `ROOMS`). That is
   ~178 edited lines, under the ~300-line limit, so the cleanup was done rather
   than deferred.
6. No other file changed.

### Files changed

Deleted (whole): `apps/web/src/mock/{api,index,chats,messages,topics,groups,members}.ts`.
Modified: `apps/web/src/mock/backend.ts` (+13/-... net: 2 comments + 404 helper and
branch), `apps/web/src/mock/helpers.ts` (223 → 49 lines). Plus this task file.
9 code files, none outside the Allowed files (`git diff --stat`:
`9 files changed, 13 insertions(+), 2952 deletions(-)`).

### Probe table (real output, one line per route)

```
PROBE GET /push/config -> 200 {"vapidPublicKey":"mock-vapid-public-key","pushJid":"push.mock.test"}
PROBE GET /push/subscriptions (empty) -> 200 {"devices":[]}
PROBE POST /push/subscriptions -> 200 {"id":"mock-push-device-1","node":"mock-node-mock-push-device-1","jid":"push.mock.test"}
PROBE POST /push/subscriptions (invalid) -> 400 {"error":{"code":"invalid_subscription","message":"The push subscription is invalid"}}
PROBE GET /push/settings -> 200 {"showPreviews":true}
PROBE PUT /push/settings -> 200 {"showPreviews":false}
PROBE POST /push/test (existing) -> 200 {"sent":true}
PROBE POST /push/test (missing) -> 404 {"error":{"code":"not_found","message":"Push device not found"}}
PROBE DELETE /push/subscriptions/:id -> 200 {"removed":true}
PROBE DELETE /push/subscriptions/:id (missing) -> 404 {"error":{"code":"not_found","message":"Push device not found"}}
PROBE GET /voice/transcription -> 200 {"enabled":true}
PROBE POST /voice/transcript -> 200 {"text":"Transcript of https://x.test/a.ogg"}
PROBE POST /voice/transcript (invalid) -> 400 {"error":{"code":"invalid_request","message":"url must not be empty"}}
```

The probe also covered the invalid bodies (400) each `api.ts` branch handled; the
`POST /push/subscriptions (invalid)` line above is the 400 case. Note the probe's
`PUT /push/settings` body was `{ showPreviews: false }`; `api.ts` had no invalid
`PUT` case in its branch list, so none was probed.

### Grep evidence before each deletion

Searched `apps/web` (src, test, e2e, config) for `mock/<name>`, the relative
`./<name>` form and the `import(` form, then repo-wide for `from '...mock/<name>'`
in `*.ts/tsx/js/jsx/mjs/cjs/json`:

- **`api.ts`** — only importer: `apps/web/src/mock/backend.ts:12` (`import { mockRequest } from './api'`). `mockRequest`/`resetMockApi`/`setMockDelay`/`MockRequestOptions` appeared nowhere else. `mock/api` was named only in comments (`backend.ts:7`, `load.ts:5`, `gate.ts:100`).
- **`index.ts`** — the symbol grep (`mockChats|mockMessages|mockLastMessage|mockGroupDetails|mockOwnedAis|mockGroupMembers|mockTopicAisById|mockTopicChats|mockTopicMembersById`, plus bare `@/mock`/`../mock` imports) found no importer outside the deleted set.
- **`chats.ts`** — imported only by `mock/index.ts:2`.
- **`messages.ts`** — imported only by `mock/chats.ts:3` and `mock/index.ts:5`.
- **`topics.ts`** — imported only by `mock/api.ts:4` and `mock/index.ts:11`.
- **`groups.ts`** — imported only by `mock/members.ts:2` and `mock/index.ts:3`.
- **`members.ts`** — imported only by `mock/index.ts:4`.
- **helpers exports** — after the deletions the only remaining importer is
  `apps/web/src/components/StickerPanel.tsx:14` (`mockGifItems`); every other
  symbol above lived only in the deleted files.

Repo-wide `from '...mock/{chats,messages,topics,groups,members}'` in code files:
**no matches**.

### Commands and real results

- `pnpm install`: done (9.7s, 1172 added; one pre-existing mobile peer-dep warning).
- Probe (throwaway, deleted before the gate):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1074-probe.test.ts`
  → 1 passed.
- `pnpm gate` (repo root):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.3s)
PASS  effect  (0.6s)
PASS  tests @zilar/web  (1.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single-file tests were run for the final change beyond the gate: the cutover is
UI wiring and the gate already ran the nearest `@zilar/web` tests.

### Deviations / notes

- **Stale comments left in place (no deviation from the spec, but flagging it):**
  `apps/web/src/mock/load.ts:5` and `apps/web/src/mock/gate.ts:100` still mention
  `mock/api.ts` in comments. Both files are outside the Allowed files and spec
  step 6 says "no other file changes", so I left them. They are comments only, no
  import.
- Mobile's 404 shape was mirrored exactly (`code: 'not_found'`,
  `message: 'No mock route for <path>'`, status 404, JSON content type), so the two
  apps answer an unknown mock path the same way.
- The 404 `message` uses the `path` argument as received (web's callers pass the
  relative `/api`-less path, e.g. `/push/config`), matching how mobile uses its
  `pathAndQuery` result.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up (stale comments).**
- **The change:**
  - `apps/web/src/mock/backend.ts` `dispatch` answers only from `@zilar/mock-backend`, with a JSON 404 otherwise, like mobile's `mockFetch`;
  - deleted: `mock/api.ts`, `index`, `chats`, `messages`, `topics`, `groups` and `members`;
  - `helpers.ts` lost 178 lines of unused exports.
  - In all, 2,953 lines deleted.
- **The probe:** the worker got a backend `Response` for every push and voice route before the deletion.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - Dev team › General loads, and a sent message shows with Dev-1's reply "Sounds good.";
  - Settings › Notifications shows This device, Devices ("No devices yet."), Message previews and Test.
- **Check:** the gate passed, including the `@zilar/web` tests.
