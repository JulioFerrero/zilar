---
id: T-1086
title: "Mock H1 (web): the GIF tab loads from @zilar/mock-backend like real mode (no placeholder props, real probe); delete mock/helpers.ts"
status: merged
milestone: M5
branch: task/T-1086-web-gif-tab-on-backend
model: auto
effort: default
depends_on: [T-1083]
estimate: 0.2 day
---

# T-1086: Web GIF tab on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §2 (T-1082). The lead re-read main (2026-10-11):
- **The placeholders:** in mock mode `apps/web/src/components/StickerPanel.tsx` injects local placeholder GIFs:
  - `mockGifProps()` (`:106-116`) returns `{ mockItems: mockGifItems() }` from `apps/web/src/mock/helpers.ts` (`:14` import);
  - it is spread into `<GifPanel>` at `:294`.
- **No probe in mock mode:** the panel also skips the availability probe (`:140-160`: `gifsProbeNeeded = gifsTab === undefined && !isMockMode()`, and `gifsEnabled` starts `true` in mock mode).
- **`GifPanel`'s placeholder branch** (`apps/web/src/components/GifPanel.tsx:188-203`, `isMock`, `mockList`) reads `mockItems` once and never fetches.
- **The real path works in mock mode:** the backend serves GIF trending and search (`packages/mock-backend/src/domains/gifs/`), and web API calls in mock mode go through `dispatch` (`apps/web/src/mock/backend.ts`). The seed's media tokens are `data:image/` art, and `gifPreviewUrl` (`GifPanel.tsx:105-107`) renders those directly.
- **Importers:** `mock/helpers.ts` is imported only by `StickerPanel.tsx:14`, and no test uses `mockItems` or `mockGifItems`.

### What to build
1. **Probe first,** with a throwaway script that you do not commit. Probe the GIF trending call, the search call and the availability probe's request against `createMockBackend({ delayMs: 0 }).http(path, init)`. If any is not served, stop and report.
2. **`StickerPanel.tsx`:**
   - delete `mockGifProps` and the `mockGifItems` import, and render `<GifPanel onPick={onGifPick} />`;
   - the probe runs in mock mode too: `gifsProbeNeeded = gifsTab === undefined`, and `gifsEnabled` starts from `gifsAvailability()`;
   - keep the `gifsTab` test override.
3. **`GifPanel.tsx`:** remove the `mockItems` prop and its placeholder branch (`isMock`, `mockList`, the `visibleIds` seeding from `mockItems`), so it always loads through its API. Keep `gifPreviewUrl`'s `data:image/` pass-through, which seed tokens need.
4. **Delete `apps/web/src/mock/helpers.ts`,** after `grep -rn` across `apps/web` confirms that nothing else imports it.
5. **Rules:** every file stays under 400 lines, no tests, and no other files change.

The lead's web check (`?mock=1`): open the sticker panel's GIFs tab; results show and a search narrows them; send a GIF.

### Read first
`AGENTS.md`, `apps/web/src/components/StickerPanel.tsx`, `apps/web/src/components/GifPanel.tsx`, `apps/web/src/mock/helpers.ts`, `packages/mock-backend/src/domains/gifs/`, and `docs/audit/mock-sweep-status.md` §2 and §3.2.

