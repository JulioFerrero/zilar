---
id: T-1086
title: "Mock H1 (web): the GIF tab loads from @zilar/mock-backend like real mode (no placeholder props, real probe); delete mock/helpers.ts"
status: todo
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

## Review (written by Claude)
