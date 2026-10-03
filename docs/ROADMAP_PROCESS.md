# Process roadmap: make worker results clean, make the lead's checks small (2026-10-04)

Julio: "do all, make the result of the Muse Spark workers cleaner and cleaner, the less they bother you the better; follow the Effect 4.0 rules and migrate the old code; write everything down so a new session can start from scratch." Status is updated here as pieces land.

## Why (what cost the most this session)
Bugs found only on a phone (gradient swap crash, Hermes `crypto.subtle`, Expo `Promise` parameter, relative avatar URL, JPEG against a PNG-only server, model re-download after restart); specs written from memory (invented History tab); me answering the same permission request and merge conflict again and again; parallel tasks editing the same registry files; a stale `file:` copy of the Whistle module; a merge chained after a failed command.

## Programme
| # | Item | Who | Status |
|---|---|---|---|
| G1 | `pnpm gate` (format, lint, typecheck, touched-package tests, scope report) in `packages/devtools/src/gate/` | lead | written and unit tested; commit it, then use it in worker prompt, AGENTS.md and `lead merge` |
| G2 | `lead merge` runs the gate after the rebase and refuses on red (seam `gate` in `merge.ts`) | lead | todo |
| G3 | Worker prompt and AGENTS.md: run `pnpm gate`, paste the summary, rebase on main before review, stay inside Allowed files | lead | todo |
| A1 | Pre-review prompt emits a machine-readable findings block (must/should/nit arrays); autopilot sends must-fix and should-fix back to the worker itself (max 2 automatic rounds, template in `prompts/`), and prints `MERGE READY` only when clean and the gate passed | lead | todo |
| A2 | Autopilot permission policy: `npx` for repo tools is rejected with the pnpm replacement (done, `policy.ts`); add allow rules for `pnpm gate` and `pnpm exec prettier --write|--check <paths>` | lead | partly done |
| S1 | `lead smoke T-XXXX`: build the branch, install on the emulator, open the touched screens, fail on any `FATAL` in `logcat -b crash`, save screenshots; emulator mic fed from a speech file for transcription | lead | todo |
| S2 | `lead phone` (build main, install once, print a changelog checklist) and `lead crash` (read the phone's crash buffer and the last minute of the app log, summarise the cause) | lead | todo |
| S3 | `lead spec-check T-XXXX`: every path, function and endpoint a spec names must exist; flags "web behaviour" claims with no cited web file | lead | todo |
| R1 | Registry-per-file for settings rows and new-chat menu entries so parallel tasks never edit the same file | worker task | todo |
| R2 | `zilar-whistle` as a `link:` dependency (no stale copy) | lead | todo |
| R3 | More pitfall guard tests next to `gradient-swap.test.ts`: no `Coroutine` with a `Promise` parameter in module Kotlin, no `crypto.subtle` in mobile source, no direct `fetch` of relative URLs in native code | worker task | todo |
| E1 | Effect 4.0: launch T-0173 spike, write `docs/EFFECT_GUIDE.md`, then the pairs in `docs/ROADMAP_EFFECT.md` (convert tasks keep tests unchanged) | workers | go given 2026-10-04; T-0173 not launched yet |
| D1 | Handoff doc `docs/LEAD_HANDOFF.md`, playbook updates, memory files | lead | handoff written; playbook update todo |
| M1 | Mobile parity programme (`docs/ROADMAP_MOBILE_PARITY.md`) | workers | wave 1 merged except nothing pending; wave 2 in progress |

## Order
G1 commit, G3, G2, A1, R2, S1, S2, S3, R1, R3, E1 (launch T-0173 as soon as a worker slot is free; it does not depend on the tooling).
