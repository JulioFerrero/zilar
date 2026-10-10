---
id: T-1045
title: "Mock backend C2: chat-folders, backgrounds and media gallery domains in @zilar/mock-backend"
status: merged
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
1. **New domains**, each a folder under `packages/mock-backend/src/domains/` plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`.
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
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts`, `packages/mock-backend/src/domains/routines/` and `packages/mock-backend/src/domains/messages/`, and the web mock ranges and contract files above.

### Allowed files
`packages/mock-backend/**`, `work/T-1045-mock-backend-folders-media.md`.

T-1044 (prefs and pins) and T-1046 (stickers and GIFs) work in the same package in parallel. Touch only your own domain folders and your lines in `packages/mock-backend/src/domains/index.ts`.

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

### What I did
Added three domains to `@zilar/mock-backend`, each a folder under
`src/domains/` plus one alphabetical line in `src/domains/index.ts`:

- **`chat-folders`** (`seed/state/routes/index`): `GET`/`POST /chat-folders`,
  `PUT /chat-folders/order`, `PATCH /chat-folders/:id`,
  `DELETE /chat-folders/:id`, with the same bodies and mutations as web's mock
  (`apps/web/src/mock/api.ts:2736`). Seeded with Personal (dm) and AIs (ai).
  Caps at 20 folders (`409 folder_limit`), requires the order list to name every
  folder exactly once (`400 invalid_request`), and answers `{ folder }` (201 on
  create), `{ folders }` on order and `{ deleted: true }` on delete.
