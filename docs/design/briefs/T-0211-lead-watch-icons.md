# T-0211 add-on: the approved look of `lead watch`, with Nerd Font icons

Julio approved this mockup on 2026-10-05 ("much much much better yes i love it"): `docs/design/briefs/T-0211-lead-watch-mockup.html` (open it in a browser; it animates). It is the target. The mockup draws the icons with SVG because a web page cannot use the local font; the terminal uses the real Nerd Font glyphs listed below. Julio's Terminal window will use `FiraCode Nerd Font Mono` (installed on his Mac).

## Changes against the T-0211 spec

1. **Icons**: one exported table `WATCH_ICONS` (in `packages/devtools/src/lead/watch-format.ts`) with a Nerd Font glyph and a plain fallback for each name. Codepoints (Nerd Fonts v3):

   | name | used for | glyph | fallback |
   | --- | --- | --- | --- |
   | `brand` | header title | `\u{F01E7}` (nf-md-earth) | `◆` |
   | `clock` | header clock, s/step | `\u{F43A}` (nf-oct-clock) | none |
   | `working` | header counter, tok/s | `\u{F0E7}` (nf-fa-bolt) | `●` |
   | `needsYou` | header counter, waiting cards | `\u{F0F3}` (nf-fa-bell) | `◆` |
   | `merged` | header counter | `\u{F058}` (nf-fa-check_circle) | `✓` |
   | `branch` | footer | `\u{F418}` (nf-oct-git_branch) | none |
   | `thinking` | live step | `\u{F09D1}` (nf-md-brain) | none |
   | `reading` | live step | `\u{F441}` (nf-oct-eye) | none |
   | `editing` | live step | `\u{F448}` (nf-oct-pencil) | none |
   | `tests` | live step | `\u{F0C3}` (nf-fa-flask) | none |
   | `gate` | live step | `\u{F0565}` (nf-md-shield_check) | none |
   | `commit` | live step | `\u{F417}` (nf-oct-git_commit) | none |
   | `context` | speed line | `\u{F1C0}` (nf-fa-database) | `ctx` |
   | `added` / `modified` / `removed` | files line | `\u{F457}` / `\u{F459}` / `\u{F458}` (nf-oct-diff_*) | `+` / `~` / `−` |
   | `idle` | idle cards | `\u{F28B}` (nf-fa-pause_circle) | none |

   `lead watch --no-icons` (and the env `ZILAR_WATCH_ICONS=0`) uses the fallbacks. Every icon is followed by one space.
2. **Live step icon** follows the step: thinking, reading, editing, running tests, running the gate, committing; other steps get no icon.
3. **Card top border**: the spinner (or the bell when waiting for the lead) before the task id, both in the phase colour.
4. **Model badge**: `Muse` magenta, `MiniMax` orange (`#f2a65e`), the effort dim, then `free` in green when the model id ends in `-free`.
5. **Header**: brand icon in magenta and `zilar · lead` bold on the left, clock icon and time dim on the right; second row the three counters, `needs you` bold yellow.
6. **Waiting card** (phase needs the lead): instead of the live step a yellow line `review the packet and merge` with the bell; instead of the speed line a dim `idle · waiting for you` with the pause icon.
7. **Files line**: the three icons with counts in green, yellow and red, then the names dim.
8. **Footer**: `q quit · <branch icon> main · updated N s ago`, dim (`q` shown like a key).
9. **Context colour**: the `ctx` value green under 150k, yellow from 150k, red from 200k.
10. **Speed numbers**: tok/s in the phase colour.

Tests: `WATCH_ICONS` has every name above with a non-empty glyph; with icons off no character in the Private Use Area (U+E000-U+F8FF, U+F0000-U+FFFFD) is rendered; the badge colours and the `free` tag; the waiting card text; the width tests still pass at 40, 60 and 100 columns (count each glyph as one column).
