---
id: T-0146
title: Web and server: deferred nits (sticker dir warning, leave 404, GIF host rule, AI list reload)
status: merged
milestone: M5
branch: task/T-0146-web-server-nits
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0141, T-0122]
estimate: 1 day
---

# T-0146: Web and server: deferred nits

## Spec (written by Claude, do not edit)

### Why
Review notes of T-0141 and T-0122 left small items. No schema, no migration, no dependencies. Read `AGENTS.md` first, including the security checklist, and the Review sections of `work/T-0141-web-server-followups.md` and `work/T-0122-gifs.md`.

### What to build
1. Sticker storage dir: at startup, if the resolved `STICKER_STORAGE_DIR` does not exist yet, create it when it is under the server package root or absolute and writable, and log ONE warning line with the resolved path when a relative path resolves to a directory that holds no stickers while the database has sticker rows (the "a build step moved the base" case). Document the rule in `docs/SERVER_CONFIG.md`. Tests with a temp dir.
2. Leaving a topic: the 404 swallow (real store and mock store) must only treat "the topic is gone" as success; a 404 that means "you are not a member" must show the normal error instead of navigating away. Use the error code the server returns for each case; if the server answers the same 404 for both, keep the swallow but refresh the chat list and navigate only when the topic really disappears from it. Tests for both branches.
3. Topic panel `removeAi`: if the AI list reload fails after a successful delete, remove the row locally and show a small "Could not refresh the list" line with Retry; never show a stale AI row as if the delete failed. Test. Same for `removeMember` if it has the same pattern.
4. GIF host rule at both layers: the store sanitizer's image downgrade branch must also strip the `gif-` prefix from the name of a downgraded attachment so that the render-layer URL check is not the only guard; test with `{kind:'image', name:'gif-x', mime:'video/mp4', url:'https://attacker.test/x.mp4'}`.
5. GIF tab: when the server answers 501 for GIF search (provider off), the sticker panel hides the GIFs tab instead of showing a dead-end message (probe once per session, remember the answer); test both states.
6. Do not touch schema, packages, mobile, dependencies.

