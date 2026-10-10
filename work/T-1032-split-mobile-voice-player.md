---
id: T-1032
title: "Size split T109: apps/mobile/src/components/chat/voice-player.ts (423 lines) into chat/{voice-player-registry,voice-player-host}.ts"
status: merged
milestone: M5
branch: task/T-1032-split-mobile-voice-player
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1032: Split the mobile `voice-player.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-player.ts` is 423 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #105 (task T109): `components/chat/voice-player-registry.ts` and `chat/voice-player-host.ts`, under `apps/mobile/src/`. `voice-player.ts` re-exports every name it exports today.

Move the code unchanged, and skip the Dedup, because it reaches into `voice-message.tsx`.

The lead runs a phone smoke of a chat with a voice message in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #105, and `apps/mobile/src/components/chat/voice-player.ts`.

### Allowed files
`apps/mobile/src/components/chat/voice-player.ts`, `apps/mobile/src/components/chat/voice-player-registry.ts`, `apps/mobile/src/components/chat/voice-player-host.ts`, `work/T-1032-split-mobile-voice-player.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**What I did.** Split `apps/mobile/src/components/chat/voice-player.ts` (423 lines) into
`chat/voice-player-registry.ts` and `chat/voice-player-host.ts`, following
`docs/audit/size-plan.md` §2.2 #105 and `docs/audit/split-rules.md`. `voice-player.ts` is now a
39-line barrel that re-exports every name it exported before, with the same names and kinds. The
cross-file Dedup (`speakerStub`, `voice-message.tsx`'s inline speaker objects) was skipped exactly as
the spec says. No file outside the Allowed files was edited.

### `wc -l` (old, then new)

```
423  apps/mobile/src/components/chat/voice-player.ts   (before)
 39  apps/mobile/src/components/chat/voice-player.ts   (barrel, after)
220  apps/mobile/src/components/chat/voice-player-registry.ts
269  apps/mobile/src/components/chat/voice-player-host.ts
```

Every new file and the barrel are under the 400-line limit.

### Export list before and after (`grep -E "^export"`)

Before — the old file, 11 exports:

```
export interface VoicePlayerControls {
export type VoicePlayerHost = {
export function useVoicePlayerHost(): VoicePlayerHost {
export interface HostPlayer {
export interface PlayerStatusTick {
export function subscribeVoiceProgress(
export function subscribeVoicePlayError(
export function emitPlayerStatusForTest(player: HostPlayer, status: PlayerStatusTick): void {
export function resetVoicePlayerForTest(): void {
export function createVoicePlayerHostForTest(createPlayer: () => HostPlayer): VoicePlayerHost {
export function subscribeVoiceState(
```

After — the barrel re-exports those same 11 names with their kinds (`VoicePlayerControls`,
`VoicePlayerHost`, `HostPlayer`, `PlayerStatusTick` as `export type`; the seven functions as values):
`useVoicePlayerHost` and `createVoicePlayerHostForTest` from the host, `subscribeVoiceProgress`,
`subscribeVoicePlayError`, `emitPlayerStatusForTest`, `resetVoicePlayerForTest`,
`subscribeVoiceState` from the registry. The public surface is unchanged (diff of the re-exported
name set: empty).

The new files also export internal names that the split needs across the file boundary and that the
barrel does **not** re-export: from the registry `livePlaybacks`, `playerPlaybacks`, `listeners`,
`injectedStatus`, `releasePlayer`, `attempt`, `attemptAsync`, `currentRate`, `notifyPlayError`,
`activeSpeaker`, `resignedSpeaker`, `onPlayerStatus` and the four state accessors (below); from the
host `NativePlayer`. These are `export`-keyword/internal additions only, the same practice past
splits used (`T-0964`, `T-1001`).

### Files changed

- `apps/mobile/src/components/chat/voice-player.ts` — now a 39-line barrel.
- `apps/mobile/src/components/chat/voice-player-registry.ts` — new; module state, the per-bubble
  listeners, the speaker stubs, the progress/error subscriptions and the status router.
- `apps/mobile/src/components/chat/voice-player-host.ts` — new; the public host types,
  `useVoicePlayerHost` and `createVoicePlayerHost`.
- `work/T-1032-split-mobile-voice-player.md` — this report.

### Commands and real results

- `pnpm install` — done (1172 packages; the peer-dependency warning about `@types/react` is
  pre-existing).
- `pnpm --filter @zilar/mobile typecheck` — exit 0, no output (`tsc --noEmit`).
- `pnpm gate` (from the repo root) — `GATE PASS`; summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.9s)
PASS  lint  (1.1s)
PASS  typecheck  (4.2s)
PASS  effect  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: there is no test file in `apps/mobile/src/components/chat/`, and no test
anywhere imports these symbols, so `split-rules.md` item 5's "nearest kept tests" select nothing.

### Deviations from the spec

1. **Cross-file module state — accessors instead of direct assignment.** The plan puts the
   module-level state (94–162) in the registry and `createVoicePlayerHost` (164–313) in the host, but
   `createVoicePlayerHost` reassigns `sharedPlayer` and `activeMessageId`, and an ES module cannot
   assign to an imported binding. I kept both `let`s private to the registry and exported four tiny
   accessors — `getSharedPlayer`, `setSharedPlayer`, `getActiveMessageId`, `setActiveMessageId` — the
   same "module state + accessors" idiom as `apps/mobile/src/lib/gifs.ts`. The host reads through a
   getter into a local and writes through a setter; the order of every call is unchanged, so
   behaviour is identical. The Maps (`livePlaybacks`, `playerPlaybacks`, `listeners`,
   `injectedStatus`) are only mutated through `.add`/`.set`, which is legal across modules, so they
   moved unchanged.
2. **`createVoicePlayerHostForTest` moved to the host (plan range 407–410).** It wraps
   `createVoicePlayerHost`. Leaving it in the registry would make the registry import a value from
   the host while the host imports values from the registry — a runtime cycle. Moving the 4-line
   wrapper next to the factory it calls removes the cycle; the barrel still exports it, so the public
   surface is unchanged.

Everything else is moved verbatim; the only other edits are `export` keywords on helpers that now
cross the module boundary.

### Effect ratchet

No `// effect-plain:` marker was added. Both new files import `effect` as a value, so the map
classifies them `effect` (not `needs-effect`), and the barrel has no signals (`plain`); the gate's
`effect` step printed `PASS effect`.

### Security checklist

Move-only split with no new routes, logging, deletes, updates, caps or audit entries. `onPlayerStatus`
and `notifyPlayError` moved byte-for-byte, including the fixed user-facing sentence "Could not play
that voice message." (never raw server text). The lazy `import('expo-audio')` and the
`@/lib/voice-native` dependency are unchanged. No secrets involved.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `voice-player.ts` (423 lines) is now a 39-line barrel, plus `voice-player-registry` (220) and `voice-player-host` (269).
- **Not a pure move:** the module state `sharedPlayer` and `activeMessageId` stays in the registry, and the host now reaches it through getters and setters, because an importer cannot reassign an ES module binding.
- **The lead read every host call site against main** (`play`, `startWith`, `pause`, `seekTo`, `cycleSpeed`):
  - each cached local is read before any write;
  - `pause` captures the id before clearing it, as main did;
  - the registry's own reads and writes match main line for line.
- **The lead's phone smoke** (mock, Ana's chat): a recorded 0:02 note shows play and a waveform.
- **Same on main:** tapping play leaves the play icon on screen. The lead ran the same steps on main.
- **Check:** the gate passed.
