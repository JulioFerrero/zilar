---
id: T-1799
title: "Card guide nits from the live test: omit an unknown change, extra place facts go in subtitle, a block title never repeats the card title, news and search results as link blocks"
status: merged
milestone: M5
branch: task/T-1799-card-guide-nits
model: auto
effort: default
depends_on: [T-1793]
estimate: 15 min
---

# T-1799: Card guide nits

## Spec (written by Claude, do not edit)

### Why
The lead's live cards test on 2026-10-17 (20 requests to Deepseek in "ai test › cards test") left four small guide gaps:
1. **The briefing:** the prices showed "– $0" and "– 0.0000", because the AI sent a change it didn't know.
2. **The Prado:** the place card dropped the rating the user asked for, since `place` has no rating field.
3. **Repeated titles:** a table and a checklist repeated the card's title as their own title.
4. **News:** the top 3 stories came as a table, so the headlines weren't links.

### Facts (read by the lead on 2026-10-17)
- `apps/server/src/message-blocks/guide.ts` (95 lines): `CARD_RULES` is at `:39-69` and `CARD_SHAPES` at `:73-91`.
  - The change rule is at `:66`.
  - The place shape is `kind=place {title,subtitle?,url?}` at `:87`.
  - The link shape is `kind=link {url:https,site?,title,description?}` at `:86`.
  - The shape map row for a web page is at `:59`.
- `apps/server/src/message-blocks/guide.test.ts` only checks that every kind is present.

### Steps
In `CARD_RULES`, keeping each line short:
1. After the change rule (`:66`), add: "Leave `change` out when you do not know it; never send a zero or `—` change."
2. Add: "Extra facts about a place (hours, rating, price) go in `subtitle`, joined with ` · `, e.g. `Ruiz de Alarcón 23 · 10:00–20:00 · ★ 4.7`."
3. Add: "A block's own `title` names one part of the card; leave it out when it would repeat the card `title`."
4. Change the web page row (`:59`) to "| a web page, or a few articles or results (one each) | `link` |", and add: "For news or search results use one `link` block per item (at most 4), not a table, so each can be opened."
5. **No new tests;** run the existing guide test. Keep the file at most 400 lines.

### Allowed files
- `apps/server/src/message-blocks/guide.ts`
- `work/T-1799-card-guide-nits.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The guide carries the four rules.
- The guide test and the gate pass.

---

## Report (written by the worker when done)

### What I did
Added the four rules to `CARD_RULES` in `apps/server/src/message-blocks/guide.ts`, one short line each:
1. After the change rule: "Leave `change` out when you do not know it; never send a zero or `—` change."
2. Place facts go in `subtitle`, joined with ` · `, with the `Ruiz de Alarcón 23 · 10:00–20:00 · ★ 4.7` example.
3. A block's own `title` names one part of the card and is left out when it would repeat the card `title`.
4. The web page row now reads "| a web page, or a few articles or results (one each) | `link` |", and a rule asks for one `link` block per news or search item (at most 4) instead of a table.

No tests added (as the spec says); the existing guide test still passes. The file is 99 lines, well under the 400-line cap.

Files changed:
- `apps/server/src/message-blocks/guide.ts`
- `work/T-1799-card-guide-nits.md` (status and this Report)

### Checks run
- `pnpm install`: done in 21.4s, no errors.
- `pnpm --filter server test --maxWorkers=2 --reporter=dot src/message-blocks/guide.test.ts`: 1 file passed, 2 tests passed.
- `pnpm gate` (from repo root) summary:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: ...`, `images: ...`, `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead
No deviations from the spec, no open questions. The style of the new lines matches the surrounding rules (one rule per array entry, backticked fields).

## Review (written by Claude)

Merged. The packet matches HEAD `1f9df6736`. The guide gains the four rules (unknown change, place `subtitle`, no repeated block title, link blocks for news and results) and the web-page row. Text only; the guide test passes.

