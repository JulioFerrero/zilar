# RepoMapper trial (T-0206)

Scout measurement: can an Aider-style repo map replace worker exploration?
All numbers below were measured by the worker on 2026-10-05 in worktree
`/Users/julio/personal-projects/zilar-T-0206` (branch
`task/T-0206-scout-repomap-trial`).

## 1. Setup and output

Tool: RepoMapper (MIT, https://github.com/pdavis68/RepoMapper), installed by
the lead at `~/.zilar-lead/tools/RepoMapper` with its own Python 3.13
environment. All runs used the spec's command shape, from that folder:

```
cd ~/.zilar-lead/tools/RepoMapper && uv run -q python repomap.py --root <worktree> --map-tokens 2048 <paths...>
```

Its tag cache (`.repomap.tags.cache.v1/cache.db`) and any map cache live in
the tool folder, never in the repo. No repo file was touched by the tool.

Measured runs (each command run once, wall time from `time`):

| Run | Command (after `cd ~/.zilar-lead/tools/RepoMapper`) | Wall | Output bytes | Tokens (~chars/4) | Files considered |
|-----|------------------------------------------------------|------|--------------|-------------------|------------------|
| m1 mobile plain | `uv run -q python repomap.py --root $R --map-tokens 2048 $R/apps/mobile/src` | ~1.2 s (run inside a batch; lead measured 6.5 s cold with cache build) | 7,991 | ~2,000 | 413 |
| m2 mobile `--exclude-unranked` | same + `--exclude-unranked` | ~1.2 s | 8,138 | ~2,035 | 413 |
| m3 server plain | `... $R/apps/server/src` | ~1.2 s | 8,211 | ~2,053 | 278 |
| m4 server `--exclude-unranked` | same + `--exclude-unranked` | ~1.2 s | 8,254 | ~2,064 | 278 |
| f187 stickers focus | `$R/apps/mobile/src --mentioned-files docs/design/briefs/T-0187-sticker-packs.md docs/ROADMAP_MOBILE_PARITY.md docs/design/ui-style.md apps/mobile/src/lib/approvals-api.ts apps/mobile/src/lib/ais-api.ts apps/mobile/src/components/ais/use-ais-api.ts apps/mobile/src/components/ais/require-ais-auth.tsx apps/mobile/src/app/ais/index.tsx apps/mobile/src/lib/settings-items.ts apps/web/src/routes/StickersPage.tsx apps/mobile/src/lib/stickers-api.ts apps/mobile/src/components/chat/sticker-panel.tsx apps/mobile/src/app/settings/index.tsx` | ~1.3 s | 7,716 | ~1,929 | 413 |
| f188 integrations focus | `$R/apps/mobile/src --mentioned-files docs/design/briefs/T-0188-integrations.md docs/ROADMAP_MOBILE_PARITY.md docs/design/ui-style.md apps/mobile/src/lib/approvals-api.ts apps/mobile/src/lib/ais-api.ts apps/mobile/src/components/ais/use-ais-api.ts apps/mobile/src/components/ais/require-ais-auth.tsx apps/mobile/src/app/ais/index.tsx apps/mobile/src/lib/settings-items.ts apps/web/src/routes/IntegrationsPage.tsx` | ~1.3 s | 7,937 | ~1,984 | 413 |
| f173 voice focus | `$R/apps/server/src --mentioned-files docs/ROADMAP_EFFECT.md docs/EFFECT_GUIDE.md apps/server/src/voice-transcription/routes.ts apps/server/src/voice-transcription/provider.ts` | ~1.3 s | 8,509 | ~2,127 | 278 |
| c187 chat-files trial | `--chat-files $R/apps/mobile/src/lib/stickers-api.ts --other-files $R/apps/mobile/src --mentioned-files docs/design/briefs/T-0187-sticker-packs.md apps/web/src/routes/StickersPage.tsx` | ~1.3 s | 8,150 | ~2,038 | 413 |

Token counts are `characters / 4` estimates (stated as required); gpt-4
tiktoken counts were not available because of the `--verbose` bug below. The
byte counts include the map text only; the `Chat files: []` line and the
trailing `FileReport(...)` tuple were excluded from the token estimate.

**Output format: usable as-is, but ugly.** The map is printed with `print()`
of a Python **tuple** `(map_string, FileReport(...))`, so stdout starts with
`("apps/...` (with literal `\n` escapes) and ends with
`..., FileReport(excluded={}, definition_matches=2472, reference_matches=2219,
total_files_considered=413))`. A worker can still read it, but for spec
inclusion it needs a small wrapper that prints only element 0 as plain text
(e.g. unpack the tuple and `print(map_string)` instead of `print(tuple)`;
also fixes the two bugs below). Wrapper described only, not written, per spec.

**Two CLI bugs found while measuring** (observed from commands run, root
cause read from the source — no tool file edited):

1. `--verbose` crashes (exit 1, no map). Command run:
   `uv run -q python repomap.py --root $R --map-tokens 2048 --verbose $R/apps/mobile/src`
   → stderr `Error: Error generating repository map: expected string or buffer`
   with traceback ending at `repomap.py` line 210 (`tokens =
   repo_map.token_count(map_content)`) → `utils.py` line 32
   (`len(encoding.encode(text))`) → `TypeError: expected string or buffer`.
   Cause: `get_repo_map` returns a `(str, FileReport)` tuple and line 210
   passes the tuple to tiktoken.
2. Argument order matters. Command run (flags before paths):
   `uv run -q python repomap.py --root $R --map-tokens 2048 --mentioned-files docs/design/briefs/T-0187-sticker-packs.md $R/apps/mobile/src`
   → exit 0, stdout is just `Chat files: []` plus
   `(None, FileReport(excluded={}, definition_matches=0, reference_matches=0, total_files_considered=0))`
   (116 bytes) — a silent empty result. Cause: argparse swallows the
   positional path into the flag's `nargs='*'` list, leaving `other_files`
   empty. The spec's command template (`--map-tokens 2048 <paths...>`)
   happens to be the working order, and all measured runs use it.

**Ranking caveat (read from the code, confirmed by the maps):** with no
`--chat-files`, `get_ranked_tags` skips PageRank entirely
(`ranks = {node: 1.0 for node in G.nodes()}`), so every file ranks `1.0000`
— the lead's observation. `--exclude-unranked` is then a no-op (nothing is
near zero), which is why m1/m2 and m3/m4 differ only in which arbitrary
files fill the 2048-token budget. Real differentiation only comes from
`--chat-files` (x20 boost), `--mentioned-files` (x5) or `--mentioned-idents`
(x10).

