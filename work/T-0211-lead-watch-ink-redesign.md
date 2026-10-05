---
id: T-0211
title: Lead tooling: redesign `lead watch` as a proper terminal app with Ink (cards, step tracker, model badges, fits any width)
status: planned
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

## Review (written by Claude)
