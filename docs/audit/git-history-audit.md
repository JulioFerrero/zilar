# Git history audit (2026-10-14)

Read-only audit. No history was changed. Scratch files and two bare test clones are in `/Users/julio/.claude/jobs/ab934c68/tmp/gha/`. Main had 3,083 commits when I started (3,086 at the end).

Note: while I worked, the lead cleaned up git ("git cleanup" in NOW.md). Branches went from 375 to 4, worktrees from 23 to 5 and commits in all refs from 5,758 to 3,669. The "start" numbers below are from my first commands.

## Summary for Julio

- The history is not big in bytes. A fresh clone of `main` is 60 MiB (GitHub says 61 MB). Your own `.git` is 193 MiB only because of leftovers.
- The history is big in commit count: 3,083 commits in 18 days. Only 1,186 (38%) are real task merges. 1,694 (55%) are lead bookkeeping: specs, NOW, board. In the last 100 commits it is 68 of 100.
- Bookkeeping does NOT cause extra deploys. Coolify only watches code paths: 223 code commits gave 227 deploys since 10-11, and 448 of 671 commits (67%) deployed nothing. CI also skips `work/` and `docs/`.
- One workflow does run on every push: "Code map" (959 runs in 4 days, 386 cancelled, full-history checkout). That one is real waste.
- Task merges are clean: one squashed commit per task, with the worker commits listed in the body. But 57% of the subjects are longer than 72 characters (max 217) and the prefixes drift (`NOW`, `lead: NOW.md`, `work: NOW.md`).
- Size comes from images: 208 screenshots and icons are 41.6 MiB, 70% of the clone. 179 of them (34.4 MiB) are still in HEAD. They were added in the first week; almost none since.
- Next step (no rewrite): (1) `git reflog expire` + `git gc` to take `.git` from 193 to about 65 MiB; (2) stop committing NOW.md, batch specs per wave, shorten merge subjects; (3) throttle the Code map workflow. Do NOT rewrite history now: it would gain at most 35 MiB of clone and break 4 live worktrees, the lead state, 92 cited hashes and 14 tags.

## 1. Size

Commands: `git rev-list --count main`, `git rev-list --count --all`, `git count-objects -vH`, `du -sh .git`, `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(objectsize:disk) %(rest)'`, `git clone --bare --no-local` into the scratch folder.

| Measure | Value |
|---|---|
| Commits on main | 3,083 (first 2026-09-27, 18 days) |
| Commits in all refs (start / end) | 5,758 / 3,669 |
| Loose objects | 6,201 files, 67.6 MiB |
| Packs | 8 files, 108.9 MiB, 82,620 objects |
| `.git` on disk | 195M (start), 193M (end) |
| Objects reachable from refs | about 39k of about 89k. The rest is garbage. |
| Unreachable commits | about 9,050. 3,001 dangling tips: 2,376 with task-id subjects (old copies of worker commits, from before `git rebase main`), 330 "Merge branch 'main' into task/..", 193 stash/WIP |
| Reflog (HEAD) | 3,583 entries (keeps the garbage alive) |
| Fresh bare clone, main only | 60.1 MiB pack (36,176 objects) |
| Fresh bare clone, all refs | 64.1 MiB |
| Same clone after `repack -adf --window=250 --depth=50` | 57.0 MiB (so packing is not the lever) |
| GitHub `size` | 62,658 KB |

What is in the 59 MiB of a main-only clone:

| Part | MiB | Share |
|---|---|---|
| Images (png, jpg, hdr, webp), 208 blobs | 41.6 | 70% |
| Code and config, 10.8k blobs | 8.1 | 14% |
| `work/T-*.md` task files, 3,084 versions | 5.3 | 9% |
| `docs/` | 0.9 | 2% |
| BOARD.md (2,127 versions) + NOW.md (377) + lockfile (84) | 0.6 | 1% |
| Commits + trees | 2.7 | 5% |

Images by folder (main clone): `apps/mobile` 22.2 MiB (55 files), `work/screenshots` 11.1 (96), `docs/screenshots` 4.0 (36), `apps/site` 1.7, `assets/brand` 1.6, `apps/web` 0.9.

