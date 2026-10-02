---
id: T-0121
title: Sticker pack creator (web): make packs from images, edit, share, favorites
status: merged
milestone: M5
branch: task/T-0121-sticker-creator
model: meta/muse-spark-1.3-contributor
depends_on: [T-0120]
estimate: 2 days
---

# T-0121: Making sticker packs

## Spec (written by Claude, do not edit)

### Why
D27: stickers are **created by users**. T-0120 stores and sends stickers; this task lets people make packs in the app the way Telegram's sticker bot does, but in the UI: pick images, get them ready, name the pack, share it.

### What to build (web only)
1. **Entry points:** the sticker panel's "+" tab, a "Manage stickers" link in the panel, and Settings → Stickers (new page `routes/StickersPage.tsx`).
2. **Stickers page:** my packs (drag to reorder in the panel order, remove from my panel, delete my own pack with a confirmation that says "Stickers already sent may stop loading"), packs I added, **Discover** (search `GET /api/sticker-packs/discover`, Add / Remove), and a **Create pack** button.
3. **Pack editor** (new `PackEditor.tsx`): title, visibility (Private / Shared on this server, with plain help text), a drop zone and file picker accepting several images at once (PNG, JPEG, WebP, GIF-first-frame as still). **Client-side preparation** for each file: decode with `createImageBitmap`, fit inside 512 × 512 keeping the ratio, draw to a canvas, encode as WebP (quality 0.92; PNG fallback if the browser cannot encode WebP), enforce ≤ 512 KiB (lower the quality in steps, then fail that file with a message), show a checkerboard preview with the result size. Per sticker: an emoji field (single emoji), remove, reorder by drag or Up/Down buttons (keyboard accessible). Upload sequentially with progress and per-file retry through `POST /api/sticker-packs/:id/stickers`; creating the pack first, then uploading. Animated inputs are out of scope (stills only).
4. **Favorites:** a star on any sticker in the panel adds it to a **Favorites** tab (stored per user on the server as a small list: new table `sticker_favorites` with pk `(user_id, sticker_id)`, max 200; `GET/PUT/DELETE /api/sticker-favorites` in `apps/server/src/stickers/`, migration via `db:generate`). Recent stays local (T-0120).
5. **Mock mode** support for the whole page and the editor (in-memory).

### Rules
- Never trust the client-side conversion on the server (T-0120 validates again).
- Accessibility: real buttons, labels, drag has a keyboard alternative, reduced motion respected.
- Image budget for your session: ~20 screenshots.

### Read first
- `AGENTS.md`; `work/T-0120-stickers.md` (Spec, Report, Review) and its code; `docs/design/ui-style.md`; the mockup's sticker panel
- `apps/web/src/components/{Composer,ui/*}.tsx`, `routes/{AppRoutes,ConnectionsPage}.tsx` (page pattern), `lib/api.ts`, `mock/*`

### Allowed files
- `apps/web/src/**` (routes, components, lib, mock, tests)
- `apps/server/src/stickers/**` (favorites only), `db/schema.ts` + migration, `app.ts`, `authz-sweep.test.ts`
- `work/T-0121-sticker-creator.md`

**Not allowed:** protocol changes, mobile, dependencies (use browser canvas APIs).

### Tests
- Image preparation as a pure module with injectable decode/encode fakes (fit math, quality steps, size cap, failure); editor state machine (add/remove/reorder/upload progress/retry); page states; favorites API + UI; mock mode. Server: favorites limits, ownership, 401, sweep.