## 2. Unfocused maps

m1 (`apps/mobile/src`, 24 files in budget) is a random-feeling slice:
`voice-transcripts.test.ts`, `attachment-message.test.tsx`, `utils.ts`,
`ais/templates.ts`, `color-scheme.ts`, `format-relative.ts`, `u/[handle].tsx`,
`approvals/rows.ts`, ... A newcomer learns nothing about where settings
screens, API modules, or the chat composer live; `settings-items.ts`,
`app/settings/index.tsx`, and every `-api.ts` module are absent. 6 of 24
entries (25%) are test files.

m2 (same + `--exclude-unranked`, 17 files) is a *different* random slice
(`typing-dots.tsx`, `jump-scroll.ts`, `machines-mock.ts`, `gifs.ts`,
`emoji-tab.tsx`, ...), still with no entry point, no registry, no API
module. 7 of 17 entries (41%) are test files. The flag changed the sample
but added no signal, as predicted by the `1.0000` caveat above.

m3 (`apps/server/src`, 13 files): `tools/types.ts`, `voice/routes.test.ts`,
`setup/crypto.ts`, `agents/reply.ts`, `roles/service.ts`, ... — no route
index, no schema, no `voice-transcription/` file. 3 of 13 are tests.

m4 (server + `--exclude-unranked`, 10 files): yet another slice
(`machines/hub.ts`, `db/schema.ts`, `stickers/service.ts`,
`authz-sweep.test.ts`, ...). 4 of 10 are tests.

Verdict on unfocused maps: **not the files a newcomer needs, and test files
crowd out roughly a quarter to two-fifths of the budget.** Without focus
inputs the tool is an arbitrary sampler, not a guide.

## 3. Focused maps for 3 real tasks

For each task the squash commit's changed files come from
`git log --format=%H --grep '^T-XXXX:' main` + `git show --stat` (code files
only; `work/`, `BOARD.md`/`NOW.md` excluded), and the "Report says it read"
list comes from the task's "Read first" section. Mentioned-files were the
"Read first" + "Allowed files" paths that exist (checked: all 13 for T-0187,
all 8 for T-0188, all 4 for T-0173 exist). Map budget 2048 everywhere.

