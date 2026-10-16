---
id: T-1773
title: "Cards pass web: the weather (22), event (23) and place (21) blocks, drawn exactly like WebContent.dc.html (no map image yet), with event times shown in the viewer's time zone"
status: merged
milestone: M5
branch: task/T-1773-web-content-blocks
model: auto
effort: default
depends_on: [T-1767]
estimate: 45 min
---

# T-1773: Web weather, event and place blocks

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17) wants cards that work for any request. This task draws **22 weather**, **23 event** and **21 place** on web.
- **The map image** (`map`, an uploaded media id) is out of scope: no AI can upload one yet. Draw the cards without it, and ignore `map` when it's set.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/WebContent.dc.html`: `21 · PLACE` at `:54-85`, `22 · WEATHER` at `:138-161` and `23 · EVENT` at `:162-195`.
  - The `Main.dc.html` "Morning briefing" (`:74-…`) shows weather inside a mixed card.
  - Also `docs/design/mockups/blocks/README.md:20-40`, and D24 in `docs/design/ui-style.md`.
- **The schemas** (`packages/protocol/src/blocks-content.ts`):
  - `PlaceBlockSchema` (`:28-35`): `title`, `subtitle?`, `map?`, `url?` (https only);
  - `WeatherBlockSchema` (`:39-…`): `place`, `condition`, `high`, `low`, `temp` (display strings) and `hourly?[]` of `{ at, condition, temp }`;
  - `EventBlockSchema` (`:62-71`): `title`, `startAt` and `endAt` (ISO), `detail?`, `calendar?` and `map?`.
- **The pattern for opening a link:** `LinkBlock.tsx` in `apps/web/src/components/message/blocks/` (`rel="noopener noreferrer"`, https only).
- **The seam (T-1767):** `apps/web/src/components/message/blocks/ContentBlocks.tsx` exports `renderContentBlock(block: Extract<Block, { kind: 'weather' | 'event' }>)` (`:9-11`), which returns `null`. `BlockCard.tsx:42-44` routes `weather` and `event` to it. **`place` isn't routed yet:** add `case 'place':` at `BlockCard.tsx:42-44` and widen the parameter type to include `'place'`.
- **The chat-core index:** `packages/chat-core/src/index.ts`. Add your export **right after line 49** (`export * from './money';`). Other parallel tasks use lines 3 and 20.

### Steps
1. **Shared logic:** a new `packages/chat-core/src/block-content.ts`, exported from the index after line 49.
   - `weatherIcon(condition)` maps the free-text condition (clear, sun, cloud, rain, storm, snow, fog, wind; case-insensitive keywords) to one of a fixed set of icon keys, with a neutral default.
   - `eventWhen(startAt, endAt, timeZone)` gives the board's date tile (`OCT` / `17`) and a line like `21:00–23:00`, or with dates when the event spans days, in the **viewer's** time zone.
   - Use `Intl.DateTimeFormat`, which browsers and Hermes have.
2. **The components:** `WeatherBlock.tsx`, `EventBlock.tsx` and `PlaceBlock.tsx` in `apps/web/src/components/message/blocks/`, drawn to the board.
   - Weather icons come from lucide (the same keys as `weatherIcon`).
   - The place's "Directions" key opens `url` only when it is set.
   - Ignore `calendar` (an add-to-calendar action is interactive, Wave 2).
