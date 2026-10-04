# Now

The live picture: what runs, what is next, what waits for Julio. The lead rewrites this file after every launch, merge or block, and commits it with the board. The full task list is `BOARD.md`; the rules are `CLAUDE.md` and `docs/LEAD_LOOP.md`.

Last updated: 2026-10-04, history compaction planned (Julio approved).

## Plan in progress: compact main's history (Julio, 2026-10-04)

Julio: "one commit per task from now on, stop spawning workers, when all finish, force push and continue with fresh workers on a fresh main".

1. **Launch nothing new.** Let T-0173, T-0187, T-0188 and T-0196 finish and merge through the normal loop.
2. When `lead status` shows no task in flight: stop the autopilot (`pkill -f "lead/cli.ts autopilot"`).
3. Backup: `git branch backup/main-pre-compact main` and `git bundle create ~/.zilar-lead/compact/main-pre-compact.bundle main --tags`.
4. In a fresh clone (`git clone --no-local <repo> ~/.zilar-lead/compact/clone`), run `~/.zilar-lead/compact/compact-history.sh ~/.zilar-lead/compact/clone`. Verify in the clone: `git diff --quiet main compact-test`, and for every tag the old `^{tree}` equals the tree of its new commit (`tag-map.txt`). The 2026-10-04 test run gave 1,102 to 223 commits.
5. Delete the test ref `compact/history-test`, fetch the clone's result into the repo, then push with a lease: `git push --force-with-lease=main:<old main sha> origin <new sha>:main`, and force-push each re-pointed tag `v0.1.0`..`v0.1.13`. Leave `t0113-orig`, `archive/*` and `spike/T-0118-push` alone.
6. Move the main checkout onto the new main (the tree is identical), check `git log --oneline | wc -l`, run `pnpm gate` on main.
7. Restart the autopilot. Launch T-0200 (`lead merge` squashes each task into one commit) first, alone; after it merges, T-0194 and T-0195 on MiniMax M3, then the rest of the queue.

## Running (max 4)

| Task | What | Step | Note |
| --- | --- | --- | --- |
| T-0173 | Effect 4.0 spike on the server voice transcription pipeline | pre-review | branch predates T-0197: rebase before any fix round |
| T-0187 | Mobile: manage sticker packs | unblock round | rebased by the lead (PREREVIEW.md gate noise); needs phone:smoke before merge |
| T-0196 | The doctor: a Muse session that audits main after merges | coding | spec re-checked, full paths |

## Next, in order

0. T-0200 squash merge (after the compaction, alone)
1. T-0194 guard tests for the Android and Hermes pitfalls (MiniMax M3 trial)
2. T-0195 audit of web vs mobile, feeds the specs of T-0189 and T-0190 (MiniMax M3 trial)
3. T-0191 sticker editor and Telegram import (after T-0187)

## Blocked or waiting for Julio

- T-0186 notification settings: needs the server push work (T-0172), not approved.
- Phone checks: the Aa press on a voice note, the silent model load after restart, transcribe with real speech, the new settings screens. The last APK was built but not installed (the phone refused the USB install).
- Release: everything merged since v0.1.13 reaches the live web only with the next release.

## Recent events

- 2026-10-04: merged T-0188 (mobile owner integrations; smoke PASS, non-owner view checked on the emulator). T-0187 will conflict on `settings-items.ts` and `settings/index.tsx` at merge: use the conflict procedure.

- 2026-10-04: Julio: easy exact tasks move to `minimax-coding-plan/MiniMax-M3` (his subscription) to spend less on Muse; pre-reviews stay on Muse. Trial on T-0194 and T-0195; `lead switch-model` back to Muse if one needs more than 2 fix rounds.
- 2026-10-04: merged T-0199 (pre-review findings outside the Allowed files are follow-ups: no automatic round, named in the PACKET READY tag). Autopilot restarted on it. Launched T-0196.
- 2026-10-04: merged T-0198 (state writes re-read the file first). The autopilot was restarted on it; launching no longer needs it paused (verified: T-0199 survived a tick).

- 2026-10-04: power and internet cut in Barcelona; every worker session failed (`getaddrinfo ENOTFOUND api.meta.ai`) and was resumed with its uncommitted work.
- 2026-10-04: all workers stopped and relaunched under the loop with re-verified specs; old branches kept as `archive/T-0173`, `archive/T-0187`, `archive/T-0188`, `archive/T-0197`.
- 2026-10-04: merged T-0192 (web: people by @handle in search) and T-0197 (old name out of the smoke script, reviewer files ignored).
