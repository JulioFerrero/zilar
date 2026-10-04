# Now

The live picture: what runs, what is next, what waits for Julio. The lead rewrites this file after every launch, merge or block, and commits it with the board. The full task list is `BOARD.md`; the rules are `CLAUDE.md` and `docs/LEAD_LOOP.md`.

Last updated: 2026-10-04, after the power cut.

## Running (max 4)

| Task | What | Step | Note |
| --- | --- | --- | --- |
| T-0173 | Effect 4.0 spike on the server voice transcription pipeline | coding | resumed after the outage |
| T-0187 | Mobile: manage sticker packs | coding | has a design brief; resumed after the outage |
| T-0188 | Mobile: owner integrations | coding | has a design brief; resumed after the outage |
| T-0198 | Autopilot loses state written during a tick | round 3 (lead) | the spec missed `switch-model.ts`; Allowed files widened in the worktree and the worker asked to use `updateState` there too, with one race test. Until it merges, pause the autopilot around every `lead launch` |

## Next, in order

1. T-0199 pre-review follow-ups (after T-0198: same files)
2. T-0196 the doctor (after T-0198 and T-0199: same files)
3. T-0194 guard tests for the Android and Hermes pitfalls
4. T-0195 audit of web vs mobile (its result feeds the specs of T-0189 and T-0190)
5. T-0191 sticker editor and Telegram import (after T-0187)

## Blocked or waiting for Julio

- T-0186 notification settings: needs the server push work (T-0172), not approved.
- Phone checks: the Aa press on a voice note, the silent model load after restart, transcribe with real speech, the new settings screens. The last APK was built but not installed (the phone refused the USB install).
- Release: everything merged since v0.1.13 reaches the live web only with the next release.

## Recent events

- 2026-10-04: power and internet cut in Barcelona; every worker session failed (`getaddrinfo ENOTFOUND api.meta.ai`) and was resumed with its uncommitted work.
- 2026-10-04: all workers stopped and relaunched under the loop with re-verified specs; old branches kept as `archive/T-0173`, `archive/T-0187`, `archive/T-0188`, `archive/T-0197`.
- 2026-10-04: merged T-0192 (web: people by @handle in search) and T-0197 (old name out of the smoke script, reviewer files ignored).