### Acceptance criteria
- [ ] A user can make a pack from a handful of photos, share it on the server, and another user can add it and send from it.
- [ ] Every file is converted to ≤ 512 px and ≤ 512 KiB before upload; failures are per file and retryable.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2
pnpm --filter @zilar/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Animated sticker creation, background removal, mobile UI, the Telegram importer (T-0123), usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Server favorites: `sticker_favorites` table in `db/schema.ts` (pk `(user_id, sticker_id)`, both FKs cascade; **no migration committed** — per lead instruction the schema lands first, `db:generate` runs after rebase). `listFavorites` / `addFavorite` / `removeFavorite` in `stickers/service.ts` (200-cap inside a per-user advisory-lock transaction, idempotent star/unstar, unknown id = same 404 as missing, no audit like the panel links) and `GET/PUT/DELETE /api/sticker-favorites` in `stickers/routes.ts` (session first; DELETE takes `?sticker_id=` so the path stays literal). `app.ts` needed no change (same mounted router); the 401 sweep covers the 3 routes automatically.
- Web prep module `lib/sticker-images.ts`: pure `prepareStickerImage` with injectable decode/encode (default `createImageBitmap` — GIF decodes to first frame — + canvas), fit inside 512×512, WebP q0.92 stepping down [0.92,0.8,0.7,0.6,0.5], PNG fallback, 512 KiB cap, per-file `PrepError`.
- `components/PackEditor.tsx`: title (1–60), Private/Shared radios with plain help text, drop zone + multi file picker, checkerboard previews with result size, single-emoji field for new stickers (read-only for existing — the server has no emoji edit), remove, drag + Up/Down reorder, sequential upload with progress and per-file retry. Create mode creates the pack first; edit mode (`initialStickers`) PATCHes title/visibility, DELETEs removals (landed deletes leave the retry queue), uploads new files, then PATCHes the full order. Only finishes (`onDone`) when everything landed.
- `routes/StickersPage.tsx` (Settings → Stickers, `AiPageShell` frame): my packs (Up/Down panel reorder via remove+re-add sequence, remove-from-panel, share/make-private, Edit, Delete with “Stickers already sent may stop loading” confirm), added packs, Discover with search + Add/Remove, favorites grid with unstar, Create pack button.
- Panel (`StickerPanel.tsx`): ★ tab (Favorites), per-sticker star toggle (optimistic, rollback + alert on failure), “+” tab (`onCreate`), “Manage stickers” footer (`onManage`). Wired in `Composer.tsx`/`ChatView.tsx` (callback prop, no router dep in Composer) → `/settings/stickers`; “Stickers” menu item in `ChatList.tsx`; route in `AppRoutes.tsx`.
- `lib/api.ts`: `patchStickerPack`, `deleteStickerPack`, `deletePackSticker`, `uploadStickerFile` (raw bytes + `x-emoji`, mock-aware), `list/add/removeStickerFavorite`.
- Mock mode: full in-memory packs/panel/discover/favorites/upload endpoints in `mock/api.ts` (demo packs seeded, 200-cap, idempotent star, `?q=` search). Fixed the deferred T-0120 item — demo stickers are sendable now: demo ids are real UUIDs, `mockSendableStickerUrl` swaps display `data:` art for a relative `/api/stickers/<uuid>/file` URL before validation, `resolveMockStickerUrl` maps it back for rendering (`StickerMessage.tsx` + mock store); real-mode paths byte-identical.
- Tests: server `stickers/favorites.test.ts` (9: star/list/unstar, idempotency, 404/400 shapes, per-user isolation, stranger-can-star, cascade on sticker delete, 200-cap over two packs, 401 on all three routes; creates the table with local DDL + TODO until the migration lands). Web: `sticker-images.test.ts` (11), `PackEditor.test.tsx` (7), `StickersPage.test.tsx` (6), panel favorites extensions (5: star/unstar/empty/+/Manage/navigation), `api.test.ts` (+4), `mock.test.ts` (+2, incl. real demo-pack protocol round-trip replacing the hand-built assertion).

### Files changed
- `apps/server/src/db/schema.ts` (+`stickerFavorites`), `apps/server/src/stickers/service.ts` (+favorites service), `apps/server/src/stickers/routes.ts` (+3 routes), `apps/server/src/stickers/favorites.test.ts` (new)
- `apps/server/drizzle/0032_nappy_ender_wiggin.sql` + snapshot + journal (generated post-rebase: `sticker_favorites` only)
- `apps/web/src/lib/sticker-images.ts` + test (new), `apps/web/src/components/PackEditor.tsx` + test (new), `apps/web/src/routes/StickersPage.tsx` + test (new)
- `apps/web/src/lib/api.ts`, `apps/web/src/components/StickerPanel.tsx` (+test), `apps/web/src/components/Composer.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/StickerMessage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/index.css` (`.checkerboard`), `apps/web/src/mock/api.ts`, `apps/web/src/mock/helpers.ts`, `apps/web/src/mock/index.ts`, `apps/web/src/mock/mock.test.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/store/store.ts`
- `work/T-0121-sticker-creator.md` (status + this report)