Top 25 blobs (all PNG except one HDR): 20.1 MiB, 34% of the main clone. Top 100: 34.2 MiB, 58%. Only 6 blobs are over 1 MiB. Largest ones:

| MiB | Path | First commit | In HEAD |
|---|---|---|---|
| 1.76 | apps/mobile/screenshots/chat-reply-light.png | b446305f3 (09-28) | yes |
| 1.74 | apps/mobile/screenshots/auth-code.png | bb076dd7a (09-28) | yes |
| 1.67 | apps/mobile/screenshots/chat-light.png | a0a040478 (09-27) | no |
| 1.35 | apps/mobile/screenshots/chat-ana-light.png | b446305f3 (09-28) | yes |
| 1.18 | apps/mobile/screenshots/chat-ai-cards-light.png | a0a040478 (09-27) | no |
| 1.13 | apps/site/public/textures/studio.hdr | 47d513cdd (10-02) | yes |
| 0.80 | assets/brand/icon-bleed.png | 47d513cdd (10-02) | yes |
| 0.80 | apps/mobile/assets/images/icon.png | 47d513cdd (10-02) | yes |
| 0.78 | assets/brand/icon.png | 47d513cdd (10-02) | yes |
| 0.76 | apps/mobile/assets/images/icon.png (older version) | e1beeea16 (09-27) | older version |
| 0.72 | apps/mobile/screenshots/T-0048/04-voice.png | 4999af11f (09-28) | yes |
| 0.64 | apps/mobile/assets/images/android-icon-background.png | 47d513cdd (10-02) | yes |

The other 13 of the top 25 are more `apps/mobile/screenshots/*` files (0.5 to 0.6 MiB each). Of the 25, 16 are still in HEAD as the exact same blob. 9 are only in history (4 deleted files and 5 older versions). All were first committed between 09-27 and 10-02.

Binaries and generated files:
- No APK, AAB, IPA, zip, mp4, font or database file exists anywhere in history (scanned by extension over all reachable blobs).
- Nothing that looks like a committed secret: the only matching paths are `.env.example` files (`apps/server/`, `deploy/`, `deploy/baremetal/`, `infra/`) and `apps/server/src/agents/memory/secrets.ts` and its test. I did not read their contents.
- Images still in HEAD: 179 files, 34.4 MiB. Image blobs that exist only in history: 29 blobs, 7.1 MiB. All blobs: 42.1 MiB in HEAD, 14.4 MiB only in history.
- Screenshots added per day (commits that add files under the three screenshot folders): 09-27 to 09-30 almost all, then 2 commits on 10-14 (`docs/screenshots`). Growth has stopped. README.md uses 5 of the `docs/screenshots/*` files, so those must stay.
- Lockfile: `pnpm-lock.yaml` has 85 versions, 19.6k changed lines (1.2% of all churn), 0.17 MiB in the clone. Fine.
- Drizzle snapshots: 92 file touches and 277k changed lines (16.6% of all line churn!), but they compress to almost nothing (0.02 MiB) and T-0855 deleted them on 10-10. Fine now.
- HEAD tree: 3,988 files, 65.4 MiB raw. `work/screenshots` alone is 97 files, 12.7 MiB.

## 2. Commit mix

Method: every main commit is classified by what it touches. "Task merge" = body starts with `Squashed from` (1,186 commits). "Old style" = task commits before the squash flow (code, not squashed). "Bookkeeping" = touches only `work/`, `docs/`, `CLAUDE.md`, `AGENTS.md`.

| Class | Commits | Share | Avg files | Avg lines added / removed |
|---|---|---|---|---|
| Task merge (squashed) | 1,186 | 38.5% | 8.9 | 448 / 447 |
| Old-style task commit (09-27 to 10-05) | 194 | 6.3% | 24.8 | 2,525 / 112 |
| Spec / Specs | 948 | 30.7% | 1.8 | 84 / 0 |
| NOW | 357 | 11.6% | 1.1 | 10 / 1 |
| Board | 249 | 8.1% | 1.0 | 2 / 0 |
| Review / dropped / approved | 13 | 0.4% | 1.8 | 49 / 1 |
| Other `work/` and `docs/` | 127 | 4.1% | 1.9 | 84 / 5 |
| Lead code commits (reverts, hotfixes) | 9 | 0.3% | 10.7 | 387 / 140 |

