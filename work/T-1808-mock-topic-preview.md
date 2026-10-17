---
id: T-1808
title: "Mock backend: GET /topics/:id/preview like the server (recent messages of a public non-General topic you are not in, else 404), plus a short seeded 'Ideas' thread, so the Join view shows messages in mock mode"
status: merged
milestone: M5
branch: task/T-1808-mock-topic-preview
model: auto
effort: default
depends_on: [T-1801]
estimate: 30 min
---

# T-1808: Mock topic preview

## Spec (written by Claude, do not edit)

### Why
On the emulator (mock build of main, 2026-10-17), "Dev team › Ideas" correctly shows the Join view (T-1798) with "Join Ideas". The preview says "Could not load messages", though, because the mock backend has no preview route. Web mock mode has the same gap.

### Facts (read by the lead on 2026-10-17)
- **The server route** (T-1774), contract `packages/api-contract/src/topics.ts:258-279` and endpoint `preview` at `:330`:
  - `GET /api/topics/:id/preview` returns `{ messages: [{ id, at, nick, body, payload? }] }`, oldest first, at most 30;
  - it answers 404 for a private, General or archived topic, and for a caller who is already a member.
- **The mock topic routes:** `packages/mock-backend/src/domains/topics/routes.ts` (344 lines). The sub-route switch is at `:44-57` (`join` at `:52`). `data.findTopic` is at `:40`, and `notFound(TOPIC_NOT_FOUND)` at `:42`.
- **"Ideas" is seeded** with id `t-devteam-ideas` and chat JID `t-devteam-ideas@rooms.zilar.test` (`packages/mock-backend/src/domains/topics/seed.ts:146-150`). `u-you` isn't a member (T-1801).
- **Mock messages:**
  - `data.messages` is a record keyed by chat JID (`packages/mock-backend/src/domains/messages/state.ts:9-19`);
  - seed threads live in `packages/mock-backend/src/domains/messages/threads/`, collected by `threads/index.ts`;
  - the seed shape is `MockMessageSeed { id, fromJid, minutesAgo, body?, payload? }` (`threads/shared.ts:15-27`);
  - `dev-team.ts` is the dev team's thread and the pattern to copy.

### Steps
1. **A new `packages/mock-backend/src/domains/topics/preview.ts`:** `topicPreviewRoute(data, topic)`.
   - Answer 404 (`TOPIC_NOT_FOUND`) unless the topic is public, not General, and `data.me.id` isn't in `topic.memberIds`.
   - Otherwise return the last 30 messages of `data.messages[topic.chatJid]`, oldest first. Map each to `{ id, at: ISO string, nick: the sender's display name, body: body ?? '', payload? }`.
   - Wire it at `routes.ts:52`: `if (sub === 'preview' && request.method === 'GET') return topicPreviewRoute(data, topic);`.
2. **A short "Ideas" thread:** 4 messages from two people and one AI, one of them a small `blocks` card if a builder makes that easy. Add it next to the dev team thread and register it in `threads/index.ts`.
3. **No tests** (mock data). Keep every file at most 400 lines.