### T-0187 (mobile sticker packs) — map f187, 12 files, 1,929 tokens

Commit `4b96bc37` changed (code): `app/settings/index.tsx`,
`app/settings/stickers.tsx` (new), `components/stickers/` (5 new files),
`lib/settings-items.ts`, `lib/stickers-api.ts`, `lib/stickers-api.test.ts`.

| File | In commit | In Read-first | In map f187 |
|------|-----------|---------------|-------------|
| `apps/mobile/src/lib/stickers-api.ts` | yes | yes | **yes** |
| `apps/mobile/src/lib/settings-items.ts` | yes | yes | **yes** |
| `apps/mobile/src/app/settings/index.tsx` | yes | no (Allowed) | **yes** |
| `apps/mobile/src/components/chat/sticker-panel.tsx` | no (spec-named it, but squash commit `4b96bc37` does not touch it; round 2 of T-0187 deleted the reload hook-up, leaving zero changes there) | yes | **yes (not a commit hit)** |
| `apps/mobile/src/app/settings/stickers.tsx` | yes (new) | no (did not exist yet) | no |
| `apps/mobile/src/components/stickers/*` (5 new) | yes (new) | no (did not exist yet) | no |
| `apps/mobile/src/lib/stickers-api.test.ts` | yes | no | no |
| `apps/mobile/src/lib/ais-api.ts` | no (pattern to copy) | yes | yes (noise for doing, useful as pattern) |
| `apps/mobile/src/lib/approvals-api.ts` | no (pattern) | yes | yes (same) |
| `apps/mobile/src/components/ais/use-ais-api.ts` | no (pattern) | yes | yes (same) |
| `apps/mobile/src/components/ais/require-ais-auth.tsx` | no (pattern) | yes | yes (same) |
| `apps/mobile/src/app/ais/index.tsx` | no (pattern) | yes | yes (same) |
| `apps/web/src/routes/StickersPage.tsx` | no (web mirror) | yes | no (web/ was not in the mapped root) |
| `docs/design/briefs/T-0187-sticker-packs.md` | no (brief) | yes | no (md files get no tags) |

Score: 3 of 8 committable code files present (the 3 that already existed and
were passed as mentioned-files — i.e. the map echoed the input). `sticker-panel.tsx`
is also in the map but the commit never changed it (see table), so it is not a
hit. Both genuinely
new files are missing by construction: the tool can only rank files that
exist. Noise: 1 unrelated test (`chat-api.topics.test.ts`), `polyfills.ts`,
`ais/limits.ts`. `--chat-files` trial c187 (stickers-api.ts as chat file,
x20 boost): the chat file itself jumps to rank 1, but the rest of the map is
unchanged noise (`machines-api.ts`, `chat-list.ts`, `auth.ts`,
`connections.tsx`, 6 unrelated tests) — the new screen/components are still
absent.

### T-0188 (mobile integrations) — map f188, 14 files, 1,984 tokens

Commit `3e30452f` changed (code): `app/settings/index.tsx`,
`app/settings/integrations.tsx` (new), `components/integrations/` (6 new
files), `lib/integrations-api.ts` (new), `lib/settings-items.ts`.

| File | In commit | In Read-first | In map f188 |
|------|-----------|---------------|-------------|
| `apps/mobile/src/lib/settings-items.ts` | yes | yes | **yes** |
| `apps/mobile/src/lib/integrations-api.ts` | yes (new) | no (did not exist yet) | no |
| `apps/mobile/src/app/settings/integrations.tsx` | yes (new) | no (did not exist yet) | no |
| `apps/mobile/src/components/integrations/*` (6 new) | yes (new) | no (did not exist yet) | no (one cousin, `components/stickers/use-stickers-api.ts`, appears as noise) |
| `apps/mobile/src/app/settings/index.tsx` | yes | no (Allowed) | no |
| `apps/web/src/routes/IntegrationsPage.tsx` | no (web mirror) | yes | no (web/ not in mapped root) |
| pattern files (`ais-api.ts`, `approvals-api.ts`, `use-ais-api.ts`, `require-ais-auth.tsx`, `app/ais/index.tsx`) | no | yes | **yes** (all 5) |