3. **`ContentBlocks.tsx`:** return the three components.
4. **A new fixture,** `ContentBlocks.fixture.tsx`, with the board's samples (Madrid weather, Casa Paco dinner and a place).
5. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/block-content.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/blocks/WeatherBlock.tsx`
- `apps/web/src/components/message/blocks/EventBlock.tsx`
- `apps/web/src/components/message/blocks/PlaceBlock.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `work/T-1773-web-content-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `weather`, `event` and `place` render on web like the board, without a map image.
- Event times are shown in the viewer's time zone.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Shared logic** — new `packages/chat-core/src/block-content.ts`, exported from the index immediately after `./money`:
  - `weatherIcon(condition)`: case-insensitive, substring keyword match to a fixed seven-key glyph set (`sun | cloud | rain | storm | snow | fog | wind`); unknown text falls back to the neutral `cloud` ("thunderstorm" is matched before "rain", "shower" before the bare "rain").
  - `eventWhen(startAt, endAt, timeZone)`: returns `{ month, day, line }`, built with `Intl.DateTimeFormat`; the tile is `OCT` / `17`. A same-day event gives `Fri 21:00 – 23:00`; an event that ends on another day gives both dated ends (`Fri 17 Oct 21:00 – Sat 18 Oct 02:00`).
- **Components** — drawn from `WebContent.dc.html`:
  - `WeatherBlock.tsx` (22): the glyph (lucide, same keys as `weatherIcon`), `Madrid` / `Clear · H 22° · L 11°` / big `18°`, then the hourly strip (`grid-flow-col auto-cols-fr`, one equal column per hour and one row for the schema's max of 6); an absent or empty `hourly` draws no strip.
  - `EventBlock.tsx` (23): the raised date tile, the title and the when line in the **viewer's** zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), with `detail` appended as `· 4 people`. No calendar key (interactive, Wave 2) and no map key (`map` is an uploaded media id, out of scope).
  - `PlaceBlock.tsx` (21): title + subtitle; the map image is omitted (out of scope) and the dark **Directions** key is drawn, opening `url` in a new tab (`target="_blank" rel="noopener noreferrer"`) only when `url` is set.
- **Dispatch** — `ContentBlocks.tsx` returns the three; `BlockCard.tsx` now routes `case 'place':` and `renderContentBlock`'s parameter widened to `'place' | 'weather' | 'event'`.
- **Fixture** — new `ContentBlocks.fixture.tsx` with the board's Madrid weather, Casa Paco dinner and Casa Paco place.

Files changed (all inside the Allowed files):
`packages/chat-core/src/block-content.ts` (new), `packages/chat-core/src/index.ts`,
`apps/web/src/components/message/blocks/WeatherBlock.tsx` (new), `EventBlock.tsx` (new),
`PlaceBlock.tsx` (new), `ContentBlocks.tsx`, `ContentBlocks.fixture.tsx` (new),
`BlockCard.tsx`, `work/T-1773-web-content-blocks.md`.

### Checks run

- `pnpm gate` (1st run): **FAIL `format`** — Prettier wanted one joined line in `WeatherBlock.tsx`. Fixed with `pnpm exec prettier --write apps/web/src/components/message/blocks/WeatherBlock.tsx` (1 file written).
- `pnpm gate` (2nd run, from the repo root): **GATE PASS**, exit 0. Summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.3s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/chat-core  (3.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says "No tests", and the gate reports `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm gate` (3rd run, lead fix round): **GATE PASS**, exit 0 — same lines as above; 9 changed files, all inside the Allowed files. The round fixed `WeatherBlock.tsx` to draw the hourly strip only when `hourly` has at least one entry (an AI may send `hourly: []`), and corrected this Report's wording about the strip.

### Notes for the lead

- **Event when line.** The board draws `Fri 21:00 – 23:00` (`WebContent.dc.html:172`); the spec's example wrote `21:00–23:00`. I followed the board (weekday + spaced en dash) because the title says "drawn exactly like WebContent.dc.html". Say the word if you want the bare range instead.
- **Temperature strings.** I render `high` / `low` / `temp` verbatim (the client never formats, per `blocks-numbers.ts:26-27`), so the fixture sends `'22°'` / `'18°'`. If the payload is meant to be bare numbers (`'22'`) and the renderer should append `°`, that is a one-line change — please confirm the intended shape.
- **Keys not drawn.** The event's "Add to calendar" key is dropped (spec: ignore `calendar`) and its "Map" key too (`map` is an uploaded media id, out of scope); the place's map image is omitted for the same reason. So both cards are drawn without a map image, as asked.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `7c9be69be`.
- I took a Cosmos screenshot of `ContentBlocks.fixture` and compared it with `WebContent.dc.html`:
  - **weather:** the sun icon, place and condition, the big temperature, and the hourly strip;
  - **event:** the date tile and the time range in the viewer's time zone;
  - **place:** title, subtitle and a Directions key, with no map.
- `place` is routed in `BlockCard.tsx`.
- **Round 2:** the hourly strip is drawn only when it isn't empty.

