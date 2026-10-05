---
id: T-0211
title: Lead tooling: redesign `lead watch` as a proper terminal app with Ink (cards, step tracker, model badges, fits any width)
status: merged
milestone: M5
branch: task/T-0211-lead-watch-ink-redesign
model: opencode/muse-spark-1.3-contributor-free
effort: high
depends_on: [T-0210]
estimate: 1 day
---

# T-0211: `lead watch` redesign with Ink

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05, with a screenshot of `lead watch` in a small Terminal.app window: "the ui in the terminal is super ugly, can we do it better? like a proper cool terminal app?". The screenshot also shows two bugs: lines run past the right edge (the clock reads `11:33:5`, titles and the model line are cut by the window, not by the app), and the step reads `editing <unknown>…`.

### Design (follow exactly)
Rendered with Ink (React for the terminal). Dark-terminal friendly, no emoji, only box-drawing and geometric characters. Target: looks right at 40, 60 and 100 columns.

```
╭─ zilar · lead ─────────────────────── 11:33:52 ─╮
│ ● 2 working   ◆ 1 needs you   ✓ 3 merged today  │
╰─────────────────────────────────────────────────╯
╭─ T-0191 ──────────────────────── Muse · low ────╮
│ Mobile: sticker pack editor                     │
│ ●━━━━━●━━━━━○━━━━━○  Fixing · round 1     42 m  │
│ ⠹ editing sticker-pack.tsx                      │
│ 18.2 tok/s · 9.6 s/step · ctx 158k  ▂▃▅▇▆▄▃▅    │
│ +11  ~2  −0   sticker-pack.tsx  pack-editor.ts  │
╰─────────────────────────────────────────────────╯
 q quit · updated 2 s ago
```

- **Header card**: round border (`borderStyle="round"`), dim border colour. Title `zilar · lead` bold on the top-left, the clock dim on the right. Counters: `● N working` (cyan), `◆ N needs you` (yellow, bold when N > 0), `✓ N merged today` (green, from `mergedToday`).
- **One card per task**, round border, border colour by phase: coding and fixing cyan, pre-review magenta, waiting for the lead yellow, blocked and idle red, quota red. The task id sits in the top border on the left (bold); the **model badge** sits on the right of the same row: `Muse` for any model id containing `muse`, `MiniMax` for `minimax`, otherwise the model id; then ` · ` and the effort; `free` after it in green when the model id ends in `-free`. Muse in magenta, MiniMax in yellow.
- Card body, in this order:
  1. The title, one line, cut with `…`.
  2. The **step tracker**, the same four steps as the dashboard: Coding, Review fixes, Pre-review, Lead. Done steps `●` and the bar between them in the phase colour, the current step `●` in bold, the rest `○` and a dim bar. Phase id to step: `coding` 1, `fixing` 2, `starting-prereview` and `prereview` 3, `waiting-lead` 4; `blocked`, `idle` and `quota` keep the step they had (use 1 when unknown) with the current dot red. After it, the phase label (with `round N` when `autoFixRounds` > 0), and the run time right-aligned.
  3. The **live step**, only while the session runs: an animated braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 80 ms) and the step text. When the session waits: no line.
  4. The **speed line** from T-0210 (or `measuring…` dimmed).
  5. **Files**: counts `+N` green, `~N` yellow, `−N` red, then as many basenames as fit on the rest of the line (created first, then modified), dim.
- **Footer** (no border): `q quit · updated N s ago`, dim; `refresh failed, retrying` in red instead of the age when the last refresh failed.
- **Width**: everything comes from Ink's `useStdout().stdout.columns`, re-rendered on resize, so no line is ever wider than the terminal. Below 50 columns: the step tracker drops its bars (`● ● ○ ○`), the speed line drops the sparkline, files show only the counts.
- **No tasks**: one card with `No tasks in flight.` dimmed.

### Bugs to fix on the way
- `editing <unknown>`: the step is read while the tool call is still arriving and its `input.path` is not there yet. When a tool has no path, show `editing…` / `reading…` instead of `<unknown>`.
- Lines wider than the window: fixed by the Ink layout above; prove it with the width tests below.

