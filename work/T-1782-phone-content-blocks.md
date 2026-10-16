---
id: T-1782
title: "Cards pass phone: the weather (22), event (23) and place (21) blocks, drawn exactly like PhoneContent.dc.html (no map image), reusing chat-core's weatherIcon/eventWhen, with catalog examples"
status: merged
milestone: M5
branch: task/T-1782-phone-content-blocks
model: auto
effort: default
depends_on: [T-1773]
estimate: 45 min
---

# T-1782: Phone weather, event and place blocks

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1773 (merged), for Julio's 2026-10-17 "cards for any request".

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/PhoneContent.dc.html`: `21 · PLACE` at `:67-96`, `22 · WEATHER` at `:97-120` and `23 · EVENT` at `:121-143`. Phone sizes are in `docs/design/mockups/blocks/README.md:20-40`. D24 only.
  - The map image, the event's "Add to calendar" key and its "Map" key are out of scope (uploaded media and Wave 2), as on web.
- **The schemas:** `PlaceBlockSchema`, `WeatherBlockSchema` and `EventBlockSchema` (`packages/protocol/src/blocks-content.ts:28,39,62`).
- **The shared logic (T-1773):** `weatherIcon(condition)` (`packages/chat-core/src/block-content.ts:31`) and `eventWhen(startAt, endAt, timeZone)` (`:56`), exported from `@zilar/chat-core`. Use the device time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- **The web twin, to match:** `apps/web/src/components/message/blocks/WeatherBlock.tsx` (it skips an empty hourly strip), `EventBlock.tsx` and `PlaceBlock.tsx` (Directions only when `url` is set, opened as an https link).
- **How the phone opens a link:** `link-block.tsx` in the same folder.
- **The seam (T-1767):** `apps/mobile/src/components/chat/blocks/content-blocks.tsx` exports `CONTENT_KINDS` (an empty set) and `renderContentBlock(block: Extract<Block, { kind: 'weather' | 'event' }>, _showHeading)`, which returns `null`. `block-card.tsx:90-91` routes only `weather` and `event`. **Add `case 'place':` there** and widen the type to include `'place'`.
- **The catalog:** `EXAMPLES` in `apps/mobile/src/mock/dev-blocks-screen.tsx`.

### Steps
1. New `weather-block.tsx`, `event-block.tsx` and `place-block.tsx` in `apps/mobile/src/components/chat/blocks/`, drawn to the phone board. Weather icons come from lucide, keyed like `weatherIcon`.
2. **`content-blocks.tsx`:** set `CONTENT_KINDS` to `weather`, `event` and `place`, and return the components. Add `place` routing in `block-card.tsx`.
3. **The catalog:** **append** three examples (21, 22, 23) at the **end** of `EXAMPLES`, with the board's samples.
4. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/weather-block.tsx`
- `apps/mobile/src/components/chat/blocks/event-block.tsx`
- `apps/mobile/src/components/chat/blocks/place-block.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1782-phone-content-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `weather`, `event` and `place` render on the phone like the board, without a map.
- Event times use the device's time zone.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added the three phone content bodies, drawn to `docs/design/mockups/blocks/PhoneContent.dc.html` (D24):
  - `weather-block.tsx` (22): lucide glyph from `weatherIcon` (40 px, sw 1.5, `#ededed`), place + `condition · H high · L low` (13 px `#a1a1a1`), the current `temp` (mono 34/40), and the hourly strip only when non-empty — 5 cells, `#101010`/`#1f1f1f` 12 px panel, hour mono 10 `#8a8a8a`, glyph 18 px sw 1.8 `#d4d4d4`, temp mono 14 tabular.
  - `event-block.tsx` (23): the raised date tile (50×54, `linear-gradient(180deg,#2c2c2c,#151515)`, `#050505` border, `inset 0 1px 0 rgba(255,255,255,.16), 0 1px 0 rgba(0,0,0,.95)`), month mono 10 `#a1a1a1`, day mono 21/26 semibold, title and `when.line · detail` (13 px `#a1a1a1`). Times use `eventWhen` with `Intl.DateTimeFormat().resolvedOptions().timeZone` (the device zone). No calendar/map keys (Wave 2 / uploaded media, as on web).
  - `place-block.tsx` (21): title + optional subtitle (13 px `#a1a1a1`) and a Directions key (40 px, 12 px radius, the board's dark key gradient `#1c1c1c → #121212`, `#2a2a2a` border) only when `url` is set; it opens the link with `Linking.openURL` through `safeLinkTarget`. No map image (uploaded media, out of scope).
- `content-blocks.tsx`: `CONTENT_KINDS` now holds `place`, `weather`, `event`; `renderContentBlock` returns the three components and its parameter type is widened to include `'place'`.
- `block-card.tsx`: added `case 'place':` to the content dispatch.
- `dev-blocks-screen.tsx`: appended three catalog examples (21 place, 22 weather, 23 event) at the end of `EXAMPLES`, matching the phone board samples (Madrid weather, Dinner at Casa Paco with `2026-10-17T21:00:00+02:00`, Casa Paco with the board's Maps directions URL).
- Every changed file is under 400 lines; no new dependency.

### Checks run
- `pnpm gate` (repo root, once): exit 0. Summary lines:
  - `gate: 7 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the spec says "No tests" for this task.
- One `pnpm exec prettier --write` on `weather-block.tsx` to fix the import wrapping flagged by the first gate run; the second gate is the PASS above.

### Deviations from the spec
- None. The event's Calendar and Map keys and the place map image are omitted as the spec requires.

### Notes for the lead
- The event example uses the same `2026-10-17T21:00:00+02:00` range as the web fixture, so the rendered line follows the board ("Fri 21:00 – 23:00" in `+02:00`; "Oct 17" tile). The device zone governs the actual text.
- The Directions key icon is lucide `Navigation`, matching the web twin (the board path is lucide `Send`).

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `debb80e99`.
- `CONTENT_KINDS` holds `place`, `weather` and `event`, and `block-card.tsx:90` routes `place`.
- **Weather** skips an empty hourly strip.
- **Event** uses `eventWhen` with the device's time zone.
- **Place:** Directions opens through `safeLinkTarget`, and the schema only allows https.
- **Nit, left open:** the catalog event's fallback says "Fri" for a date that falls on a Saturday.
- **The emulator check of `zilar://dev/blocks` is still to do** (tonight, with the other phone screens).