### Commands run and real results
- `pnpm install`: ok (11.5s)
- `pnpm exec prettier --check` (all touched files): pass
- `pnpm lint` (oxlint): pass, no findings (re-run after last edit)
- `pnpm --filter @zilar/server typecheck`: pass; `pnpm --filter @zilar/web typecheck`: pass
- `pnpm --filter @zilar/server test --maxWorkers=2 src/stickers/favorites.test.ts src/stickers/routes.test.ts src/authz-sweep.test.ts`: 3 files, 36 passed (favorites 11, routes 20, sweep 5; sweep printout shows the 4 new routes — 3 favorites + `PUT /api/sticker-panel` — at 401)
- `pnpm --filter @zilar/web test --maxWorkers=2` (12 files: sticker-images, stickers, sticker-url, api, PackEditor, StickersPage, StickerPanel, mock, Composer, ChatList, ChatView, realStore): 292 passed (round 2: PackEditor 10 incl. the pack-reuse test)
- Post-rebase: `pnpm --filter @zilar/server db:generate` produced `drizzle/0032_nappy_ender_wiggin.sql` with ONLY the `sticker_favorites` table + 2 FKs + index (verified by reading the file); 0031 untouched. Removed the schema NOTE comment and the test-local DDL (+ unused `sql` import); favorites tests pass against the real migration.
- Full package suites and `pnpm build` NOT run (per lead instruction — the lead runs full suites once per batch)
- One neighbor regression caught and fixed: `useNavigate` in Composer broke a router-less Composer test → moved navigation to a callback prop from ChatView (verified failing-before/passing-after)

