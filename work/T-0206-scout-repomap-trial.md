---
id: T-0206
title: Scout (docs only): can a RepoMapper repo map replace worker exploration? Measure it on our repo
status: merged
milestone: M5
branch: task/T-0206-scout-repomap-trial
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0206: Scout: RepoMapper trial

## Spec (written by Claude, do not edit)

### Why
Workers spend most of their tokens exploring: hundreds of steps of grep and file reads, each re-sending the whole session (measured 2026-10-05: T-0187's worker used about 37M input tokens). Aider-style repo maps (tree-sitter definitions ranked with PageRank) promise a compact map of the files and symbols that matter, so a worker could read a 2k-token map instead of exploring. Julio asked to trial RepoMapper. You measure; you change no code.

### Verified facts (do not re-derive)
- RepoMapper (MIT, https://github.com/pdavis68/RepoMapper) is installed by the lead at `~/.zilar-lead/tools/RepoMapper` with its own Python 3.13 environment. Run it ONLY from that folder (its cache goes to the current folder, never into the repo):
  `cd ~/.zilar-lead/tools/RepoMapper && uv run -q python repomap.py --root <your worktree> --map-tokens 2048 <paths...>`
  Options (from `--help`): `--map-tokens N`, `--chat-files [...]`, `--mentioned-files [...]`, `--mentioned-idents [...]`, `--exclude-unranked`, `--verbose`.
- The lead ran it once on `apps/mobile/src` with `--map-tokens 2048`: about 6.5 s, 8.3 KB of output, 413 files considered. Without chat or mentioned files every file ranked `1.0000`, test files were included, and stdout was a Python tuple with escaped `\n`, not plain text.
- Main has one squashed commit per task. Find a task's changed files with `git log --format=%H --grep '^T-0187:' main` and `git show --stat <sha>`.
- The commands above run outside your worktree, so the autopilot may ask the lead to approve them; wait for the answer.

### What to produce
ONE file: `docs/audit/repomap-trial.md` with these sections, every number measured by you:
1. **Setup and output**: the exact commands you ran; run time; output size in characters and in tokens (estimate tokens as characters / 4 and say so); whether the output format is usable as-is or needs a small wrapper to print plain text (describe the wrapper, do not write it).
2. **Unfocused maps**: `apps/mobile/src` and `apps/server/src` at `--map-tokens 2048`, with and without `--exclude-unranked`. Are the top entries the files a newcomer needs? Are test files crowding it out?
3. **Focused maps for 3 real tasks**: T-0187 (mobile sticker packs), T-0188 (mobile integrations) and T-0173 (server voice pipeline). For each, pass the spec's "Read first" and "Allowed files" paths that exist as `--mentioned-files` (and try `--chat-files` once), map size 2048. Compare the map with the files the task's squash commit really changed and with the files its Report says it read: how many appear in the map, which important ones are missing, what is noise. A small table per task.
4. **Verdict**: would giving workers this map (in the spec, or as an MCP tool) likely cut exploration, and what would it cost per task in tokens? Include the risks you saw (wrong ranking, stale map after merges, extra setup on the machine). Recommend one of: adopt in specs, adopt as an MCP tool, write hand-made area maps instead, or drop it.

### Read first
`AGENTS.md`, `work/T-0187-mobile-sticker-packs.md`, `work/T-0188-mobile-integrations-owner.md`, `work/T-0173-effect-spike.md`.

### Allowed files
`docs/audit/repomap-trial.md`, `work/T-0206-scout-repomap-trial.md`. No code file may change; do not install anything and do not edit files under `~/.zilar-lead/tools`.

### Checks
```bash
pnpm gate
```

### Acceptance
- All four sections exist with measured numbers; every claim about the tool comes from a command you ran (quote the command).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Installing an MCP server, changing prompts or specs, any code.

---

## Report (written by the worker when done)

### What I did
- Ran RepoMapper from `~/.zilar-lead/tools/RepoMapper` per the spec command shape: 4 unfocused maps (mobile + server, with/without `--exclude-unranked`), 3 focused maps (T-0187/T-0188/T-0173 mentioned-files from each spec's Read-first + Allowed paths), 1 `--chat-files` trial. All at `--map-tokens 2048`.
- Compared each focused map against the task's squash-commit file list (`git log --format=%H --grep '^T-XXXX:' main` + `git show --stat`: T-0187 `4b96bc37`, T-0188 `3e30452f`, T-0173 `da804c10`) and its Read-first list.
- Wrote `docs/audit/repomap-trial.md` (4 sections, all numbers measured). Verdict: **drop it** — maps echo mentioned-files, cannot show files tasks create, 25-41% test noise, and surfaced zero files the specs had not already named.
- Found and documented 2 CLI bugs by reading the tool source (not by editing it): `--verbose` crashes (tuple passed to tiktoken, exit 1) and flag-before-paths order silently yields an empty map (exit 0).

### Files changed
- `docs/audit/repomap-trial.md` (new), `work/T-0206-scout-repomap-trial.md` (this Report, status).

### Commands and real results
- `pnpm install`: pass (10.1s).
- RepoMapper runs (from `~/.zilar-lead/tools/RepoMapper`, `uv run -q python repomap.py --root $R --map-tokens 2048 ...`): m1 mobile 7,991 bytes/~2,000 tok/413 files; m2 excl-unranked 8,138 bytes; m3 server 8,211 bytes/278 files; m4 excl 8,254 bytes; f187 7,716 bytes/12 files; f188 7,937 bytes/14 files; f173 8,509 bytes/16 files; c187 chat-files 8,150 bytes/16 files. Each ~1.2-1.3s warm. Full table + per-task hit/miss tables in the audit doc.
- No single-package tests applied (docs-only task, no code); `pnpm gate` runs the relevant checks.
- `pnpm gate`: GATE PASS — PASS install (frozen), format, lint, typecheck; `scope: every changed file is inside the Allowed files` (2 changed files).

### Problems / deviations
- `--verbose` unusable (crash above), so token counts are chars/4 estimates as the spec permits; gpt-4 tiktoken counts unavailable.
- Mentioned-files must follow positional paths (argparse `nargs='*'` swallows them otherwise); all measured runs use the working order.
- Lead's 6.5s cold timing not re-derived (warm runs ~1.3s); T-0187's 37M-token figure is the lead's, cited as such.

### Security checklist
- Docs-only task: no routes, no secrets, no deletes, no logging changes. No secret read or committed.

### Blocked / needs a decision
- None.

### Disagreements
- None. Both should-fix findings were correct (verified finding 1 with `git show --name-only 4b96bc37`: no sticker-panel; re-ran both bug-repro commands for finding 2). Nits 3-4 left untouched per instructions (not in lines otherwise changed).

### Round 2 — pre-review fixes (worker, 2026-10-05)
- Finding 1 (should-fix): `sticker-panel.tsx` row now "no (spec-named but commit does not touch it)"; T-0187 score corrected to 3 of 8; pattern paragraph updated to 5/8 new.
- Finding 2 (should-fix): both CLI-bug claims now quote the exact invocations with exit codes/outputs (verbose → exit 1 + TypeError; misordered flags → exit 0 + 116-byte empty tuple).
- No behaviour code exists in this docs-only task, so no tests apply.
- `pnpm gate`: GATE PASS — PASS install (frozen), format, lint, typecheck; `scope: every changed file is inside the Allowed files` (2 files).

## Review (written by Claude)

**Verdict:** Approved after one automatic round. `docs/audit/repomap-trial.md` measures RepoMapper on our repo and recommends dropping it: unfocused maps rank every file the same and spend 25-41 percent of the budget on tests; focused maps for T-0187, T-0188 and T-0173 only echoed the files the spec already names, because most of what our tasks change are NEW files a map of existing code cannot show (5 of 8, 9 of 10 and 2 of 3). The lead spot-checked the commit claims (`4b96bc37` does not touch `sticker-panel.tsx`; `3e30452f` changed 14 files). Accepted nits: two small wording points in the report. Decision: RepoMapper is not adopted; the tool stays installed outside the repo at `~/.zilar-lead/tools/RepoMapper` and can be deleted.
