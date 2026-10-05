---
id: T-0206
title: Scout (docs only): can a RepoMapper repo map replace worker exploration? Measure it on our repo
status: planned
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

## Review (written by Claude)