### Problems, deviations from the spec, open questions
- Panel reorder is now atomic: new `PUT /api/sticker-panel` (`reorderPanelPacks`, one transaction under the caller's panel lock, exact-permutation validated, user-scoped) replaces the remove-all-then-re-add sequence; the page does one call, restores UI order and reports on failure. Mock mirrors the endpoint (incl. 400 on non-permutation).
- DELETE favorites uses `?sticker_id=` query (path stays exactly `/api/sticker-favorites`, no probale suffix).
- Existing-sticker emoji is read-only in the editor (server PATCH supports order/title/visibility only, no per-sticker emoji edit). Reorder of existing stickers persists via the order patch on save.
- Mock uploads mint rows with 200×200 dims (bytes are not stored in mock mode); editor previews stay local via object URLs.
- `takeSingleEmoji` uses `Intl.Segmenter` (grapheme) with an `Array.from` fallback, so ZWJ/flag sequences stay whole.
- No screenshots taken (image budget left untouched; rendering covered by component tests).
- No `any`, no `@ts-ignore`, no lint/ts disables; prettier + lint re-run after last edit.

### Review fixes (PREREVIEW.md, second round)
1. **Must — bitmap closed before draw**: `decodeWithBitmap` no longer closes; `PrepDeps` gains `release` (default closes the bitmap), called in a `finally` after the final encode. Tests: default-deps round-trip with a fake bitmap that throws on post-close draw (passes), plus a direct regression test proving close-in-decode yields `encode_failed`.
2. **Must — raw emoji in `x-emoji` header throws in real fetch**: client sends `encodeURIComponent(emoji)`; server decodes (length-capped, `%`-gated) and the existing service validation caps at 8 chars. Tests: `api.test.ts` asserts the encoded header + real-`Headers` construction; server `routes.test.ts` builds a real `Request`/`Headers` pair and asserts the stored emoji, plus a malformed-escape 400.
3. **Re-star at 200 cap**: existence check inside the tx before the count; new test re-stars at cap → 200.
4. **Editor mid-save edits**: title/visibility/dropzone/file-picker/emoji/move/remove/retry all disabled while `busy`; drag reorder guarded too; the order PATCH reads `itemsRef` (post-save list) instead of the click-time snapshot. New test holds a save in flight and asserts every control frozen.
5. **Atomic panel reorder**: new endpoint per above (preferred option); web + mock + server tests.
6. **Nits**: mount effect calls `load()` (via an async wrapper — a direct call trips `react/set-state-in-effect`); `takeSingleEmoji` uses `Intl.Segmenter`.
7. **Round 2 — create-mode retry minted a second pack**: the pack id from the first create is kept in `createdPackIdRef` and reused on later Save clicks (title patch/deletes stay edit-mode-only, so a resume only uploads). New test: partial failure → Retry → Save asserts one `createStickerPack` call, all uploads into `pack-1`, `onDone('pack-1')`; verified it fails without the fix and passes with it.
8. **Post-rebase — migration 0032 + resume title/visibility**: chose PATCH-on-resume (remember creation title/visibility in refs, PATCH when changed) over locking the fields, so a rename between retries is honored. The resume test now also renames and asserts the PATCH call. Report updated; no test-local DDL remains.
9. **Round 3 — mock UUIDs**: user-created mock packs/stickers mint `crypto.randomUUID()` (favorites path is id-shape-agnostic, keeps working); the pack round-trip test now builds the payload through the real `StickerSchema` and asserts validity.
10. **Round 3 — `listFavorites` N+1**: one `inArray` query + in-memory order restore (per-user scoping unchanged: links are the caller's own rows). New test stars the full 200 in order, asserts exact order, and asserts the list call uses ≤ 10 queries (measured 4; the old loop needed 200+).
11. **Round 3 nit — mock trailing slash**: bare `PUT /sticker-panel/` (and empty-id add) 404s like the server instead of silent `{ ok: true }`; reorder branch keeps 400-on-bad-order. Test added.
12. **Round 3 audit of the two earlier should-fixes**: (a) error rows silently dropped — NOT reproducible: prep errors append alert rows, upload failures map in place, `save()` never filters rows out, `onDone` gated on zero failures, removal only via explicit per-row ✕ (disabled while busy). (b) early object-URL revoke — REAL and fixed: the `previewUrlsRef` effect revoked the full live list on every `items` change (adding a 2nd image or any status flip revoked displayed previews). Replaced with a `BlobPreview` node that creates its URL in a `useState` initializer (no set-state-in-effect) and revokes only on its own unmount — StrictMode-safe, upload path untouched (sends `blob`). New test: two previews live with zero revokes; removing one revokes exactly its URL.
13. **Round 4 — edit-mode re-save skips failed files**: Save is now disabled while any error row exists (both modes; the `save()` guard re-checks defensively), so a failed file can never be silently skipped with a success close — Retry or Remove first. New test asserts disabled Save + no upload + no `onDone`, then Retry → Save finishes.
14. **Round 4 — just-uploaded removal dead-ends the order PATCH**: `removeItem` queues a server delete whenever `stickerId` is defined (not only blob-less rows); the delete-flush is shared by edit and create-resume paths (create no longer orphans in-session uploads either). New test: A lands, B fails, remove A, Retry B, Save → A deleted, order PATCH `[B]`, `onDone`, no 400.
15. **Round 4 — panel cap aligned at 200**: `addPanelPack` enforces `STICKER_PANEL_MAX = 200` atomically under the existing per-user lock (`400 panel_full`, idempotent re-add still 200), and `reorderPanelBodySchema` uses the same constant; mock mirrors the cap. New server test arranges 199 rows, asserts 200th lands / 201st `panel_full` / re-add 200.

### Blocked / needs a decision
- None. After rebase: run `pnpm --filter @zilar/server db:generate` (expect 0032+), then delete the local DDL helper at the top of `favorites.test.ts` (`TODO(T-0121)` marks it).

---

## Review (written by Claude)

**Verdict:** approved, merged after five rounds (migration 0032, `sticker_favorites`). Pre-review packets read at every round.

### Findings
- Fixed across rounds and verified: the real-browser bitmap close bug (every prep failed), emoji header encoding (real `Headers` tests), idempotent re-star at the 200 cap, atomic panel reorder endpoint and a 200-pack panel cap, favorites list in one query, editor frozen while saving, create-mode retry reuses the created pack (and patches a renamed title), failed uploads block Save, just-uploaded stickers removed in-session are deleted.
- Lead work at merge: squashed the six WIP commits and rebased onto main by hand (T-0122 and T-0141 had touched the same files). T-0141 had already made demo stickers sendable in mock mode (relative URLs plus a mock file route), so T-0121's own send-time URL swap was dropped in favour of that; the Composer/StickerPanel props from both tasks (GIF pick, manage, create) are kept.
- Lead nits fixed: a malformed `x-emoji` escape now answers "The emoji header is not valid"; the favorites list has a total order (`addedAt`, then `stickerId`).
- Deferred: `patchPack` order check accepts duplicate ids (the editor cannot produce them); mock reorder has no 200 cap; `addFavorite` reads the sticker row outside its transaction (a concurrent delete answers a misleading 503).

### Follow-ups
- Live check in a browser: create a pack from photos, star a sticker, reorder the panel.