Bookkeeping total: 1,694 (54.9%). If you hide it, `git log` shows about 1,390 commits.

Last 7 days (10-08 to 10-14, 2,069 commits): 876 task merges (42.3%), 678 spec (32.8%), 181 NOW (8.7%), 239 board (11.6%), 8 review, 85 other work/docs, 2 other. Bookkeeping is 57.6%.

Since the squash flow began (10-05): 2,857 commits for 1,186 merges, so every task costs 2.4 commits on main, of which 1.4 are bookkeeping (1,663 commits).

Commits per day:

| Day | 09-27 | 09-28 | 09-29 | 09-30 | 10-01 | 10-02 | 10-03 | 10-04 | 10-05 |
|---|---|---|---|---|---|---|---|---|---|
| Commits | 18 | 50 | 55 | 29 | 20 | 10 | 31 | 13 | 185 |

| Day | 10-06 | 10-07 | 10-08 | 10-09 | 10-10 | 10-11 | 10-12 | 10-13 | 10-14 |
|---|---|---|---|---|---|---|---|---|---|
| Commits | 479 | 124 | 384 | 538 | 387 | 212 | 321 | 109 | 118 |

Other facts: no merge commits on main (linear). One revert, no fixup/WIP commits. All 3,086 commits have the same author (`~Hulio`), so lead and workers cannot be told apart. Lines of churn: 1.67M total; code and config 66%, drizzle snapshots 17%, `work/T-*.md` 12%, `docs/` 2%, lockfile 1%.

## 3. Message quality

Task merge subject length (characters): average 82.8; 57% over 72; 35% over 100; max 217. Bookkeeping subjects are short (average 21 to 29), but they say little.

`git log --oneline` in the last 40 commits: 17 are Spec/NOW lines. You must scan past them to find the real changes.

Prefix drift (same meaning, different words):
- NOW: `NOW` 165, `lead: NOW.md` 96, `work: NOW.md` 55, `lead: update work/NOW.md` 12, `Board + NOW` 10.
- Spec: `Spec(s) T-N:` 744, `work: T-N spec` 99, `lead: spec(s)` 47, `T-N spec:` 11.
- Board: `Board` 221, `BOARD` 40, `board` 5.
- 71 commits have the exact subject `lead: NOW.md`.
- 28 commits use `feat:/fix:/chore:` style. The rest do not.

Examples:

| # | Subject | Verdict |
|---|---|---|
| 1 | `T-1415: Web chat menu: icons on Topic info, Pinned messages, Media, Search, Chat background` | Good: task id, what changed, one line |
| 2 | `T-1404: lead forget: drop finished tasks from the lead state` | Good: short, clear |
| 3 | `Revert T-1198 code (GET /api/chats answered 500 in production); keep migration 0048 and rows.ts (table already live)` | Good: says why |
| 4 | `Specs T-1414..T-1417: task card protocol, chat menu icons, unread divider, runner desk ops` | Good batch message |
| 5 | `T-0095: mobile kill switch (stop / resume from AI list)` | Good |
| 6 | `T-1411: AI computers install like the rest of Zilar: desk-agent + desk-egress compose services (off behind DESKS_ENABLED / profile desks), ./zilar host-setup (pinned gVisor via reload, 4 GB slice), doctor + init, docs` | Bad: 217 characters, the body is in the subject |
| 7 | `T-1409: Desk tools (bash, read, write, edit, grep, glob, git) in the agent loop via Hands for computer_mode=cloud; ais.computer_mode (0057)` | Bad: about 140, two topics joined with `;` |
| 8 | `NOW: 6 workers running` | Bad: a status note, not a change |
| 9 | `lead: NOW.md` (71 times, identical) | Bad: cannot tell them apart |
| 10 | `Board: T-1019` (also `Board: T-0994`, `Board: T-0985`; 93 like this) | Bad: does not say what moved |
| 11 | `T-1338: dropped (superseded by T-1341)` | Misleading: `T-` prefix like a merge, but it only edits a task file |
| 12 | `T-0201: review, approved` | Same problem |
| 13 | `T-1208: wording`, `T-1095: restore the Review heading` | Bad: no context |
| 14 | `Spec T-1234 (link previews server + web)` (twice, same subject) | Bad: duplicates |
| 15 | `remove every comparison to another messenger from docs, code comments and task files ...; fix the image workflow action versions; drop an unused helper ...` | Bad: no task id, three topics in a 190 character subject |