### Read first
`AGENTS.md`, the two work notes above, `apps/server/src/stickers/service.ts`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/store/realStore.ts` (leave topic, sanitizer), `apps/web/src/components/StickerPanel.tsx`, `GifPanel.tsx`.

### Allowed files
`apps/server/src/stickers/**`, `apps/server/src/index.ts` (startup check only), `docs/SERVER_CONFIG.md`, `apps/web/**`, `work/T-0146-web-server-nits.md`. Not allowed: schema, drizzle, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 <touched sticker/startup test files>
pnpm --filter @zilar/web test --maxWorkers=2 <touched test files and their neighbours>
```

## Report (written by the worker)

### What I did
1. **Sticker storage dir (spec 1)**: `ensureWritableDir` (`apps/server/src/startup.ts`) now reports through an `onCreated` hook when the dir did not exist yet; the default hook logs ONE warning line with the resolved path (`STICKER_STORAGE_DIR did not exist; created <dir>`). New `warnOnEmptyStorageDir` logs ONE more warning line naming the resolved path when the directory holds no sticker files while the database has sticker rows — the certain "a build step moved the base" case. `index.ts` calls both after resolving (startup-check only, no route change). Rule documented in `docs/SERVER_CONFIG.md` (Stickers row). Tests in `startup.test.ts` use temp dirs (created/not-created, warn/quiet × rows/files).
2. **Leave 404 (spec 2)**: real store `leaveTopic` now refreshes the chat list on a 404 and swallows only when the topic really disappeared from it (`refreshTopicRow`); a "not a member" 404 rethrows so the panel shows the normal error instead of navigating away. Mock store mirrors it: row re-check first, then the archived-answer (`Topic not found`) branch which also drops the row; other 404s rethrow. The mock member DELETE now answers an archived topic with the server's missing-id 404 even when the archive predates the DELETE. Panel `leave()` comment updated (no logic change needed — the store owns the decision). Tests: real-store swallow/rethrow cases, mock-store resolve/reject cases, panel 404-stays-open case.
3. **removeAi/removeMember reload failure (spec 3)**: `reloadMembers`/`reloadAis` now throw instead of rendering the error state, so `removeAi`/`removeMember` can drop the deleted row locally and show "Could not refresh the list." with Retry (full-list line when rows remain, empty-state line when the list is now empty, `ready` kept when other rows remain so the section does not collapse into an error state). All other callers (add, visibility flip, Retry buttons, 404-path) catch and render the same error state as before. Tests for both rows.
4. **GIF host rule, store layer (spec 4)**: the image-downgrade branch now also strips the `gif-` prefix when the downgraded attachment has the GIF-video shape (`gif-` name + video mime), so either layer alone stops the auto-play; ordinary image names are untouched. Test with the exact spec shape `{kind:'image', name:'gif-x', mime:'video/mp4', url:'https://attacker.test/x.mp4'}` plus a name-preservation assertion on the existing tracker test. (Verified the new test would fail on old code: it is new coverage of changed code; the old branch kept the name by construction.)
5. **GIF tab hide on 501 (spec 5)**: `GifPanel` exports a once-per-session `probeGifsAvailability()` (caches `false` only on 501 `gifs_unavailable`; network errors stay unknown so a transient outage never permanently hides the tab). `StickerPanel` probes on open (no probe in mock/test mode — placeholders need no server), hides the GIFs tab when the answer is `false`, and falls back to Stickers at render time if the tab disappears under the active tab. `GifPanel`'s own unavailable state is kept for direct mounts. Tests: probe caches 501 / does not cache network failure; panel hides/shows via a test-only `gifsTab` prop. Note: the panel cannot be integration-tested through the app in this repo's unit-test run because `MODE=test` forces mock mode (placeholders); the probe path is covered at the unit level.
6. No schema, migration, mobile, packages, or dependency changes.

### Files changed
- Server: `apps/server/src/startup.ts`, `apps/server/src/startup.test.ts`, `apps/server/src/index.ts` (startup check only)
- Web: `store/realStore.ts` (+`realStore.test.tsx`, `realStore.topics.test.tsx`), `store/store.ts`, `mock/api.ts`, `components/TopicPanel.tsx` (+test), `components/GifPanel.tsx` (+test), `components/StickerPanel.tsx` (+test)
- Docs: `docs/SERVER_CONFIG.md`, this Report; status → review.

### Commands run and real results
- `pnpm install`: ok (~8 s).
- `pnpm format:check`: pass. `pnpm lint`: pass (two `set-state-in-effect` in my first `StickerPanel` draft fixed by deriving `visibleTab` at render time; the probe promise is created in state init, settled in one external-sync effect).
- `pnpm typecheck`: pass (10/10 tasks).
- `pnpm --filter @zilar/server test --maxWorkers=2 src/startup.test.ts src/stickers/routes.test.ts`: 2 files, 26 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2` on 11 touched files (TopicPanel, StickerPanel, GifPanel, realStore, realStore.topics, mock/api, mock/api.topics, mock/mock, Composer, GifMessage, lib/api): 11 files, 340 passed.
- Neighbours: TopicsMockE2E, Channels, JoinPage, lib/api.topics, reload: 5 files, 43 passed.
- Fail-without spot checks: the old blanket mock-store swallow resolves the new non-membership reject test (verified by reading the old code — the old branch returned on every 404); new tests are new coverage of new branches.

### Problems, deviations, open questions
- Spec item 1 says "create it when it is under the server package root or absolute and writable" — `ensureWritableDir` already creates unconditionally (recursive mkdir) and fails fast when not writable, which subsumes the condition; I kept that and added the logging rather than a new path gate. The "holds no stickers while the database has rows" check counts `stickers` rows and scans the dir for `*.webp`/`*.png` files (stored keys are `<uuid>.<ext>`); a dir with stray non-sticker files still warns, which is the safe direction.
- Spec item 2 says "use the error code the server returns for each case" — the server answers the SAME 404 `not_found` for both ("Topic not found" vs "That user is not a member of this topic" differ only in the message), so per the spec's fallback I kept the swallow but gated it on the refreshed list (real store) / archived answer (mock store, where no refetch exists). The mock `leaveTopic` matches on the message `'Topic not found'`; fragile if the mock text changes, but it is the only per-case signal available client-side.
- The pre-existing T-0141 last-seat panel test had to change shape: it assumed the blanket swallow. It is now two store-level tests (resolve on archived 404, reject on not-a-member 404) plus the kept panel navigation/reject tests.
- The `archivedTopicIds` set in the mock store only ever fills via 200-path archived rows (the mock API 404s archives instead of returning them), so in practice the `leaveTopic` 404-archive branch does the work; the set covers patch/archive flows. Flagged for the lead in case the set should go.
- Security checklist: no secrets/logs/audit touched (warn lines carry only the resolved dir path, no user data); no new routes; deletes/updates scoping unchanged; no new caps needed (all writes covered by existing limits); `warnOnEmptyStorageDir` reads one `count()` plus a dir listing — no user input; GIF probe is a read-only trending fetch, no new write, no rate-limit change.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Verdict:** approved, merged. One round, no schema.

### Findings
- Verified in the packet: the sticker-dir startup warning logs only the resolved path; leaving a topic only swallows the "topic gone" answer (real store refreshes before deciding, mock store matches the archived answer); removing an AI/member whose list reload then fails drops the row locally with a refresh line; the sanitizer's image downgrade strips the `gif-` prefix; the GIFs tab hides when search answers 501 (probed once per session).
- Lead fixes: the empty AI list now also offers Retry after a failed reload (test added); the mock 404 text the mock store matches on is one shared constant (`MOCK_TOPIC_NOT_FOUND`) instead of two literals.

### Follow-ups
- None beyond the long-standing ones (a mounted-route test for the roles load error on mobile).
