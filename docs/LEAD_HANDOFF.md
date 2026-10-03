# Lead handoff: start here after a reset (written 2026-10-04)

You are the lead Claude for Zilar (repo `/Users/julio/personal-projects/galena`, GitHub `JulioFerrero/zilar`, public, MIT). Julio is the owner and decides. Muse Spark workers (`meta/muse-spark-1.3-contributor`, through OpenCode) do the coding. Read `AGENTS.md` (worker rules), `docs/LEAD_PLAYBOOK.md` (the full process), this file (state and recipes), `docs/ROADMAP_PROCESS.md` (the improvement programme in progress), `docs/ROADMAP_MOBILE_PARITY.md`, `docs/ROADMAP_EFFECT.md`, `work/BOARD.md`.

## How Julio likes to work
Short messages, English. He tests on his phone: do NOT test audio/UI for him when he says so, build and install ONCE (never retry-loop installs). Icons, never emoji, in UI. He dislikes silent failures and asks "why" a lot: answer with the cause. Verify before claiming. Never leave work unmonitored. Cap: 4 parallel Muse workers (2 when he works at the computer), one schema task at a time. Workers must be easy for Muse: exact steps, verified facts, small scope, effort low, never interrupt a running turn, batch messages.

## State on 2026-10-04 (check `lead status` and `work/BOARD.md` for the truth)
- Live: release v0.1.13 at https://chat.zilar.app (sign-in code requests 3 per minute). Server image deploy recipe: `docs/RELEASING.md` sections 1-6.
- Merged this stretch: T-0174 connection resilience, T-0175 emoji sheet, T-0176 attach icons, T-0177 Whistle spike, T-0178 quiet-cut chunks, T-0179 on-device transcribe button, T-0180 sign-in hints, T-0181 mobile settings and profile, T-0182 contacts by @handle, T-0183 Explore and group visibility, T-0184 approvals page.
- Running or in review at the time of writing: T-0185 machines and connections (fix round 1 sent), T-0187 sticker packs (just launched), T-0192 web search finds people by @handle, T-0193 mobile search finds people by @handle.
- Specs written, not launched: T-0188 owner integrations, T-0191 sticker editor and Telegram import (after T-0187). Blocked: T-0186 notification settings (needs T-0172 server push work, Julio has not approved). Not written: T-0189 tools/routines/activity, T-0190 @mention picker.
- Effect 4.0: Julio said GO on 2026-10-04. Next step: launch T-0173 (spike, writes `docs/EFFECT_GUIDE.md`), then follow `docs/ROADMAP_EFFECT.md` pairs (new feature in Effect, then convert old code). Convert tasks keep tests unchanged.

## Commands (all from `packages/devtools`)
- `pnpm exec tsx src/lead/cli.ts launch T-XXXX | status | reply T-XXXX <promptfile> | prereview T-XXXX | merge T-XXXX --summary "..." | autopilot`
- State: `~/.zilar-lead/state.json` (tasks, sessionId, worktree, prereview{sessionId,head}, packetReadyForHead). Launching two tasks close together can lose an entry: wait 20-25 s between launches and verify with a python read of the file.
- Autopilot runs as a background process (restart it after changing `src/lead/policy.ts`): `cd packages/devtools && (nohup pnpm exec tsx src/lead/cli.ts autopilot >> <out> 2>&1 &)`. Its output file was `/private/tmp/claude-501/-Users-julio-personal-projects-galena/<session>/scratchpad/autopilot.out`; find the live one with `lsof -p $(pgrep -f "lead/cli.ts autopilot" | tail -1) | grep " 1w"`. Arm a Monitor on it (grep `PACKET READY|STALLED|PERMISSION|T-0xxx`); Monitors expire after 30 minutes: re-arm.
- Worker permission requests: `opencode2 api session.permission.list --param sessionID=...`, reply `opencode2 api session.permission.reply --param sessionID=... --param requestID=... -d '{"decision":"reject","message":"..."}'` (decision `once` or `reject`). The pre-review session id is in state `prereview.sessionId`. `npx prettier/vitest/...` is now rejected by the policy automatically with the pnpm replacement.
- A PACKET READY line means the pre-review finished. It is only current if `state.packetReadyForHead` equals the worktree HEAD. Deleting `PREREVIEW.md` makes the autopilot print a spurious "PRE-REVIEW STALLED" line: ignore it.
- Fix round to an idle worker: write a prompt file with numbered findings, one commit each, exact test names, "keep status review"; `lead reply T-XXXX <file>`. Never reply while the worker turn is running (it interrupts).
- Merge: run the checks FIRST (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, related tests, in the task worktree after `pnpm install --frozen-lockfile`), write the Review in the task file (status `merged`), commit, then `lead merge`. Never chain the merge after a command that may have failed (T-0181 once merged with a red test). On a rebase conflict: `git rebase main` in the worktree, fix files (registry files `apps/mobile/src/lib/settings-items.ts`, `components/chat/new-chat-button.tsx` conflict most), `git checkout --ours <file>` for repeated conflicts in later commits, `git add`, `GIT_EDITOR=true git rebase --continue`, rerun checks, commit, then `lead merge`.
- The new gate: `pnpm gate` (root) runs install, format, lint, typecheck and the tests of the touched packages (`--changed main --maxWorkers=2`) and prints a scope report of files outside the task's Allowed files (`packages/devtools/src/gate/`). Workers must paste its summary in the Report.