The squash body is good: `Squashed from task/T-1411-...:` and then one line per worker commit (average 2.1, max 15 in the newest 400). That detail belongs in the body and is already there.

## 4. Refs and worktrees

| Ref | At start | At end |
|---|---|---|
| Local branches | 375 | 4 (`main`, 3 live `task/*`) |
| Worktrees | 23 | 5 |
| Remote branches on GitHub | 1 (`main`) | 1 |
| Stale local remote-tracking refs | `origin/spike/T-0118-push` (gone on GitHub) | same |
| Tags | 15 local, 14 on GitHub | same |
| Stashes | 0 | 0 |

At start, 5,758 − 3,083 = 2,675 commits lived only on those 375 branches. I did not record their names, so I cannot split them into merged, dropped and stale. The cause is visible, though: `lead merge` removes the worktree and force-deletes the branch (`packages/devtools/src/lead/merge.ts:221` and `:225`), so only tasks that never went through `lead merge` stayed behind (dropped, superseded, old-style, abandoned). Of the 1,374 task ids found in dangling tips, 1,350 are on main, so the 375 branches were almost all leftovers of work that did land.

Worktrees now: `zilar-doctor` and `zilar-phone-build` (both detached, used by tools), `zilar-T-1396`, `-T-1414`, `-T-1417`, `-T-1418` (live task branches). None looks abandoned.

Tags: `v0.1.0` to `v0.1.13` (annotated, all from 10-02 and 10-03) and a local-only `t0113-orig`. GitHub has 0 releases. The `android-release.yml` workflow runs on `v*` tags. The repo is public with 0 forks, 0 stars, 0 watchers, 1 page view in 14 days. GitHub counts 25,467 clones from 2,221 unique cloners in 14 days; that is almost certainly CI runners and Coolify deploys, but I cannot prove it. `main` is not branch-protected.

## 5. `work/` and `docs/`

| Item | Number |
|---|---|
| Task files in `work/` | 1,414 files, 13.9 MB raw (average 9.9 KB, largest 29 KB), 5.3 MiB in the clone |
| `work/BOARD.md` | touched by 2,126 commits (69% of all). Now 1,432 lines, 200 KB |
| `work/NOW.md` | touched by 377 commits. Now 2,834 lines, 240 KB. It grew like a log, not a status page |
| Line churn from `work/` | about 233k of 1.67M (14%): task files 12.1%, other 1.3%, BOARD 0.3%, NOW 0.2% |
| Line churn from `docs/` | 34k (2.1%) |
| Commits that touch only `work/` or `docs/` | 1,694 (55%) |
| Commits that only edit an existing task file (spec/review fix-ups, since 10-05) | 36 |
| `work/screenshots` | 97 files, 12.7 MiB in HEAD |

Bookkeeping is cheap in bytes (about 6 MiB) and expensive in commits. Since 10-05 the non-squashed `work/`-only commits are: 460 add new files (new specs), 575 edit existing files (BOARD/NOW mostly), 389 add and edit together (spec + board row).

## 6. Problems, ranked

