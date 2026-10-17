---
id: T-1879
title: "Media cards G1: teach `images` and `file` in the post_blocks card guide only (MEDIA_KINDS + rules + shapes: call fetch_media first and pass the returned id, never a URL); the saved-tool guide stays without them; extend the post_blocks-only guide test"
status: merged
milestone: M5
branch: task/T-1879-media-card-guide
model: auto
effort: default
depends_on: [T-1873]
estimate: 20 min
---

# T-1879: The card guide teaches media cards (media plan G1)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/message-blocks-media.md` §6 G1.** These are done:
- the store and the read route (T-1847, T-1853);
- fetch (T-1862, T-1873);
- id checks (T-1872);
- the web and phone renderers (T-1867, T-1868).

**The model still isn't told** in the card guide when to use `images` or `file`, or their shapes. Only `post_blocks` cards may carry media: saved-tool and routine cards drop them (T-1872, `apps/server/src/message-blocks/media-ids.ts`). So the media kinds follow the same "post_blocks only" pattern as the interactive kinds.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/message-blocks/guide.ts`:**
  - `CARD_KINDS` (`:12-30`) feeds both guides;
  - `INTERACTIVE_KINDS`, `INTERACTIVE_RULES` and `INTERACTIVE_SHAPES` are added only by `cardGuide({ interactive: true })` (`:134-140`);
  - `blocks-tool.ts:18` (the `post_blocks` description) passes `interactive: true`; `apps/server/src/agents/tool-guide.ts:29` (the saved-tool guide) calls `cardGuide()`.
- **The protocol shapes** (`packages/protocol/src/blocks-content.ts`):
  - `images`: `{ items: 1-4 media ids, extra?: int ≥ 0 }` (`:16-25`);
  - `file`: `{ media: id, name, size, format, rows? }` (`:74-84`).
- **The guide test:** `apps/server/src/message-blocks/guide.test.ts:40-51` asserts the interactive kinds appear only in the `post_blocks` description and never in `TOOL_GUIDE` or `CARD_KINDS`.

### Steps
1. **`guide.ts`:** add `export const MEDIA_KINDS = ['images', 'file']`, plus:
   - `MEDIA_RULES`:
     - "To show a photo or offer a file, first call `fetch_media` with its https URL, then put the returned media id in the card, never the URL."
     - "`images` takes 1-4 ids in `items` (set `extra` to how many more there are)."
     - "`file` takes one id in `media`, with `name`, `size` (e.g. `12 KB`), `format` (e.g. `CSV`) and optional `rows`."
   - `MEDIA_SHAPES`:
     - `kind=images {items:[1-4]mediaId,extra?}`
     - `kind=file {media:mediaId,name,size,format,rows?}`

   Append both inside the `interactive: true` branch of `cardGuide`, after the interactive lines.
2. **`guide.test.ts`:** extend the post_blocks-only test, or add one `it` next to it, so `MEDIA_KINDS` get the same five assertions and `MEDIA_RULES` appears in the description but not in `TOOL_GUIDE`.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `apps/server/src/message-blocks/guide.test.ts`
- `work/T-1879-media-card-guide.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The `post_blocks` description** teaches `fetch_media` → `images`/`file` with the shapes.
- **The saved-tool guide** doesn't.
- The guide test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/message-blocks/guide.ts`: added `MEDIA_KINDS` (`images`, `file`), `MEDIA_RULES` (call `fetch_media` with the https URL first and pass the returned id, never the URL; `images` takes 1-4 ids in `items` plus optional `extra`; `file` takes one `media` id with `name`, `size`, `format` and optional `rows`) and `MEDIA_SHAPES` (`kind=images {items:[1-4]mediaId,extra?}`, `kind=file {media:mediaId,name,size,format,rows?}`). `cardGuide({ interactive: true })` now appends `MEDIA_RULES` and `MEDIA_SHAPES` after the interactive lines; `cardGuide()` (the saved-tool guide) is unchanged.
- `apps/server/src/message-blocks/guide.test.ts`: added a `it('offers the media kinds in post_blocks only')` next to the interactive test, with the same five assertions per media kind (protocol kind, shape line, present in the `post_blocks` description, absent from `TOOL_GUIDE`, absent from `CARD_KINDS`) and `MEDIA_RULES` present in the description but absent from `TOOL_GUIDE`.

### Checks run

- `pnpm install`: done in 18.1s, no errors.
- `pnpm --filter @zilar/server exec vitest run src/message-blocks/guide.test.ts --maxWorkers=2 --reporter=dot`: 1 file passed, 4 tests passed.
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.7s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/server  (5.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- `MEDIA_KINDS` is not added to `CARD_KINDS`, so the media kinds follow the interactive pattern: they are taught only by the `post_blocks` guide, and the shared kind/shape test stays untouched.
- No deviations from the spec, no open questions.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `06cf5a522`.
- **`MEDIA_KINDS`, `MEDIA_RULES` and `MEDIA_SHAPES`** are added only to `cardGuide({ interactive: true })` (the `post_blocks` description). The saved-tool guide stays without them, and the test asserts both sides.
- **Live check (before this guide):** asked in "cards test", Deepseek fetched `https://www.gstatic.com/webp/gallery/1.jpg` with `fetch_media` and posted an image card that shows the photo through `/api/card-media`.

