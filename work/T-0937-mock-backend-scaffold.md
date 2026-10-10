---
id: T-0937
title: "Mock backend A: scaffold @zilar/mock-backend with one JID-keyed seed (people, chats, messages), in-memory state, and the /me, /chats and /contacts routes (docs/audit/mock-plan.md task A)"
status: merged
milestone: M5
branch: task/T-0937-mock-backend-scaffold
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0937: Mock backend A, the scaffold

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-plan.md` (T-0935, merged) plans mock mode as each app's real store running against one shared fake backend. Read the whole plan first, plus "Julio's answers" at its end: a fake session, the ids may change, chats first.

This is task A of section 4. It adds code only and deletes nothing. The apps keep their old mock mode until the cutovers G and H.

### What to build
1. **A new package** `packages/mock-backend/` (`@zilar/mock-backend`, private, `"type": "module"`, exports `./src/index.ts`, scripts `typecheck` and `test: vitest run --passWithNoTests`), modelled on `packages/xmpp-core/package.json` and `packages/xmpp-core/tsconfig.json`.
   - It depends only on `@zilar/api-contract`, `@zilar/chat-core`, `@zilar/protocol` and `@zilar/xmpp-core`, with no react and no effect imports in its own code (plan section 2.2, risk R4). Type-only imports are fine.
   - The workspace already includes `packages/*` (`pnpm-workspace.yaml:3`).
2. **The layout** from plan section 2.2, with only what task A needs:
   - `src/index.ts`, the barrel;
   - `src/state.ts`: `createMockData(seed)`, in-memory tables plus mutators;
   - `src/http.ts`: `createMockHttp(data)`. It returns `(path, init?) => Promise<Response | undefined>`, where `undefined` means "not served here yet", so the app dispatcher in G and H can fall back to the old mock routes during the migration. Document that contract in the file;
   - `src/http/chats.ts`, `src/http/me.ts`, `src/http/contacts.ts`;
   - `src/data/people.ts`, `src/data/chats.ts`, `src/data/messages.ts`, `src/data/index.ts`;
   - `createMockBackend(options?)` with `http`, `data`, `reset()` and `setDelay(ms)`, as plan section 2.2 sketches. The `xmpp` member is task F2; leave it out for now.
3. **One seed, keyed by bare JIDs** (plan section 2.5). The people, the DMs, the Dev team room and its topics, the Acme channel and the AIs come from the web seed:
   - `apps/web/src/mock/ids.ts:1-30` (`dev-1@ai.zilar.test`, `dev-team@rooms.zilar.test`);
   - `apps/web/src/mock/chats.ts` (156 lines);
   - a representative part of `apps/web/src/mock/messages.ts` (1,148 lines): enough messages per chat to scroll, and **not** all of them;
   - mobile's copy in `apps/mobile/src/mock/chats.ts` and `messages.ts`, as a cross-check.

   The seed produces **API response shapes**: `GET /chats` returns `{ chats: ChatEntry[] }`, matching `ChatEntry` in `packages/api-contract/src/chats.ts`, so each app's real row mapper (`summariesFor` in `packages/client-core/src/store/chat-rows.ts`) builds its rows. Messages are kept for the fake XMPP (F2) and are not served over HTTP.
4. **The routes:** `GET /me`, `PATCH /me` (the name), `GET /chats` and `GET /contacts`, with the same bodies as web's `mockRequest` for those paths (`apps/web/src/mock/api.ts:2196`, `:2317`, `:3017`), and a default delay of 150 ms (`setDelay`). Answer the paths the way the apps call them; check `apps/web/src/lib/api.ts` (`request`) and `apps/mobile/src/lib/chat-api.ts` for the exact prefix (`/api/...` or not).
5. **Keep every file under 400 lines** (Julio's rule).
6. **No tests** (Julio's minimal-test rule; mock code is not crucial). Instead, prove the routes in the Report: a throwaway script in your scratch folder, not committed, that calls `createMockBackend().http('/api/chats')` (or the right path) and decodes the body with the contract's `ChatEntry` schema. Paste its output.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` (all of it), `packages/xmpp-core/package.json`, `packages/xmpp-core/tsconfig.json`, `packages/api-contract/src/chats.ts`, `apps/web/src/mock/ids.ts`, `apps/web/src/mock/chats.ts`, and `apps/web/src/mock/api.ts:2179-2330` and `:3017-3053`.

### Allowed files
`packages/mock-backend/**`, `pnpm-lock.yaml`, `work/T-0937-mock-backend-scaffold.md`.

### Checks
```bash
pnpm install
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- No app file changes.
- Every new file is under 400 lines.
- The Report shows the script output: a `GET /chats` body that decodes as `ChatEntry[]`, plus the `/me` and `/contacts` bodies.
- The Report gives the seed's chat, person and message counts.

---

## Report (written by the worker when done)

**Status: done (task A). Every check passes; nothing outside the Allowed files.**

### What I built

New private workspace package `@zilar/mock-backend`, modelled on
`packages/xmpp-core` (`"type": "module"`, `exports ./src/index.ts`, scripts
`typecheck` + `test: vitest run --passWithNoTests`), depending only on
`@zilar/api-contract`, `@zilar/chat-core`, `@zilar/protocol` and
`@zilar/xmpp-core`. Its own code imports no React and no Effect (api-contract is
imported with `import type` only), so R4/Metro is not an issue.

Files added (all under 400 lines):

- `packages/mock-backend/package.json` (19), `tsconfig.json` (8, extends
  `../../tsconfig.base.json`, `lib: ["ES2023", "DOM"]`, `types: []`).
- `src/index.ts` (54): the barrel plus `createMockBackend(options?)` with
  `http`, `data`, `reset()` and `setDelay(ms)`.
- `src/state.ts` (27): `createMockData(seed)` — the in-memory tables and the
  only mutator task A needs, `renameMe(name)`.
- `src/http.ts` (46): `createMockHttp(data, getDelayMs?)`, default delay 150 ms,
  the `Promise<Response | undefined>` contract documented at the top.
- `src/http/{shared,me,chats,contacts}.ts` (13–54).
- `src/data/{people,chats,messages,index}.ts` (49–110).

Routes: `GET /me`, `PATCH /me` (name, trimmed), `GET /chats`, `GET /contacts`,
with web's mock bodies. `parseRequest` strips a leading `/api`, so both the
contract client's `/api/chats` (web `api-client.ts:25`, mobile
`chat-api.ts:413`) and the hand-written `/chats` (web `api.ts:146`) match.
Unknown paths answer `undefined` (the G/H dispatcher falls back to the old mock
routes).

**Seed, keyed by bare JIDs:** humans use `<name>@zilar.test` (mobile's contact
seed, `apps/mobile/src/mock/contacts.ts:5`); AIs/rooms follow
`apps/web/src/mock/ids.ts:21-30` (`dev-1@ai.zilar.test`,
`dev-team@rooms.zilar.test`). One `ChatEntry[]` (12 entries) reproduces web's
`mock/chats.ts` list (Ana, Acme channel, Dev team, Viernes, Dev AI, Marta,
Familia, QA squad, Luis, Marketing AI, Gym buddies, Product). Messages are a
representative subset of web's `mock/messages.ts`, ~2–7 per chat, text only,
with timestamps relative to `now` (`minutesAgo`); they are not served over HTTP
and exist for the F2 fake XMPP.

**Counts:** 12 chats, 8 people (5 humans + 3 AIs), 8 contacts (every person),
47 messages across 12 threads.

### Commands and real results

- `pnpm install` — "Scope: all 15 workspace projects" (was 14; the new package
  linked), "Packages: +1", "Done in 3s". `pnpm-lock.yaml` updated.
- Throwaway proof (scratch file, not committed; `tsx`, decoding with the
  contract's `ChatEntry`):

  ```
  GET /api/chats -> decodes as ChatEntry[]: 12 entries
    kinds: ana@zilar.test:dm, acme@rooms.zilar.test:group, dev-team@rooms.zilar.test:group, viernes@rooms.zilar.test:group, dev-1@ai.zilar.test:dm, marta@zilar.test:dm, familia@rooms.zilar.test:group, qa@rooms.zilar.test:group, luis@zilar.test:dm, marketing@ai.zilar.test:dm, gym@rooms.zilar.test:group, product@rooms.zilar.test:group
  GET /chats (no /api prefix) also served: 12 entries
  GET /api/me -> {"id":"u-you","email":"you@zilar.test","name":"You","image":null,"handle":null,"jid":"you@zilar.test"}
  PATCH /api/me {name:"  Julio  "} -> {"id":"u-you","email":"you@zilar.test","name":"Julio","image":null,"handle":null,"jid":"you@zilar.test"}
  GET /api/contacts -> [{"userId":"u-ana","name":"Ana","jid":"ana@zilar.test"},{"userId":"u-luis","name":"Luis","jid":"luis@zilar.test"},{"userId":"u-marta","name":"Marta","jid":"marta@zilar.test"},{"userId":"u-marco","name":"Marco","jid":"marco@zilar.test"},{"userId":"u-sofia","name":"Sofía","jid":"sofia@zilar.test"},{"userId":"ai-dev-1","name":"Dev-1","jid":"dev-1@ai.zilar.test"},{"userId":"ai-qa-1","name":"QA-1","jid":"qa-1@ai.zilar.test"},{"userId":"ai-marketing","name":"Marketing AI","jid":"marketing@ai.zilar.test"}]
  GET /api/nope -> undefined? true
  seed counts: 12 chats, 8 contacts, 47 messages, 8 people
  exit is a success: true | first entry: {"kind":"dm","chatJid":"ana@zilar.test","title":"Ana","userId":"u-ana","isAi":false}
  ```

- `pnpm gate` — summary lines:

  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  The `typecheck` step is the task's `pnpm --filter @zilar/mock-backend
  typecheck` (turbo `--affected` against `main`); per the harness instruction I
  did not run that command on its own. No tests were written (spec: "No
  tests").

### Deviations / notes for the reviewer

- **`effect-plain` markers.** The package is effect-free by design (plan §2.2),
  so `src/http.ts` (H1/H3: `async`/`await`/`new Promise`/`setTimeout`) and
  `src/http/shared.ts` (W4/W6: `try`/`catch`, `JSON.parse`) would have tripped
  the Effect ratchet as new "needs-effect" files. I added the sanctioned
  `// effect-plain: …` first-line marker to those two files, like
  `apps/web/src/store/mockStore.ts:1`. No other file hit a signal.
- **Topics are not seeded here.** The spec prose lists "the Dev team room and
  its topics", but the plan's task-A file list is `data/{people,chats,messages}`
  and the topics seed belongs to task D. The Dev-team chat entry carries no
  `topics` array yet, so the row mapper keeps its single legacy row
  (`chat-rows.ts:166-168`); task D adds the topic rows.
- **Messages are text only and a subset** (no voice/image/card), as "a
  representative part … not all of them". `MockMessage` uses
  `senderJid`/`createdAt` for F2.
- **`createMockBackend` lives in `src/index.ts`** (the barrel), since the task
  listed no separate backend file; `createMockHttp` takes an optional
  `getDelayMs` accessor so `setDelay(ms)` works on a live backend.
- The seed keeps web's group roles/member counts from `mock/groups.ts`
  (e.g. Dev team owner/6, QA squad admin/4, Acme public channel with the `acme`
  handle).

No blockers, no open questions.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 4 nits.**
- **The package:** `@zilar/mock-backend`, 532 lines in 12 files (the largest is 110). Its seed is keyed by JID: 12 chats from web's list, plus people and a text-only subset of messages.
- **Routes:** `GET /me`, `PATCH /me`, `GET /chats` and `GET /contacts`. `http` returns `undefined` for routes not served yet, which is the migration fallback.
- **No app file changed.**
- **Nits for the next mock tasks:**
  - group entries have no `topics` yet, which task D adds;
  - the delay also runs for unserved routes;
  - the module-level seed;
  - `PATCH /me` details.
- **Check:** the gate passed.
