# Message blocks

On 2026-10-16 Julio asked for "a simple and cool way" for AIs to put custom UI inside a message, "not just for prices", and asked for about 25 blocks. He chose native blocks: the AI, or a saved tool, sends a small JSON layout, and web and phone draw it with Zilar's own components. He ruled out HTML mini-apps and Markdown-only.

He approved this canvas: "OH i love it, if this can be used by the ais inside zilar and looks this good will be increible!!!"

The canvas is https://claude.ai/artifact/G2tL9QnT7dYgD5SxeYreLr. It's private, so these files are the copy workers read. They use D24 only (`docs/design/ui-style.md`). The sample content (prices, Casa Paco, parcel 4417 and so on) is illustrative.

## The boards

| File | What it shows |
|---|---|
| `Main.dc.html` | Web: blocks inside a real chat. A daily "Prices" routine message (figures with change) and a "Morning briefing" that mixes weather, figures, an event and a checklist in one card. |
| `PhoneChat.dc.html` | The same, on the phone. |
| `WebNumbers.dc.html`, `PhoneNumbers.dc.html` | 01 figures, 02 big number + change (with sparkline), 03 stat tiles, 04 table, 05 bar chart, 06 line chart, 07 gauge. |
| `WebProgress.dc.html`, `PhoneProgress.dc.html` | 08 checklist, 09 progress, 10 timeline, 11 countdown, 12 status list. |
| `WebChoices.dc.html`, `PhoneChoices.dc.html` | 13 buttons (open and answered), 14 poll, 15 pick one (segmented control), 16 quick form, 17 rating, 18 alert rule (input and switch). |
| `WebContent.dc.html`, `PhoneContent.dc.html` | 19 link card, 20 images, 21 place (map, Directions), 22 weather (now and hourly), 23 event (calendar and map keys), 24 file, 25 callout (success, warning). |

## The shared look (read the boards for exact values)

- **The card:**
  - `#141414`, a 1 px `#232323` border, 16 px radius;
  - padding 12/14/8/14, with a 10 px gap between parts;
  - text 14/20 on web and 15/21 on the phone.
- **The parts:**
  - an optional header row: a 14 px stroke icon (16 on the phone), the title 13/500 `#a1a1a1`, and a right-aligned mono meta;
  - the time at the bottom right: mono 10, `#8a8a8a`.
- **Numbers:** Geist Mono with tabular figures, right-aligned. Up is `#4ade80` with ▲, down is `#f87171` with ▼.
- **Inner surfaces:** tiles and inner panels are `#101010` with a `#1f1f1f` border and a 12 px radius. Recessed parts (progress tracks, inputs, countdown cells, the segmented track) use the D24 well recipe.
- **Keys:** the routine approval card's keys (`docs/design/mockups/routines/WebRoutineAsk.dc.html`):
  - light primary and dark secondary;
  - 36 px with a 10 px radius on web, 40 px with a 12 px radius on the phone;
  - icon keys are square.
- **Status:** a status is a dot (green `#22c55e`, amber `#fbbf24`, red `#ef4444`, each with a soft ring) plus a number, never a word.
- **Charts:**
  - lines are `#ededed`, 1.6 px, with a faint area fill;
  - bars are dark raised, with today's bar the light key gradient;
  - the gauge ring is `#ededed` on a well-coloured track.
- **Several blocks in one card** are separated by a 1 px `#232323` rule (`Main.dc.html`, Morning briefing).