- **`backgrounds`** (`seed/state/routes/index`): `POST`/`GET /backgrounds`,
  `GET /backgrounds/:id`, `DELETE /backgrounds/:id`. POST takes a raw body the
  mock ignores and answers a `data:image/svg+xml` URL (plan §3, "Not worth
  faking"), capped at 20 (`409 too_many_backgrounds`); `GET /backgrounds/:id`
  serves those bytes with the mime type so web's wallpaper URL
  (`/api/backgrounds/:id`, `apps/web/src/lib/chatBackground.ts:89`) resolves.
- **`media`** (`routes/links/index`): `GET /media?chat&type&before&limit`. It
  rebuilds rows from the combined `MockData` messages table (like
  `domains/routines/routes.ts:10`), maps the contract tabs to server kinds
  (`media`→image+gif, `files`→file, `links`→link, `voice`→voice), extracts body
  links with the server's rule, sorts newest first, pages with `limit`/`before`
  and returns `{ items, next }`. Unknown chat answers `404`; a bad query `400`.

`src/state.ts` gained the two slices (`chatFolders`/`nextFolderSequence`,
`backgrounds`/`nextBackgroundSequence`); no messages file was edited (the media
route only reads `data.messages`).

### Files changed
- `packages/mock-backend/src/domains/chat-folders/{seed,state,routes,index}.ts`
- `packages/mock-backend/src/domains/backgrounds/{seed,state,routes,index}.ts`
- `packages/mock-backend/src/domains/media/{routes,links,index}.ts`
- `packages/mock-backend/src/domains/index.ts` (3 imports + 3 array lines)
- `packages/mock-backend/src/state.ts` (2 type imports + 4 `MockData` fields)
- `work/T-1045-mock-backend-folders-media.md`

Every new file is under 400 lines (largest: `media/routes.ts` 153,
`chat-folders/routes.ts` 150).

### Commands and results
- `pnpm --filter @zilar/mock-backend typecheck` → clean (no output).
- `pnpm gate` → `GATE PASS`. Summary lines:
  - `PASS install (frozen) (1.3s)`
  - `PASS format (1.1s)`
  - `PASS lint (0.6s)`
  - `PASS typecheck (2.0s)`
  - `PASS effect (0.6s)`
  - `SKIP tests @zilar/mock-backend (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Proof (throwaway script, deleted before commit)
Ran a temporary vitest file against `createMockBackend({ delayMs: 0 })`,
decoding every response with its contract schema
(`Schema.decodeUnknownExit` over `ChatFolderList`, `ChatFolderResult`,
`ChatFolderOrder`, `ChatFolderDeleted`, `BackgroundImage`, `BackgroundList`,
`MediaPage`). 3 tests passed; output:

- **Folders** — list decoded to `[Personal/user/0, AIs/bot/1]`; POST created
  `{id: folder-mock-3, name: "Work", icon: briefcase, includeTypes: [group],
  position: 2}`; PUT order `[Work@0, AIs@1, Personal@2]`; PATCH returned
  `{name: "Work stuff", excludeMuted: true}`; DELETE returned `{deleted: true}`.
- **Backgrounds** — list started `[]`; POST (raw body) returned
  `{id: bg-mock-1, url: data:image/svg+xml,…, width: 1920, height: 1080}`;
  `GET /backgrounds/bg-mock-1` returned 200 `image/svg+xml` (305 bytes);
  DELETE returned 204 and the list was empty again.
- **Media** — Ana DM (`ana@zilar.test`):
  - `type=media` → `[{kind: image, name: "Stage.png"}, {kind: image, name: "Tickets.png"}]`
  - `type=files` → `[{kind: file, name: "tickets.pdf", mime: application/pdf}]`
  - `type=voice` → one `{kind: voice, mime: audio/m4a}`
  - `type=links` → `[]` (the Ana seed has no URL in a message body)
  - Dev AI DM (`ai-dev-1@zilar.test`) `type=links` →
    `[{kind: link, linkUrl: "https://example.com/reviews/42"}]`, proving link
    extraction from a seed message body.

### Problems and deviations
- The Ana DM's Links tab is empty: no seed message body in
  `threads/ana.ts` contains an `http(s)` URL (the `tickets.pdf` URL is an
  attachment `url`, which the server's extractor does not treat as a link). I
  proved the Links tab on the Dev AI DM, whose `threads/dev-ai.ts:40` message
  body carries `https://example.com/reviews/42`.
- `backgrounds` DELETE does not clear a chat pref that referenced the image
  (web's `mock/api.ts:2718` does, and the default background too). The prefs and
  default-background domains are T-1044's work in the same package and are not
  present here, so cross-domain clearing is out of this task's scope.
- Added the `// effect-plain:` marker to `media/links.ts` (its try/catch mirrors
  the server's URL extractor); the first gate run failed the `effect` ratchet
  without it.

### Open questions
None.

### Round (fix round)

- **Finding 1 (should-fix) fixed.** `deleteFolder` now returns
  `notFound('Folder not found')` (404 `{ error: { code: 'not_found', … } }`) when
  no folder matches the id, mirroring `patchFolder` two functions above and web's
  mock; it no longer answers 200 `{ deleted: true }` for an unknown id.
- **Test added.** `packages/mock-backend/src/domains/chat-folders/routes.test.ts`
  (2 cases): an unknown-id delete 404s and leaves the table unchanged; a known-id
  delete returns `{ deleted: true }` and reindexes the rest. This round's brief
  requires a test per behaviour fix, so a committed test was added even though the
  Spec's proof method was a throwaway script; the file is inside the Allowed
  files. Ran with
  `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/chat-folders/routes.test.ts`
  → 2 passed.
- **Nits 2–7 left untouched** (not must-/should-fix, and none sits in a line this
  round changes).
- **Gate:** `pnpm gate` → `GATE PASS` (`PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mock-backend`,
  `scope: every changed file is inside the Allowed files`).

### Round 2 (fix round)

- **Finding 1 (should-fix) fixed.** `deleteBackground` now checks the id first
  and returns `notFound('Background not found')` (404 `{ error: { code:
  'not_found', … } }`) when no background matches, mirroring
  `apps/server/src/backgrounds/api.ts:150-152` and the folder fix from the
  previous round. A known id still answers `204`. The mock deliberately diverges
  from web's mock (which 204s) toward the server, the same trade the folder fix
  made.
- **Test added.** `packages/mock-backend/src/domains/backgrounds/routes.test.ts`
  (2 cases): an unknown-id delete 404s and leaves the list empty; a POST then
  DELETE of the created id returns 204 and empties the list. Ran with
  `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/backgrounds/routes.test.ts`
  → 2 passed.
- **Finding 2 (nit) left untouched.** It sits on the `decodeURIComponent(first)`
  line in `handleBackgrounds`/`handleChatFolders`, not on a line this round
  changes, and the finding itself says "fix centrally or not at all".
- **Gate:** `pnpm gate` → `GATE PASS` (`PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mock-backend`,
  `scope: every changed file is inside the Allowed files`).

### Fix round 3 (lead)

- **Rebase resolved.** Rebasing onto `main` conflicted only on
  `packages/mock-backend/src/domains/index.ts` (T-1046 added `stickers`/`gifs`).
  Resolved by keeping both sides in alphabetical order: imports and array lines
  for `backgrounds`, `chat-folders`, `chat-prefs`, `chats`, plus main's
  `gifs`/`stickers`. `state.ts` auto-merged cleanly (main's sticker fields kept
  alongside this task's fields). `git rebase --continue` finished with no further
  conflicts; no `--abort`/`--skip`.
- **Tests dropped.** Both fix-round tests were deleted per the Spec's "no tests"
  and Julio's rule (tests only for auth and keys, permissions and money, the
  message pipeline): `packages/mock-backend/src/domains/chat-folders/routes.test.ts`
  and `packages/mock-backend/src/domains/backgrounds/routes.test.ts`. Committed as
  "T-1045: drop the mock-backend tests (no tests for mock code)".
- **404 fixes kept.** The unknown-folder delete 404 (`chat-folders`) and the
  unknown-background delete 404 (`backgrounds`) are unchanged.
- **Gate:** `pnpm gate` → `GATE PASS` (`PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/mock-backend
  (no nearby test files)`, `scope: every changed file is inside the Allowed
  files`).

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved after two automatic rounds and one lead round. The pre-review is clean, with 3 nits and 1 follow-up.**
- **The change:** new `chat-folders`, `backgrounds` and `media` domains in `@zilar/mock-backend`. Only that package changed.
- **The rounds:**
  - **the automatic rounds:** deleting an unknown folder and deleting an unknown background now answer 404, as the server does;
  - **the lead's round:** the worker resolved the rebase conflict with T-1046 in `domains/index.ts`. The registry keeps all of stickers, gifs, backgrounds, chat-folders and media, in alphabetical order. The worker also deleted the two `routes.test.ts` files the earlier rounds had added, because Julio's rule allows no tests for mock code.
- **The lead's mobile mock phone smoke:**
  - in Ana's chat, Media, files and links opens; Media lists Stage.png and Tickets.png, Files lists tickets.pdf (2.3 MB), and Links reads "No links yet" (the seed puts its links in the Dev AI DM);
  - on the Chats tab, the folder chips show All chats, Personal and AIs, and AIs filters the list to Dev AI and Marketing AI.
- **Check:** the gate passed.
