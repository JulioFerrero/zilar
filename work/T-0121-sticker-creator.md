---
id: T-0121
title: Sticker pack creator (web): make packs from images, edit, share, favorites
status: planned
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
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Animated sticker creation, background removal, mobile UI, the Telegram importer (T-0123), usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
