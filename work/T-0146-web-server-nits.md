---
id: T-0146
title: Web and server: deferred nits (sticker dir warning, leave 404, GIF host rule, AI list reload)
status: todo
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
pnpm --filter @galena/server test --maxWorkers=2 <touched sticker/startup test files>
pnpm --filter @galena/web test --maxWorkers=2 <touched test files and their neighbours>
```

## Report (written by the worker)

## Review (written by Claude)