1. **Bookkeeping commits are 55% of main (68 of the last 100).** Each spec, each NOW update and each board move is its own commit and its own push. The runner does it by design (`docs/LEAD_HANDOFF.md:23-26`: `spec` and `file` lines "commit and push"). This is what makes `git log` feel huge.
2. **Hot files on main cause races.** BOARD.md is in 69% of all commits and NOW.md is a growing log. `lead merge` stops if anything but BOARD.md was pushed during the gate (`merge.ts:201-212`; `docs/LEAD_HANDOFF.md:34`, hit in T-0602). That rule exists only because bookkeeping lives on main.
3. **Merge subjects carry the whole story.** `${task}: ${summary}` is committed as given (`merge.ts:194`) and nothing limits the length of `--summary` (`cli.ts` `runMerge`). Result: 35% over 100 characters.
4. **Inconsistent prefixes and non-merge commits using the `T-NNNN:` prefix.** Filtering by prefix is unreliable.
5. **"Code map" workflow runs on every push.** `.github/workflows/code-map.yml:4-7` has no filter and uses `fetch-depth: 0` (full history). 959 runs between 10-10 and 10-14, 386 cancelled, about 100 s each when it succeeds. Free on a public repo, but noisy, and it gets slower as history grows.
6. **Local `.git` is 3x larger than needed.** 193 MiB vs about 65 MiB. Cause: about 9,050 unreachable commits from rebased and deleted worker branches, 6.4k loose objects, 8 packs, a 3.5k-line reflog, no regular gc.
7. **Images are 70% of the clone.** 179 screenshots and icons in HEAD, mostly from the first week. No guard stops a new 2 MB PNG (`.gitignore` has no screenshot rule; the gate has no size check).
8. **One author for everything.** Cannot use `git log --author` to hide lead commits.
9. **Pre-squash era (09-27 to 10-05):** 194 commits averaging 24.8 files and 2,525 added lines, with generated drizzle snapshots and screenshots inside. It cannot be fixed without a rewrite and it is only 6% of commits.

