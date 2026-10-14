# New AI flow (approved 2026-10-15)

Julio approved this design ("10/10") on the canvas https://claude.ai/artifact/WMbGfFmbgAHeuEKKHvBg2k. The canvas is private, so these files are the copy workers read.

The files use the same "Design Component" format as the D24 mockups one folder up: plain HTML with inline styles, and the exact values to copy. They are D24 only (`docs/design/ui-style.md`).

## Web (960×760, the dialog over the app)
- `Main.dc.html`: 1 · Provider, with the searchable dropdown open (models.dev list; a green dot means you already have a key; OpenAI-compatible is pinned last).
- `Compatible.dc.html`: 1 · Provider = OpenAI-compatible, with Base URL (green dot when reachable) and Name.
- `Key.dc.html`: 2 · Key: one well field with a lock, a green dot when the key works, a show toggle, and "Get one ↗".
- `Model.dc.html`: 3 · Model and name: the orb with an edit badge, Name, the model dropdown, and the Template choice (Dev / Marketing / Fun, light selected key).
- `OrbPicker.dc.html`: 3 · Orb popover (interactive): 14 color swatches, 7 light colors, drag the light on the big orb, Shuffle and Reset.
- `Limits.dc.html`: 4 · Setup: Computer (Off · Zilar · Machine · Auto, light selected key), a machine dropdown for Machine and Auto (green dot = online), Per day and Per month ($, empty = no limit), then **Create AI**.

## Phone (390×844, a bottom sheet that hugs its content)
- `Mobile.dc.html` (Provider), `PhoneCompatible.dc.html`, `PhoneKey.dc.html`, `PhoneModel.dc.html`, `PhoneOrb.dc.html` (interactive) and `PhoneSetup.dc.html`.

## Rules the design set
- **Lean:**
  - no subtitles, descriptions or hint paragraphs;
  - a status is a dot or an icon, never a word;
  - the step bar shows done values ("✓ DeepSeek").
- **One way out:** the close key (or Esc, or the grabber). The footer is Back plus one primary.
- **Selection:** a selected choice uses the light key; the step bar's current step uses the dark raised segment.