### Allowed files
- `packages/mock-backend/src/domains/topics/preview.ts`
- `packages/mock-backend/src/domains/topics/routes.ts`
- `packages/mock-backend/src/domains/media/routes.ts`
- `packages/mock-backend/src/domains/messages/threads/ideas.ts`
- `packages/mock-backend/src/domains/messages/threads/index.ts`
- `packages/mock-backend/src/domains/media/routes.ts`
- `work/T-1808-mock-topic-preview.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In mock mode, opening "Ideas" shows its recent messages above the Join key on the phone and on web.
- After joining, the route answers 404 like the server.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `packages/mock-backend/src/domains/topics/preview.ts` with `topicPreviewRoute(data, topic)`. It answers 404 (`Topic not found`) for a private or General topic, matching the server; membership does not matter, so a joined member reads the same preview. Otherwise it returns the last 30 entries of `data.messages[topic.chatJid]` (oldest first) as `{ id, at, nick, body, payload? }`: `at` is the message timestamp as ISO, `body` falls back to `''`, and the payload is passed through when present. `nick` comes from the exported `senderNameFor` in `domains/media/routes.ts`, so the preview and the media tab agree on every sender's name (including the literal `You` for the viewer). Reaction, correction and retraction archive records are skipped before the last 30 are taken, so only plain messages reach the preview, like the server's `readTopicPreview`.
- Wired it in `packages/mock-backend/src/domains/topics/routes.ts` next to `join`: `if (sub === 'preview' && request.method === 'GET') return topicPreviewRoute(data, topic);`. Archived topics still answer the existing 404 from the shared lookup before the switch.
- Added `packages/mock-backend/src/domains/messages/threads/ideas.ts`: four messages for `t-devteam-ideas@rooms.zilar.test` from Ana, Luis and Dev-1, the third one carrying a small `blocks` checklist card (`Friday demo shortlist`). Registered it in `threads/index.ts` with one new import and one new map entry; no other entries were touched.
- No tests added (spec: mock data, no tests).

### Checks run
- `pnpm install`: `Done in 14.6s using pnpm v10.32.1`.
- `pnpm gate`: `gate: 5 changed file(s) against main`; `PASS install (frozen) (1.8s)`; `PASS format (1.1s)`; `PASS lint (1.0s)`; `PASS typecheck (2.8s)`; `PASS effect (0.9s)`; `SKIP tests @zilar/mock-backend (no nearby test files)`; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `images: every workspace package an app image needs is copied into its Dockerfile`; `size: every changed source file is within 400 lines`; `GATE PASS`.
- One-off runtime check with `pnpm --filter @zilar/mock-backend exec tsx -e …` (no file written): `GET /topics/t-devteam-ideas/preview` → `status 200 count 4 payload blocks at string`; the four nicks/bodies read Ana, Luis, Dev-1, Ana; `GET /topics/t-devteam-general/preview` → 404; `GET /topics/t-devteam-hiring/preview` → 404; after `POST /topics/t-devteam-ideas/join`, the preview → 404 (the pre-fix behaviour; see Round for the server-parity result).

### Notes for the lead
- The route skips reaction, correction and retraction records, but it does not merge a correction into its target the way the server does: the target keeps its original body and the correction record is dropped. No seeded topic has corrections today, so this is latent only.
- I did not open the phone or web app myself; the acceptance on both clients still needs the lead's smoke test.

### Disagreements
- None. Finding 1 was a real spec-vs-server conflict: the Spec's Step 1 and Acceptance demanded a post-join 404 that the server does not produce. The lead resolved it in the fix round in favour of the server, so the guard now drops only private and General topics.

### Round
- Findings fixed: the lead's three items, in three commits.
  1. `preview.ts` no longer 404s a member: it drops only a private or General topic, matching `apps/server/src/topics/api.ts:245-273`. The comment and this Report were corrected.
  2. The preview now uses the exported `senderNameFor` from `domains/media/routes.ts`; the copied `nickFor` is gone, and `media/routes.ts` was added to the Allowed files.
  3. `preview.ts` skips reaction, correction and retraction archive records before taking the last 30, like `readTopicPreview`.
- Tests added: none. The Spec says "No tests (mock data)" and the mock backend has no nearby test file (`SKIP tests @zilar/mock-backend`), so there was no suite to extend.
- Runtime check this round (`pnpm --filter @zilar/mock-backend exec tsx -e …`, no file written): `GET /topics/t-devteam-ideas/preview` → 200 with 4 messages, nicks Ana/Luis/Dev-1/Ana; after appending a reaction stanza to the Ideas thread, the preview is still 200 with 4 messages and no `ideas-reaction`; `GET /topics/t-devteam-general/preview` → 404; `GET /topics/t-devteam-hiring/preview` → 404 (private); `POST /topics/t-devteam-ideas/join` → 200; preview after joining → 200 with the same 4 messages.
- Gate: the first run failed `format` on `preview.ts`; `pnpm exec prettier --write packages/mock-backend/src/domains/topics/preview.ts` fixed it. The final run ended `GATE PASS`: `gate: 6 changed file(s) against main`; `PASS install (frozen) (1.1s)`; `PASS format (1.1s)`; `PASS lint (0.8s)`; `PASS typecheck (0.9s)`; `PASS effect (0.4s)`; `SKIP tests @zilar/mock-backend (no nearby test files)`; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `images: every workspace package an app image needs is copied into its Dockerfile`; `size: every changed source file is within 400 lines`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `a3f0c1cb2`, after 2 autopilot rounds and one lead round.
- **The lead's spec was wrong about members:** the server (`apps/server/src/topics/api.ts:245-273`) previews for members too. The mock now matches: 404 only for General, private or archived.
- **Mock vs server:**
  - the sender name comes from the shared `senderNameFor`;
  - reaction, correction and retraction records are skipped;
  - a 4-message "Ideas" thread is seeded.
- **The worker's runtime check:** 200 with 4 messages, 404 on General and private, 200 after joining.
- **Nit left:** the mock doesn't apply corrections or drop progress rows like the server; no seed has them today.
- **The emulator check** of the phone Join view with messages comes with the next mock smoke.
