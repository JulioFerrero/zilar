# Now

The live picture: what runs, what is next, what waits for Julio. The lead rewrites this file after every launch, merge or block, and commits it with the board. The full task list is `BOARD.md`; the rules are `CLAUDE.md` and `docs/LEAD_LOOP.md`.

Last updated: 2026-10-05 ~14:40 local, after merging T-0223 and launching T-0225; earlier merged T-0222, T-0211 (Julio: "the resize is working great") and T-0221, and launching T-0222. Main checkout got `pnpm install` (T-0211 added Ink/React; the autopilot could not start without it). Julio's watcher reopened on the new version and floated; test window closed.

Autopilot restarted with `ZILAR_REVIEW_MODEL=meta/muse-spark-1.3-contributor` (free Muse still 429 at ~12:05). When the free listing answers again (`opencode2 run -m "opencode/muse-spark-1.3-contributor-free#low" "Reply OK."`), restart it without the variable.

FREE MUSE RATE-LIMITED since ~10:43 UTC (429 "Rate limit exceeded" for every session). Manual fallback in place (tested, keeps the session's context): `opencode2 api session.switchModel --param sessionID=S -d '{"model":{"providerID":"meta","id":"muse-spark-1.3-contributor","variant":"low"}}'`, then `lead reply` (worker) or `opencode2 api session.prompt` (pre-review). Done this way: T-0212 worker and pre-review, T-0215 pre-review. T-0216 automates it in the autopilot (Julio: "use free Muse as much as possible, switch to my paid one if it fails, without restarting"); launched. T-0215 adds `ZILAR_REVIEW_MODEL` for the doctor.

Julio's watcher now runs in a floating Ghostty window. Julio approved the `lead watch` mockup (artifact https://claude.ai/artifact/8QujyLaobor35XDKHr7ZZG, copy in `docs/design/briefs/T-0211-lead-watch-mockup.html`).

Emulator: run only the `galena` AVD (never `bicing_plus`, Julio's). Its DNS failed today (smoke screenshots stuck on the boot spinner); start it with `-dns-server 8.8.8.8,1.1.1.1`.

Token saving check: the first fresh-session fix round (T-0191 round 1) started at ~21k context instead of the old session's ~158k per step.

Known issue: `pnpm install` flips two `transitivePeerDependencies` entries (`bufferutil`, `utf-8-validate`, under the `metro-runtime` block of `pnpm-lock.yaml`) between worktrees: T-0203 added them, T-0204 removed them. Harmless, but it puts lockfile noise in every task. Later: an audit task to find why (pnpm version or install order).

Models (Julio, 2026-10-05): default `opencode/muse-spark-1.3-contributor-free`; MiniMax M3 only for the easiest exact tasks; billed `meta/muse-spark-1.3-contributor` is the fallback if the free listing hits limits.

## Running (max 6, at most 3 mobile; Julio 2026-10-05)

Emulator QA now goes to a Sonnet subagent ("android emulator expert", Julio's request): it builds, taps, screenshots and reports, never edits files. Run 1 done: T-0189, T-0212, T-0213, T-0218 PASS on a mock build, no crash; layout issues (routine row squeeze on Delete confirm, Activity header/icon, "Show all" under the gesture bar, version date cut) → T-0229 (written, launches after T-0219). Run 2 done (T-0219 PASS; keyboard + stale list → T-0230, merged). Run 3 done (T-0228: channel Private/Public and handle checks PASS; the sheets sit under the keyboard and mock create throws by design → T-0234). Julio: never wait for the QA subagent; merge on code review, QA findings go to a polish task.

| Task | What | Step | Note |
| --- | --- | --- | --- |
| T-0238 | Web: Chat folders page, reorder, folder editor dialog, rail New/Edit keys | coding | Telegram brief b, decision 4; also fixes the rail tablist nit |
| T-0242 | ui-tokens follow-up: dot grid values from the package, drift tests tightened | coding | mobile chat already draws the dot grid (`chat-background.tsx`); the audit compared an unused CSS var |
| T-0233 | Mobile: floating bottom bar (Chats, AIs, Settings, Profile), search well, Profile tab | pre-review | Telegram brief a, d; uses `expo-router/ui` headless tabs |

Merged: T-0240 (`packages/ui-tokens`, drift tests; main got `pnpm install`). Next UI kit step: web kit P1 + React Cosmos. Merged: T-0241 (mobile mention chips; "mine" look only visible in the real app, `me` is unset in mock). Merged: T-0227 (mobile @mention picker; QA run 4 PASS on a mock build: picker above the input, AI badge, self excluded, filter, select, overwrite keeps typed text, no picker in DMs; screenshots in the job tmp `qa4/`; the mock Dev team detail lacks Dani/Rubén, mock data only; follow-ups: channel feed mentions, received-mention highlight). Merged: T-0239 (web hides blocked people's group/channel messages; Blocked page null-handle fix). Block follow-ups: chat list previews/unread from blocked people, stale comment `apps/server/src/blocks/routes.ts:74`, mobile block UI. Merged: T-0237 (web folders from the server, chips + left rail; lead checked the rail in mock mode at 1440x900). Merged: T-0236 (UI kit audit, `docs/audit/ui-kit-audit.md`; next `packages/ui-tokens`, web kit + Cosmos, mobile kit with the react-native-web fallback, then migrations per area). Merged: T-0235 (web block/unblock + Blocked people page; 2 nits deferred: unblock error sentence, mock self-block). Merged: T-0232 (chat_folders server, migration 0040, clean first pre-review). Merged: T-0171 (block users server, after lead round 1). Queued: T-0234 (create sheets keyboard + mock create, after T-0233). Lead TODO: Docker compose rehearsal for T-0172 (push-deploy.test.sh already PASS 25/25).

Merged: T-0228 (public groups/channels), T-0230 (tool sheet keyboard), T-0172 (push component host), T-0231 (folder matcher), T-0225 (doctor accepts `CLAUDE.md` in lead commits), T-0224 (doctor in-place fallback; autopilot restarted), T-0226 (`ZILAR_SMOKE_MOCK=1 pnpm phone:smoke <ref>`: mock build, emulator only, leaves `.zilar-phone/commit` alone), T-0219 (tool Run/Revert/Delete; QA run 2 PASS, keyboard and stale-list issues → T-0230), T-0229 (AI screen layout fixes). Free slot (6th): block users web UI once T-0171 merges. Next: received mentions highlighted in mobile bubbles (after T-0227); New channel members step.

Merged: T-0222, T-0223 (docs sync: FEATURES 14 rows, parity roadmap state, README M5). Doctor flagged the lead's `CLAUDE.md` edit (d70f6d36) as must-fix; Julio chose "keep it, allow lead edits": `CLAUDE.md` line 10 updated (92190c62), T-0225 updates the doctor prompt. Doctor stalled twice on 429; lead switched it by hand both times until T-0224 merges.

First live `LEAD: FALLBACK`: T-0220's pre-review (free 429 → paid, same session) worked. T-0220 merged; autopilot restarted.

Merged since the last update: T-0214 (New group sheet), T-0216 (in-place fallback; autopilot restarted WITHOUT `ZILAR_REVIEW_MODEL`: new sessions start on free Muse and switch on a 429), T-0218 (tool detail sheet, read only).

## Next, in order

- Julio 2026-10-05 (chat background): dot grid on BOTH web and mobile. Already true: mobile chat draws it with an SVG pattern (`apps/mobile/src/components/chat/chat-background.tsx`); T-0242 only takes its numbers from `packages/ui-tokens`. Later feature in the plan: custom chat backgrounds (images or dots in different colours), web first.

0. Julio (2026-10-05, Telegram screenshots): folders (All/Personal/AIs/Work) fully editable and configurable like Telegram; AIs and the header options move to a floating bottom tab bar; redesign Settings and Profile. Today folders are hard-coded in `apps/mobile/src/lib/filter.ts` and `apps/web/src/components/FolderTabs.tsx`, nothing on the server. Brief and mockup v3 done (`docs/design/briefs/telegram-nav-folders-settings.{md,html}`, artifact https://claude.ai/artifact/BHee2ibwek1Q7ALdWjp38N). Julio's decisions are in the brief: monochrome keys, no Work default, tabs Chats/AIs/Settings/Profile, desktop folder rail. T-0231 (chat-core matcher) launched. Next: server `chat_folders` table + API (schema, after T-0171 merges), web rail + Chat folders page, mobile tabs, mobile folders, Settings, Profile. Julio: ask every question with the AskUserQuestion tool.

1. A mock-mode emulator build. Cause found: `scripts/phone/install.sh:46` builds `assembleRelease`, and `apps/mobile/src/mock/gate.ts:7-14` ignores `?mock=` outside `__DEV__` unless `EXPO_PUBLIC_ZILAR_MOCK` is baked in. So `zilar://ais/ai-dev-1?mock=1` hits the real API ("That AI no longer exists."). Idea: `pnpm phone:smoke --mock <branch>` builds with `EXPO_PUBLIC_ZILAR_MOCK=1` (emulator only, never the phone) and opens `/ais/ai-dev-1`. T-0189, T-0213, T-0218 were never seen on a device.
2. From the audit: @mention picker (7.2a), New channel parity (7.2c). Re-check every fact in the code.

Waiting for Julio: the AI screen's Tools/Routines/Activity sections could not be seen on the emulator (the test account has no AI; creating one needs a provider key). Look at an AI on the phone after the next release.

## MiniMax M3 scorecard (Julio, 2026-10-05: give it harder tasks, no replays)

| Task | Difficulty | Rounds | Pre-review | Tokens in | Note |
| --- | --- | --- | --- | --- | --- |
| T-0205 | easy (devtools parse) | 0 | clean, 2 nits | 0.49M | exact to spec |
| T-0194 | easy (guard tests) | 0 | clean, 0 nits | 1.4M | did the negative test properly |
| T-0195 | medium (docs audit) | 2 | round 1: 7 should-fix (invented strings, false claims, wrong citations) | 8.1M+ | merged; lead spot-check 9/10 citations exact |
| T-0215 | easy (env override, 3 files) | 0 | clean, 1 nit | | merged |
| T-0217 | easy (type + ref guard) | 0 | clean, 0 nits | | merged |

## Free-model benchmark (2026-10-05, 5 hard prompts, one run each, graded by the lead)

Prompts and outputs: `~/.claude/jobs/fcd95e40/tmp/bench/` (temporary). Scores: `opencode/muse-spark-1.3-contributor-free` 5/5 (fastest, 26 s avg, concise, proposed our real T-0198 fix); `opencode/mimo-v2.6-flash-free` 5/5; `opencode-go/longcat-2.5-preview-free` 5/5; `opencode/nemotron-3-ultra-free` 5/5 (one invented issue); `opencode-go/space-bunny-free` 4/5 (wrong event-loop order, most thorough elsewhere); `minimax-coding-plan/MiniMax-M3` 2/5 (wrong event loop and tiling, a fix that does not work across processes). `opencode-go/ox-alpha-free` unavailable, `opencode/fledge-alpha-free` not available in our country. Waiting for Julio: trial the free Muse listing on real tasks (rate limits and prompt logging unknown).
| T-0203, T-0204 | easy (prompts) | | | | queued |
| T-0207 | medium-hard (mobile sheet, state machine) | | | | after T-0191 |

## Blocked or waiting for Julio

- T-0186 notification settings: needs the server push work (T-0172), not approved.
- Phone checks: the Aa press on a voice note, the silent model load after restart, transcribe with real speech, the new settings screens (Integrations, Stickers). The last APK was built but not installed (the phone refused the USB install).
- Release: everything merged since v0.1.13 reaches the live web only with the next release.

## Recent events

- 2026-10-05: merged T-0206 (RepoMapper trial, `docs/audit/repomap-trial.md`): recommendation DROP. Our tasks mostly create new files, which a map of existing code cannot show; the maps only echoed the spec's "Read first" plus noise. Tool left at `~/.zilar-lead/tools/RepoMapper` (deletable).

- 2026-10-05: merged T-0205, the first MiniMax M3 task (clean first round) and the first squash merge: main gained exactly one commit `T-0205: ...` with the branch commits in its body.

- 2026-10-05: merged T-0200 (squash merges; its own merge still used the old flow). Follow-ups: T-0205 written; `docs/LEAD_PLAYBOOK.md` got a squash note. Checked for Julio: a shared warm start saves at most ~12k uncached tokens per session (first step of T-0201: input 12068, cache 0) and OpenCode forks keep the parent's folder, so not worth building.

- 2026-10-05: Julio approved the token-saving tasks: T-0202 (A), T-0203 (B), T-0204 (C) written. The lead updated `AGENTS.md` "Running tests" (quiet dot reporter, `pnpm gate` once, small sessions) and the spec rule in `CLAUDE.md` (Checks = single tests + `pnpm gate`); T-0194 and T-0195 Checks trimmed to match.

- 2026-10-05: merged T-0201 (runner connect test polls for "live"; fixes the CI flake Julio pasted). Token audit of worker sessions shown to Julio: fix rounds in the same long session (up to 217k context per step) are the main waste; proposals A/B/C (fresh session for fix rounds, quiet gate output, pre-review reuses the gate result) wait for his answer.

- 2026-10-05: MiniMax-M3 has no effort variants; a launch with `effort: low` fails with no reply. `effort: default` works (tested). T-0194 and T-0195 now say `effort: default`. Noted in `docs/LEAD_HANDOFF.md`.

- 2026-10-05: **main's history compacted** (Julio's request): 1,146 commits became 227, one per task; the final tree is identical, the 14 release tags `v0.1.0`..`v0.1.13` were re-created (same message and date) on the matching new commits and force-pushed; main force-pushed with a lease on the old sha `e80dfa25`. Backups: local branch `backup/main-pre-compact` and `~/.zilar-lead/compact/main-pre-compact.bundle` (verified). Untouched: `t0113-orig`, `archive/*`, `spike/T-0118-push`, old detached worktrees. Gate PASS on the new main. Commit hashes quoted in older task files and Reviews point to the old history (still in the backup).
- 2026-10-05: merged T-0173 (Effect 4.0 spike, `docs/EFFECT_GUIDE.md`) after a lead nits round; a second power cut overnight lost nothing.
- 2026-10-04: merged T-0196 (the doctor), T-0187 (mobile sticker packs; `addStickerFavorite` deferred to the first star button) and T-0188 (mobile owner integrations), all with emulator smoke PASS for the mobile ones.
- 2026-10-04: Julio: easy exact tasks move to `minimax-coding-plan/MiniMax-M3` (his subscription) to spend less on Muse; pre-reviews stay on Muse. `lead switch-model` back to Muse if one needs more than 2 fix rounds.
- 2026-10-04: merged T-0199 (pre-review follow-ups) and T-0198 (state writes re-read the file first).
