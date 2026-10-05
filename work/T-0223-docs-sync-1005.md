---
id: T-0223
title: "Docs: FEATURES, the mobile parity roadmap and the README catch up with T-0181..T-0222"
status: planned
milestone: M5
branch: task/T-0223-docs-sync-1005
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0223: Docs sync

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "do we need to update the readme or some of the docs?". `docs/FEATURES.md` was last changed by T-0182; about 40 tasks merged since then and none of them is in it. `docs/ROADMAP_MOBILE_PARITY.md` still lists the wave tasks as missing. The README's Status table (M5 line) is behind too.

### Rules (read twice)
- Write only what the task files say. For every task below, read its `work/T-XXXX-*.md`: the Spec's "What the person sees" or "What to build", the Report and above all the lead's **Review** (the Review wins when they differ, e.g. a nit accepted or something not seen on a device). Do not invent features, flags or numbers; do not describe code you did not read.
- Status marks follow the legend at the top of `docs/FEATURES.md`: everything below is `🟡 Merged`, never `✅ Live`, unless the Review says Julio or the lead used it on the real stack. Where the Review says "not seen on a device", write `🟡 Merged (not seen on a device yet)`.
- Same table format, tone and length as the existing rows (one short sentence per "What it does"). Plain English, no emoji except the existing status marks.

### Tasks to cover (all merged; titles from `git log`)
- Mobile parity (FEATURES section 7 "Design and clients" or a new row group there, and the roadmap): T-0181 settings hub and profile, T-0183 Explore and @group links, T-0184 approvals page, T-0185 machines and model connections, T-0187 sticker pack management, T-0188 owner integrations, T-0191 sticker pack editor, T-0207 Telegram sticker import, T-0193 @handle people search (mobile), T-0189 tools and routines on the AI screen, T-0212 pause/resume/delete a routine, T-0213 AI activity feed, T-0218 tool detail sheet (read only), T-0190 invite link sheet and New message box, T-0214 New group sheet.
- Web: T-0192 search shows the @handle person row.
- Engineering (FEATURES section 8, the "Built by an AI team" row or one new row): the lead tooling of 2026-10-04/05: T-0196 doctor, T-0198 state race fix, T-0200 squash merges, T-0202..T-0204 token savings, T-0208/T-0215 review models, T-0209..T-0211 `lead watch` (Ink terminal view), T-0216/T-0221/T-0222 in-place fallback from the free to the paid Muse. One or two rows in total; do not list every task as its own row.
- Leave out docs-only and test-only tasks (T-0173, T-0194, T-0195, T-0197, T-0199, T-0201, T-0205, T-0206, T-0217, T-0220) unless a row already exists they belong to.

### What to change
1. `docs/FEATURES.md`: the rows above; update the "Mobile parity programme" row (section 8) to say which waves are merged and what is left (T-0186 notification settings is blocked on server push; the @mention picker and New channel parity are planned); add one Timeline line for `2026-10-04 to 2026-10-05`.
2. `docs/ROADMAP_MOBILE_PARITY.md`: add a "State (2026-10-05)" column or a short section saying which wave tasks are merged (with the follow-up tasks: T-0191→T-0207, T-0189→T-0212/T-0213/T-0218, T-0190→T-0214) and which are open (T-0186 blocked; @mention picker; tool writes T-0219 in progress). Keep the rest of the file.
3. `README.md`: only the M5 line of the Status table (line 115): mention that the phone now has the settings screens, sticker management and import, approvals, machines, integrations, Explore, and the AI tools/routines/activity screens; keep it one table cell. Nothing else in the README.

### Read first
`AGENTS.md`, `docs/FEATURES.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `README.md` (lines 100-120), then the task files listed above (`ls work/ | grep T-0181` etc.).

### Allowed files
`docs/FEATURES.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `README.md`, `work/T-0223-docs-sync-1005.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every product task listed above appears in `docs/FEATURES.md` with its task id and an honest status; the roadmap shows what is merged and what is open; the README M5 cell is current.
- Every claim can be traced to a task file's Spec, Report or Review (the pre-review checks a sample).
- `pnpm gate` ends with GATE PASS (format included) and lists no file outside the Allowed files.

### Out of scope
`docs/USER_GUIDE*`, the design docs, code.

---

## Report (written by the worker when done)

## Review (written by Claude)