## Dashboard (Julio asked for a UI inside Claude, 2026-10-04)
Published Artifact: https://claude.ai/artifact/6LQALjgEnLLfKxnuYJBhoR (private). It shows each task in flight with a four-step tracker (Coding, Review fixes, Pre-review, Lead), the time in the current step, last activity (red when silent over 25 min), a "Needs you" section on top, the queue and today's merges. Timers tick in the page; the data is a snapshot.
Refresh: `cd packages/devtools && pnpm exec tsx src/lead/cli.ts dashboard $CLAUDE_JOB_DIR/tmp/board.html`, then publish the SAME file path with the Artifact tool (the URL stays). Refresh it on every PACKET READY, merge or launch, and when Julio asks. Template: `packages/devtools/dashboard/template.html`; data: `lead snapshot` (JSON).

## Pre-merge tools (all documented in docs/ROADMAP_PROCESS.md)
`pnpm gate` (worker and merge), `lead spec-check T-XXXX` (before launching), `pnpm phone:smoke <branch>` (emulator, opens the changed screens, fails on a crash), `pnpm phone:install` (build main, install once on Julio's phone, changelog), `pnpm phone:crash` (crash buffer and cause).

## Devices and builds
- Julio's Android phone (vivo): adb serial `10AFAT234E00746`. Emulator: AVD `galena`, `emulator-5554`, signed in as the test user "Claude Test" (zilar@agentmail.to, AgentMail MCP, inbox for sign-in codes; mail from no-reply@mail.zilar.app). Sign-in recipe is in memory `android-emulator-setup`.
- Build worktree: `/Users/julio/personal-projects/zilar-phone-build` (detached; `git checkout --detach main`, `pnpm install --frozen-lockfile`). Android: `docs/RELEASING.md` section 7 (`expo prebuild --platform android --clean --no-install`, then `./gradlew assembleRelease` with `JAVA_HOME` Java 17, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, `EXPO_PUBLIC_ZILAR_API_URL=https://chat.zilar.app`, `NODE_ENV=production`; for JS-only changes `:app:createBundleReleaseJsAndAssets --rerun assembleRelease` is enough, about 35 s). Install once with `adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk`.
- Iryna's iPhone (girlfriend, free Apple account, 7-day app expiry, needs Trust in Settings): CoreDevice id `6984517B-31BC-5F2A-9E9B-96E6D327BACD`, hardware UDID `00008140-000138393E93001C`, signing team `8B2FH8277F`. Recipe: `docs/RELEASING.md` section 8.
- The Whistle module `apps/mobile/modules/zilar-whistle` is installed into `node_modules` as a COPY (`file:` dependency): after changing it run `pnpm install` in that checkout or tests, typecheck and Metro use stale code. Planned fix: make it a `link:` dependency (see ROADMAP_PROCESS R2).

## Hard-won pitfalls (React Native 0.86 / Expo SDK 57 / Hermes / Android)
- Never swap one gradient style for another on a live view (`iconKey` to `segment`, `raisedPill` to `primaryKey`): Android crashes in `LinearGradient.nativeCreate`. Give the element a `key` that changes with the look. Guard test: `apps/mobile/src/lib/gradient-swap.test.ts`.
- Expo modules: `AsyncFunction(...) Coroutine { ..., promise: Promise -> }` is invalid (no converter for `Promise`; the module shows "not available"). Return a value or use a plain `AsyncFunction` with a `Promise` parameter.
- Hermes has no `crypto.subtle`: hash natively. JS hands `file://` URIs; normalise them in Kotlin.
- Server URLs from the API can be relative (`/api/avatars/<id>`): resolve against the API origin on native.
- The server accepts only PNG or WebP for avatars and stickers; phone photos are JPEG: re-encode with `expo-image-manipulator` first.
- Native engine state (the Whistle model) is lost on every app start while the file stays: status checks must reload it silently, never ask the user to download again.
- ejabberd's archive drops messages with an empty body unless they carry the store hint (voice notes). The XMPP library only retries after a socket "disconnect": the core has a watchdog.
- Android emulator mic is silent: it cannot prove transcription works. Julio's phone is the real test.
- Julio's phone crash log: `adb -s 10AFAT234E00746 logcat -b crash -d` and the app log lines before it.
- Workers: Muse needs exact steps; vague specs cost hours. Spec facts must be checked against the code (my invented "History tab" for approvals cost two rounds). `AGENTS.md` bans `npx`; use `pnpm exec`.

## Server and deploy facts
Coolify service `zilar` uuid `zogjtvwnoh9rqo96h7e7ajz1` (restart with `pull_latest: true`, verify the server `hostname` in the logs changes and an authed route answers 401). CI on main has a known flaky test (`packages/runner-tunnel`/runner `connect.test.ts`) and a legacy-name guard (`packages/devtools/src/no-legacy-name.test.ts`: the old product name must not appear in tracked files).