Checked and fine:
- **Deploys.** Coolify app `zilar-chat` has `watch_paths` = `apps/server/**`, `apps/web/**`, `packages/**`, `deploy/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, with auto-deploy on and shallow clone. Since the app was created (10-11 08:23 UTC): 671 commits, 223 touch a watch path, 227 deployments (4 more than commits; at least one was started by API). So 448 commits (67%) cause no deploy, including all Spec/NOW/Board commits. 60 task merges that touch only `apps/mobile` etc. do not deploy either. The 10 most recent deployed commits were all task merges. CI (`ci.yml:12`) also has `paths-ignore: work/**, docs/**, **/*.md`.
- Wasted deploys do exist in another form: several merges in a burst deploy one by one (4 deploys in 2 minutes on 10-13 at 21:20 to 21:22, each build takes about 1.5 to 3 minutes). Two deploys failed today (T-1409, T-1410, then the T-1412 hotfix). This is a merge-rate question, not a history question.
- Merge flow (`packages/devtools/src/lead/merge.ts`): `git rebase main` in the worktree (`:136`), gate, `git merge --squash` (`:180`), BOARD.md row moved into the same commit (`:184-194`), `push origin main` (`:213`), `worktree remove` (`:221`), `branch -D` (`:225`). One squashed commit per task, no merge commits. `lead batch merge` uses the same `mergeTask`.
- Reverts: 1. WIP or fixup commits: 0. Lockfile churn: small. Generated drizzle snapshots: removed.

## 7. Recommendations

### A. Going forward (no history rewrite)

| # | Change | Where | Effect |
|---|---|---|---|
| A1 | Clean the local repo: `git remote prune origin`, `git tag -d t0113-orig`, `git reflog expire --expire=now --all`, `git gc --prune=now`. Run it when `lead status` shows no merge or gate running (use `--prune=1.day.ago` if workers are mid-commit). Then `git maintenance start`. | your shell | `.git` 193 to about 65 MiB (measured with a bare clone of all refs: 64.1 MiB). No commit changes. |
| A2 | Stop committing `work/NOW.md`. Add `/work/NOW.md` to `.gitignore` and `git rm --cached work/NOW.md` once. Keep it as a local file, or publish it on the lead's artifact page. | `.gitignore`, `docs/LEAD_LOOP.md`, `CLAUDE.md` ("Rewrite `work/NOW.md` after every launch ... and commit it") | Removes 357 commits (12%) and the 240 KB log. |
| A3 | Commit specs with the task, not on main. `lead launch` already makes the worktree; let it create the spec file there, so the spec, the code and the Review land in one squash commit. For specs that wait, keep one commit per wave (`Specs T-A..T-B: ...`, 62 already exist) instead of one per spec (744). | `~/.zilar-lead/runner/runner.sh` (`spec` and `file` lines), `packages/devtools/src/lead/launch.ts`, `docs/LEAD_HANDOFF.md` | Removes about 650 to 900 commits. |
| A4 | Do not hand-edit BOARD.md. `lead merge` already moves the row inside the merge commit (`board.ts`, `merge.ts:173`). Add the Active row in the same commit as the spec wave, or generate the board from task front matter (`plan-page/collect.ts` already reads task statuses). | `packages/devtools/src/lead/board.ts`, `launch.ts` | Removes 249 board-only commits. |
| A5 | Estimated result: 3,083 commits would have been about 1,400 to 1,600 (about 50% less). Last 7 days: 2,069 would be about 1,000. | | |
| A6 | Subject convention, in `docs/LEAD_LOOP.md` and `AGENTS.md`: `T-NNNN: <verb phrase, 72 characters max>` for merges only; `lead: <what>` for everything the lead commits (`lead: spec T-1412`, `lead: specs T-1409..T-1411`, `lead: now`); `docs: <what>`. Put detail in the body. Enforce in `runMerge` (`packages/devtools/src/lead/cli.ts`): refuse `--summary` over 72 or 100 characters, and refuse a summary that starts with `wording`/`review`. Add a trailer `Task: T-1411` in the body at `merge.ts:189`. | `cli.ts`, `merge.ts`, docs | Fixes problems 3 and 4. |
| A7 | Separate authors: lead commits as `Zilar Lead <...>`, workers as `Zilar Worker <...>` (`GIT_AUTHOR_NAME` in the runner and in the worker launch). Then `git log --author='Zilar Worker'` is the compact view. | runner, `launch.ts` | Fixes problem 8. |
| A8 | Compact view today, no changes: `git log --oneline --grep='^Squashed from'` (about 1,190 lines, task merges only) or `git log --oneline --invert-grep --grep='^NOW' --grep='^Specs\? ' --grep='^Board' --grep='^BOARD' --grep='^lead:' --grep='^work:' --grep='^[Dd]ocs\?:'` (1,525 lines, also shows the old-style commits). Put one of them in `docs/LEAD_HANDOFF.md` as an alias (`git config alias.tasks ...`). | docs | Immediate. |
| A9 | Code map: replace the `push` trigger with `schedule` (every 30 minutes) plus `workflow_dispatch`, or add `paths-ignore` for `docs/**` (keep `work/BOARD.md` and `work/T-*.md`, because `plan-page/collect.ts` reads them). | `.github/workflows/code-map.yml:4-7` | 959 runs per 4 days down to about 190. |
| A10 | Images: stop new screenshots entering git. Add `work/screenshots/` and `apps/mobile/screenshots/` to `.gitignore`, keep `docs/screenshots/` (README uses it), and add a gate check that fails when a new file over 300 KB is added outside `assets/` (`packages/devtools/src/gate/`). Compress the 179 images in HEAD with `oxipng`/`pngquant` in one normal commit (typical 50 to 70% smaller). This does not shrink the clone, because the old blobs stay in history. | `.gitignore`, `gate/` | Stops growth. |
| A11 | Prune routinely: let `lead forget` (T-1404) also run `git worktree prune` and delete branches of tasks marked merged or dropped; run `git fetch --prune` in the runner. | `packages/devtools/src/lead/forget.ts` | Stops the 375-branch pile. |
| A12 | Git LFS: not recommended. It would move the same bytes elsewhere, adds a service to every worker, and does nothing for the history already there (Coolify has `is_git_lfs_enabled: true`, but nothing in the repo uses LFS). | | |

Deploy-side idea (optional): if several merges land within a few minutes, Coolify builds each. A small debounce in the merge runner (merge a wave, push once) would give one deploy per wave. `lead batch merge` exists but runs without the gate; weigh that first.

### B. Rewriting existing history

Facts that make a rewrite costly right now:
- Workers are running (NOW.md said 6, then 4; 4 task worktrees exist now). They, plus `zilar-doctor` and `zilar-phone-build`, are based on old main hashes. Each would need `git rebase --onto`.
- `~/.zilar-lead/state.json` stores worktree and HEAD hashes (`packetReadyForHead`), and `lead merge` compares trees against the branch. Both break until rebuilt.
- 92 commit hashes are cited in task files and docs (74 resolve to real commits). They would point nowhere.
- 14 tags `v0.1.0` to `v0.1.13` and the `android-release.yml` tag trigger would need re-tagging.
- Coolify deploys `HEAD` of `main` with a shallow clone, so it would just build the new tip (the file contents are the same, so Docker layers should mostly cache). `/health` would show a new commit hash. A force push to `main` is allowed (no branch protection).
- Public repo: 0 forks and 0 stars, so outside breakage is unlikely today. Old commits stay reachable on GitHub by SHA until GitHub runs its own gc. No secrets were found, so nothing needs hiding.
- Any rewrite changes every hash from the first touched commit on. For the screenshot options that is the very first commits, so all 3,086 hashes change.

| Option | Clone size (main) | Log | What breaks | Verdict |
|---|---|---|---|---|
| B0. Only A1 (gc) | 60 MiB, unchanged. `.git` 193 to about 65 MiB | unchanged | nothing | Do now |
| B1. `git filter-repo` drop history-only images (29 blobs, 7.1 MiB) | about 53 MiB (-12%) | unchanged | all hashes | Not worth it |
| B2. `filter-repo` drop all screenshot folders from all history (`apps/mobile/screenshots`, `work/screenshots`, `docs/screenshots`, 175 blobs, 34.7 MiB), keep the README images | about 26 to 28 MiB (-55%) | unchanged | all hashes, README links, old task reports lose evidence | Only if clone size matters later |
| B3. Squash everything before 10-05 (226 commits, old style) into one "import" commit | 50 to 58 MiB (history-only blobs total 14.4 MiB, most from week 1) | 225 fewer lines | all hashes, 14 tags, the first-week task history | No |
| B4. Squash all history to one commit | about 44 MiB (-27%; HEAD blobs are 42.1 MiB) | 1 commit | everything: blame, provenance, 92 cited hashes, tags | No |
| B5. No rewrite, new orphan branch `compact` published only for readers | n/a | compact | nothing, but a second branch to keep in sync | Not needed if A2 to A8 are done |

Numbers for B1 to B4 are estimates from the measured pack composition (a bare clone of main, no `filter-repo` installed on this machine). The aggressive repack test showed 57.0 MiB vs 60.1, so repacking alone gives about 5%.

**Recommendation.** Do not rewrite. The history is 60 MiB and linear, and a rewrite would cost a quiet day plus hash and tag work to save at most 35 MiB. What looks "super big" is the count of bookkeeping commits, and A2 to A8 fix that going forward at no risk. Run A1 today (193 MiB to about 65 MiB locally). If clone size ever matters, revisit B2, on a day with no running tasks, after A10 has stopped new images. Old noise stays in the past; use A8 to look at it.

## 8. Commands used (all read-only)

`git rev-list --count`, `git count-objects -vH`, `git log --numstat`, `git log --grep`, `git for-each-ref`, `git worktree list`, `git cat-file --batch-check`, `git ls-tree -r -l HEAD`, `git fsck --dangling --no-reflogs`, `git log --find-object`, `git clone --bare --no-local` (into scratch), `git repack` (in the scratch clone only), `gh run list`, `gh api repos/JulioFerrero/zilar/...` (releases, traffic, size), Coolify MCP `get_application` and `deployment list_for_app` (read only, nothing revealed), and `packages/devtools/src/lead/merge.ts`, `cli.ts`, `batch/merge.ts`, `.github/workflows/*.yml`.