### Allowed files
`apps/web/src/components/StickerPanel.tsx`, `apps/web/src/components/GifPanel.tsx`, `apps/web/src/mock/helpers.ts`, `work/T-1086-web-gif-tab-on-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the probe and the grep for `mock/helpers`.

---

## Report (written by the worker when done)

Status: review.

### What I did
1. **Probe first** with a throwaway script (kept outside the repo, never
   committed) against `createMockBackend({ delayMs: 0 })` from
   `packages/mock-backend/src/index.ts`. Real results:
   - `GET /api/gifs/trending` → `200`, body `{ items: [ { id: "mock-gif-1", … } ] }` (tokens are `data:image/svg+xml,…`).
   - `GET /api/gifs/search?q=laughing` → `200`, one item (`mock-gif-2`, `😹 laughing`).
   - The availability probe's request (`probeProvider` → `trendingGifs(undefined)`) is the same `GET /api/gifs/trending` → `200`.
   - `GET /api/gifs/media/:token` → `undefined` (the media proxy is not faked, as `docs/audit/mock-plan.md` §3 says; not needed because the seed tokens are `data:` URLs).
   Command: `pnpm --filter @zilar/devtools exec tsx <tmp>/t1086-probe.ts`.
2. **`apps/web/src/components/StickerPanel.tsx`**: removed `mockGifProps` and the
   `mockGifItems` / `isMockMode` imports; the probe now runs in mock mode too
   (`gifsProbeNeeded = gifsTab === undefined`); `gifsEnabled` starts from
   `gifsAvailability()`; the GIFs body is `<GifPanel onPick={onGifPick} />`. The
   `gifsTab` test override is kept.
3. **`apps/web/src/components/GifPanel.tsx`**: removed the `mockItems` prop,
   `isMock`, `mockList`, `NO_PAGE` and the placeholder branch, so it always loads
   through its API (`pageOf(searched, undefined)`). Kept `gifPreviewUrl`'s
   `data:image/` pass-through. When `IntersectionObserver` is unavailable, every
   item now counts as visible, derived during render (`observerUnavailable`)
   instead of seeding state in an effect (an initial `setVisibleIds`-in-effect
   tripped the `react(set-state-in-effect)` lint rule).
4. **Deleted `apps/web/src/mock/helpers.ts`** after `grep -rn` across `apps/web`
   confirmed nothing else imports it (the only importer was `StickerPanel.tsx`,
   now removed).

### grep for `mock/helpers`
- Before the delete, `grep -rn "mock/helpers" apps/web` matched only
  `apps/web/src/components/StickerPanel.tsx` (the import I removed).
- After the delete and edits, `grep -rn "mock/helpers" apps/web` → no matches.

### Files changed
- `apps/web/src/components/StickerPanel.tsx` (315 lines, < 400)
- `apps/web/src/components/GifPanel.tsx` (376 lines, < 400)
- `apps/web/src/mock/helpers.ts` (deleted)
- `work/T-1086-web-gif-tab-on-backend.md` (Report + status)

### Checks
Single tests: none (UI code gets no tests; no existing test imports
`StickerPanel`/`GifPanel`). Then `pnpm gate` from the repo root, real output:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (3.0s)
PASS  effect  (0.7s)
PASS  tests @zilar/web  (4.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes
- No tests were added (the spec says none; this is web UI).
- The `data:image/` pass-through in `gifPreviewUrl` works because the mock
  backend's seed tokens are `data:image/svg+xml,…`; `<img>` renders SVG, so the
  placeholders are not blank (audit §3.2).
- I re-ran `prettier --write` on `GifPanel.tsx` only, after the first gate run
  reported a format issue in that file; no other file was formatted.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `StickerPanel.tsx` drops `mockGifProps`, and the GIF availability probe runs in mock mode too;
  - `GifPanel.tsx` drops the `mockItems` placeholder branch and always loads through its API;
  - `mock/helpers.ts` (45 lines) is deleted.
  - Web `mock/` now holds only `backend`, `gate`, `gate.test`, `ids`, `load` and `dev-sticker-files`.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - the GIFs tab shows the backend's seed GIFs: cat art with Search GIFs and "Powered by Giphy";
  - picking one sends it, and Dev-1 replies "Sounds good.".
- **The sent GIF shows as a file row** ("415 B · image/gif"). Main on port 5196 does the same, so this is not new. It is the empty-bytes upload slot in `docs/audit/mock-sweep-status.md` §3.5, slice 4.
- **Check:** the gate passed, including the `@zilar/web` tests.