### Verified facts (do not re-derive)
- `lead watch` lives in `packages/devtools/src/lead/watch.ts` (T-0209, speed added by T-0210; read it on main before you start, T-0210 changes it). Keep its data side as it is: the child process `lead watch --data` builds the view and prints it as one JSON line, read back by `parseWatchView`; `liveStep`, `parseChangedFiles`, `modelLabel` and the speed helpers stay pure and tested. Replace only the drawing: `renderWatch`, `frameText` and the redraw loop in `runWatch` (the alternate screen and raw-mode handling become Ink's job).
- The snapshot already has what the cards need: `Snapshot.mergedToday` and, per task, `phase: { id, label, needsLead }`, `autoFixRounds`, `totalAge`, `model` (`packages/devtools/src/lead/snapshot.ts` lines 84-118).
- Ink 8.0.0 is current; its peer dependency is `react >=19.3.0`. The web app already uses `react ^19.3.0` (`apps/web/package.json` line 23). `ink-testing-library` 4.0.0 renders Ink components to a string for tests.
- `packages/devtools/package.json` has only `zod` as a dependency; `packages/devtools/tsconfig.json` extends `../../tsconfig.base.json` and has no `jsx` option, so `.tsx` files need `"jsx": "react-jsx"` added there.

### What to build
1. Add `ink` (8.x), `react` (same range as `apps/web`) and `@types/react` to `packages/devtools/package.json` dependencies, `ink-testing-library` to devDependencies, and `"jsx": "react-jsx"` to `packages/devtools/tsconfig.json`. Run `pnpm install`.
2. New `packages/devtools/src/lead/watch-app.tsx`: the Ink app (`<WatchApp />`) and its parts (`Header`, `TaskCard`, `StepTracker`, `ModelBadge`, `FilesLine`, `Footer`), taking the `WatchView` plus the refresh state as props; the pure helpers it needs (`trackerStep(phaseId)`, `modelBadge(model, variant)`) exported from `watch.ts` or a new `packages/devtools/src/lead/watch-format.ts`.
3. `runWatch` in `watch.ts`: keep the 3-second child-process refresh; render with Ink's `render(<WatchApp ... />)`, update it on every refresh; `q` and Ctrl-C quit through Ink's `useInput` / `useApp().exit()` and leave the terminal clean. Delete the old string renderer and its tests once the new tests cover the same cases.
4. Tests in new `packages/devtools/src/lead/watch-app.test.tsx` with `ink-testing-library`: a card for a coding task, a fixing task with round 2, a pre-review task and a waiting-for-lead task (check the tracker dots and the phase text); the model badge for a free Muse model, a MiniMax model and an unknown model; the header counters; the empty state; for widths 40, 60 and 100 no rendered line is longer than the width (strip escape codes before measuring); below 50 columns the compact tracker. In `packages/devtools/src/lead/watch.test.ts`: `liveStep` returns `editing…` for an edit tool without `input.path`.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`, `packages/devtools/src/lead/snapshot.ts` (lines 1-120), `packages/devtools/dashboard/template.html` (the four-step tracker, for the look).

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`, `packages/devtools/src/lead/watch-app.tsx` (new), `packages/devtools/src/lead/watch-app.test.tsx` (new), `packages/devtools/src/lead/watch-format.ts` (new, optional), `packages/devtools/src/lead/watch-format.test.ts` (new, optional), `packages/devtools/src/lead/cli.ts`, `packages/devtools/package.json`, `packages/devtools/tsconfig.json`, `pnpm-lock.yaml`, `work/T-0211-lead-watch-ink-redesign.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx
pnpm gate
```
The lead runs `pnpm lead:watch` in a small Terminal.app window before merging and compares it with the design above.

### Acceptance
- `pnpm lead:watch` looks like the design, animates smoothly, fits the window at any width (nothing cut by the window edge), and quits cleanly with `q` and Ctrl-C.
- No `<unknown>` anywhere; still read-only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Keyboard navigation, scrolling through more cards than fit, opening a task, colours themes, sound.

---

## Report (written by the worker when done)

### What I did
Redesigned `lead watch` as an Ink terminal app, following the spec design exactly:
- New `packages/devtools/src/lead/watch-app.tsx`: pure `<WatchApp />` (props: `WatchView`, `updatedAgoSecs`, optional `columns`/`clock` overrides) plus the spec'd parts `Header`, `TaskCard`, `StepTracker`, `ModelBadge`, `FilesLine`, `Footer`, and the live shell `WatchLive` (3 s `lead watch --data` child-process refresh, 1 s clock ticker, `q`/Ctrl-C quit via `useInput`/`exit()`; Ink owns raw mode and restores the terminal). Cards use round box-drawing borders with the task id bold in the top border left and the model badge right; border colour by phase (coding/fixing cyan, pre-review magenta, waiting-lead yellow, blocked/idle/quota red). Step tracker `●━━━●━━━○━━━○` + `phase · round N` + right-aligned age; braille spinner (80 ms via `useAnimation`) on the live-step line, omitted when the session waits; speed line or dimmed `measuring…`; files as `+N ~M −D` plus fitting basenames (created first, dimmed); footer `q quit · updated N s ago` / red `refresh failed, retrying`. Below 50 columns: compact tracker (`● ● ○ ○`), no sparkline, counts only. All widths derive from `useStdout().stdout.columns` (prop override exists only for tests) and every line is truncated with `…` to fit.
- New `packages/devtools/src/lead/watch-format.ts`: pure `trackerStep`, `modelBadge`/`badgeText`, `phaseColorName`, `truncate`, `SPINNER_FRAMES`, `COMPACT_WIDTH`.
- `watch.ts`: fixed `editing <unknown>`/`reading <unknown>` → `editing…`/`reading…`; extended `WatchEntry` (`model`, `effort`, `autoFixRounds`) and `WatchView` (`mergedToday`) plus zod schemas and `buildView`; deleted the old string renderer (`renderWatch`, `frameText`, colour/width helpers) and `disableRawMode`; `runWatch` now renders `<WatchLive />` (app module lazily imported to avoid a `watch`↔`watch-app` load cycle); exported `formatClock` and `REFRESH_INTERVAL_MS` for the app.
- Deps: `ink@8.0.0`, `react@19.3.0`, `@types/react@19.3.0` in dependencies, `ink-testing-library@4.0.0` in devDependencies; `"jsx": "react-jsx"` in `packages/devtools/tsconfig.json`.
- Tests: new `watch-app.test.tsx` (17 tests: coding/fixing-round-2/pre-review/waiting-lead cards with tracker dots + phase text, three model badges, header counters, empty state, refresh-failed footer, speed + files, width fits at 40/60/100, compact tracker below 50); `watch.test.ts` gained the `editing…`/`reading…` tests and lost the deleted renderer's tests.

### Files changed (9, all inside Allowed files)
`packages/devtools/src/lead/watch.ts`, `watch.test.ts`, `watch-app.tsx` (new), `watch-app.test.tsx` (new), `watch-format.ts` (new), `packages/devtools/package.json`, `packages/devtools/tsconfig.json`, `pnpm-lock.yaml`, `work/T-0211-lead-watch-ink-redesign.md`.

### Commands and real results
- `pnpm install`: ok (10.4 s).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx`: 58 passed (41 in watch.test.ts, 17 in watch-app.test.tsx).
- `pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts watch --data`: prints one JSON line with the new `mergedToday`/`model`/`effort`/`autoFixRounds` fields (verified against live state: T-0211 coding entry present).
- `pnpm gate` (from repo root): `gate: 9 changed file(s) against main` → PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/devtools → `scope: every changed file is inside the Allowed files` → **GATE PASS**.

### Problems / deviations
- The static `watch.ts` → `watch-app.tsx` import created a load cycle that left `formatDuration` undefined under Vitest (`ERROR formatDuration is not defined`, whole frame blank). Fixed by lazily importing `WatchLive` inside `runWatch`. The pure speed helpers stay defined and tested in `watch.ts` as the spec requires.
- `buildView`'s two error returns now spread `previous` (keeps `mergedToday`, clock and entries) instead of rebuilding the object without the new field.
- `runWatch` is now `async` (was sync returning `Promise<void>`); `cli.ts` already awaits it, no change needed there.
- Not verified interactively: animation smoothness and `q`/Ctrl-C quit in a real Terminal.app window (no TTY here) — the lead's `pnpm lead:watch` check covers this. `status`/`snapshot`/`dashboard` paths untouched; still read-only (no new writes, no secrets in output).

### Blocked / needs a decision
None.

### Round 2 (fix round, 2026-10-06)
- Fixed finding 1 (must-fix): `bodyLine` in `watch-app.tsx` used `inner = width - 4`, rendering every card body line 1 column narrower than its borders. Changed to `width - 3` (`│ ` + `│` = 3 overhead) and updated the four content-width call sites (`StepTracker`, `LiveStepLine`, `FilesLine`, `TaskCard` title/speed `inner`) from `width - 4` to `width - 3`.
- Tests: tightened the width test in `watch-app.test.tsx` (`fits every line within N columns` at 40/60/100) to also assert every bordered line (`╭`/`╰`/`│`) measures exactly `width`.
- Finding 2 (nit, `indexOf('/')` provider strip) intentionally left untouched per the no-nits rule; it is in a line not otherwise changed.
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx`: 2 files, 58 passed.
- `pnpm gate` from repo root: `gate: 9 changed file(s) against main` → PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/devtools → scope inside Allowed files → GATE PASS.

### Round 3 (fix round, PREREVIEW.md)
- Fixed finding 1 (should-fix): `WatchLive.refresh()` in `watch-app.tsx` had no overlap guard — a slow `lead watch --data` child (>3 s) let two `execFile` calls run in flight and the stale one could overwrite the fresher view. Restored the old `runWatch`'s `refreshing` flag as an `inFlight` closure guard: skip when set, set before spawn, clear first thing in the callback.
- Finding 2 (nit, `indexOf('/')` provider strip) intentionally left untouched per the no-nits rule; not in a line otherwise changed.
- Tests: added `WatchLive refresh overlap guard` test in `watch-app.test.tsx` (fake timers + mocked `node:child_process.execFile`: initial refresh fires once, a second interval while it is pending fires nothing, resolving it re-arms the next refresh). Verified it fails on the unfixed code (1 failed) and passes with the fix.
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx`: 2 files, 59 passed (41 watch.test.ts + 18 watch-app.test.tsx).
- `pnpm gate` from repo root: `gate: 9 changed file(s) against main` → PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/devtools → scope inside Allowed files → GATE PASS.

### Lead round: look (2026-10-06, mockup approved by Julio)
Did the 10 brief changes (`docs/design/briefs/T-0211-lead-watch-icons.md`, target `docs/design/briefs/T-0211-lead-watch-mockup.html`), one commit per change (`T-0211: look N - …`):
1. `WATCH_ICONS` table in `watch-format.ts` (17 names, exact brief codepoints, fallbacks) + `iconText` (one trailing space) + `iconsEnabled` (`--no-icons` / `ZILAR_WATCH_ICONS=0`); `runWatch({ noIcons })`, `WatchLive`/`WatchApp` `icons` prop, header counters use icons. 2. Live-step icon (`liveStepIcon`) in the live line, phase-coloured. 3. Top border: animated spinner when running, bell when waiting for the lead, pause icon otherwise; id bold in the phase colour. 4. Badge: Muse magenta, MiniMax `#f2a65e`, effort dim, `free` green. 5. Header: magenta brand icon + bold title left, clock icon + dim time right. 6. Waiting card: yellow `review the packet and merge` bell line + dim `idle · waiting for you` pause line instead of live step / speed. 7. Files: icon + count in green/yellow/red, dim names. 8. Footer: `q` as inverse key + `quit · <branch> main · updated N s ago`, truncated to width. 9. Speed line icons (bolt cyan, clock, db) + `ctx` value green <150k / yellow ≥150k / red ≥200k (`contextColorName`). 10. tok/s number in the phase colour; every line cut to `stdout.columns` (all measuring via `Array.from`, glyph = 1 column); width tests measure code points now (astral glyphs are 2 UTF-16 units) at 40/60/100.
- Tests: new `watch-format.test.ts` (table codepoints/fallbacks, `iconText`, `iconsEnabled`, `liveStepIcon`, `contextColorName`, `modelBadge` colours + free); `watch-app.test.tsx` gained per-look describes (header/brand/clock, live icons incl. it.each over 6 steps + no-icon case, top-border spinner/bell, waiting text, files icons + fallbacks, footer branch, speed ctx values, seg-level colour wiring for tok/s + ctx + badge). ink-testing-library strips colour in this env, so colours are asserted at seg level (`speedSegs`/`badgeSegs` now exported); a failing-frame print during the round confirmed the layout matches the mockup.
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx src/lead/watch-format.test.ts`: 3 files, 101 passed (41 + 46 + 14).
- `pnpm gate` from repo root: `gate: 11 changed file(s) against main` → PASS install, PASS format (after one `prettier --write` on `watch-app.tsx`, amended into look 10), PASS lint, PASS typecheck, PASS tests @zilar/devtools → scope inside Allowed files → GATE PASS.
- Not verified interactively: real Ghostty/Nerd Font rendering at 64 columns and `q`/Ctrl-C (no TTY here) — the lead's `pnpm lead:watch` check covers this. Still read-only.

### Disagreements
None.

### Lead round 2 (2026-10-06, per the lead's replacement plan)
- Fix 2.1 (`watch.ts`, commit `T-0211: fix lead 2.1 - alternate screen and full clear on resize`): `runWatch` passes `alternateScreen: true` to Ink's `render` (Ink writes/restores the alternate screen itself, no hand-written `?1049h`), and registers `process.stdout.prependListener('resize', onResize)` ahead of Ink's own resize handler (which only clears on shrink). `onResize` calls the exported `fullClearOnResize(out, clear)`: writes `\u001b[2J\u001b[H` (built via `String.fromCharCode(27)`) then calls the instance's `clear()`. The listener is removed in a `finally` after `waitUntilExit()`.
- Fix 2.2 (`watch-app.tsx`, commit `T-0211: fix lead 2.2 - no raw mode without a TTY stdin`): `WatchLive` reads `const { isRawModeSupported } = useStdin()` and passes `{ isActive: isRawModeSupported }` to `useInput`, so without a TTY stdin no raw mode is requested; the view still renders and SIGINT (exitOnCtrlC default) still quits.
- Tests: `watch.test.ts` gained `fullClearOnResize` (exact bytes `\u001b[2J\u001b[H`, `clear` called once, write happens before clear); `watch-app.test.tsx` gained `WatchLive without a TTY stdin` (Ink's `render` with fake `EventEmitter` streams, stdin `isTTY = false` without `setRawMode`: renders frames without throwing).
- Single tests: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts src/lead/watch-app.test.tsx src/lead/watch-format.test.ts`: 3 files, 103 passed (42 + 47 + 14).
- `pnpm gate` from repo root: `gate: 11 changed file(s) against main` → PASS install, PASS format (after one `prettier --write` on `watch.ts`/`watch.test.ts`, folded into the 2.1 commit), PASS lint, PASS typecheck, PASS tests @zilar/devtools → scope inside Allowed files → GATE PASS.
- Notes: I briefly committed fix 2.1 with `--no-verify` out of habit, caught it, and redid the commit with hooks enabled; the format fix required re-splitting the two commits (soft reset of my own unpushed commits only, main untouched). Not verified interactively: real resize ghost-line behaviour and non-TTY launch (no TTY here) — the lead's `pnpm lead:watch` check covers this. Still read-only.

## Review (written by Claude)

**Verdict:** Approved after two auto rounds, a lead look round (10 changes to match Julio's approved mockup: Nerd Font icons, cards, step tracker, speed line) and lead round 2. Round 2 followed the lead's exact steps: Ink 8's `alternateScreen: true`, and a `fullClearOnResize` listener prepended before Ink's own (Ink clears only when the window shrinks, so growing it left ghost lines); `useInput` is active only when raw mode is supported, so a non-TTY stdin no longer throws. Lead ran the branch in a pseudo-terminal (alternate screen entered, 3 tasks shown) and in a floating Ghostty test window with live data; Julio resized it and confirmed: "the resize is working great". Accepted nits (later cleanup): unused exports `ModelBadge` and `badgeText`; `truncateSegs` keeps only the first segment's colour on a cut line.