Score: 1 of 10 committable code files present. Because every file the task
creates is new, the focused map contributes nothing beyond re-listing the
"Read first" pattern files the spec already names. Noise: `welcome/name.tsx`,
`auth/OtpInput.tsx`, `attachment-native.ts`, 3 unrelated tests
(`real-store.roles.test.ts`, `topic-row.test.tsx`, `drafts.test.ts`).

### T-0173 (server voice pipeline) — map f173, 16 files, 2,127 tokens

Commit `da804c10` changed (code): `voice-transcription/pipeline.ts` (new),
`voice-transcription/pipeline.test.ts` (new), `voice-transcription/routes.ts`,
`package.json`, `pnpm-lock.yaml`; plus new `docs/EFFECT_GUIDE.md`.

| File | In commit | In Read-first | In map f173 |
|------|-----------|---------------|-------------|
| `apps/server/src/voice-transcription/routes.ts` | yes | yes | **yes** |
| `apps/server/src/voice-transcription/provider.ts` | no (explicitly untouched) | yes | **yes** (top of map) |
| `apps/server/src/voice-transcription/pipeline.ts` | yes (new) | no (did not exist yet) | no |
| `apps/server/src/voice-transcription/settings.ts` | no (untouched) | yes (via the folder) | no |
| `apps/server/src/voice-transcription/pipeline.test.ts` | yes (new test) | no | no |

Score: 1 of 3 committable source files present (`routes.ts` echoed from
mentioned-files; `provider.ts` correctly surfaced but was the file the task
did *not* need to change). The new pipeline module is missing by
construction. Noise dominates the remaining 14 slots: `logger.ts`,
`push/subscriptions.ts`, `git/routes.ts`, `topics/service.ts`, 6 unrelated
tests — none read by the worker.

### Pattern across the three tasks

The focused map is an **echo chamber with noise**: files passed as
mentioned-files reappear (boost x5), genuinely new files (the bulk of what
each task created: 5/8 for T-0187, 9/10 for T-0188, 2/3 for T-0173) cannot
appear, and the leftover budget fills with unrelated files and tests. The
spec's "Read first" list already names every useful file the map surfaced;
the map added zero files the spec had not named.

## 4. Verdict

**Recommendation: drop it** (none of: adopt in specs, adopt as MCP tool,
hand-made area maps — the last is a separate proposal this trial does not
evaluate).

Cost per task would be small (~2k tokens for the map itself at
`--map-tokens 2048`, plus the mentioned-files list the spec already carries),
and runtime is negligible (~1.3 s warm; 6.5 s cold). But the benefit is
~zero for our workload: our tasks mostly *create* files (new screens, new
API modules, new pipeline modules), and a definition-ranker cannot point at
files that do not exist yet. For the three measured tasks the map surfaced
no file the spec's "Read first" had not already named, while spending
~40-60% of its budget on unrelated files and test files. A worker handed
this map would still have to do the same exploration to find what is
missing — and worse, might trust the map and never look.

Risks seen first-hand during this trial:

- **Wrong ranking**: without focus inputs every file ranks `1.0000` and the
  map is an arbitrary sample (Section 2). With focus inputs it echoes the
  inputs. Neither mode ranks by "what matters".
- **Test-file crowding**: 25-41% of unfocused budgets, and unrelated tests
  in every focused map. There is no test-exclusion option (only
  `--exclude-unranked`, which is a no-op at uniform rank).
- **Silent empty result**: misordering CLI flags yields a valid-looking
  `(None, FileReport(...))` with zero files considered — a worker scripting
  this would get an empty map with exit code 0.
- **`--verbose` crash** and **tuple-on-stdout format**: the CLI layer is
  unpolished; any adoption needs the wrapper from Section 1 plus upstream
  fixes.
- **Stale map after merges**: not measured (single snapshots only), but the
  map has no incremental mode besides a tag cache; a map pasted into a spec
  goes stale as soon as main moves, and our specs already carry exact
  "Read first" paths maintained by the lead.

Where it *could* help (out of scope, noted for honesty): navigating
unfamiliar *existing* code with good focus inputs (chat-files + idents gave
the only differentiated ranking in the code). Our specs already do that job
with hand-picked paths, which measured strictly better here.

Measurements this verdict rests on: m1–m4, f187, f188, f173, c187 byte
counts, file lists and commit stats above; T-0187's 37M-token exploration
figure is the lead's, not re-derived.
