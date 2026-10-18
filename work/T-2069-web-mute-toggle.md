---
id: T-2069
title: "Reduce (web): one useMuteToggle(chat) hook (mute forever / unmute, busy guard, one error line) replaces the five copies in the contact panel, group info, channel info, channel composer bar and topic mute/leave — no behaviour change"
status: merged
milestone: M5
branch: task/T-2069-web-mute-toggle
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2069: One web mute toggle

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The same "mute forever / unmute" quick toggle is written five times on web.

### Facts (read by the lead on 2026-10-18 at `1aae88a44`)
- **The five copies.** Each calls `storeApi.getState().setMuted(chat.id, next ? 'forever' : null)` through `useAction`, then derives `busy = isWaiting(state)` and the failure:
  1. `apps/web/src/components/ContactPanel.tsx:104-110,127,131,152-157` (304 lines). Its `MUTE_ERROR` (`:35`) is "Could not update notifications. Try again."; the error is combined with the block error at `:130-132`.
  2. `apps/web/src/components/group-info/GroupInfoRoot.tsx:45,93-106` (246 lines), with the same `MUTE_ERROR` and `PanelFailure`.
  3. `apps/web/src/components/channel-info/ChannelInfoRoot.tsx:52,119-132` (334 lines), the same.
  4. `apps/web/src/components/ChannelComposerBar.tsx:28-37` (74 lines), via `fromApi`; it only uses `failed` (a boolean).
  5. `apps/web/src/components/topic/TopicMuteLeave.tsx:33-38` (91 lines), the same as 4.
- `useAction`, `isWaiting` and `failureOf` come from `@/lib/effect/use-action`. Web hooks live next to their components, for example `apps/web/src/components/useMessageListScroll.ts`.

### Steps
1. **The hook.** Create `apps/web/src/components/useMuteToggle.ts`:

   ```ts
   useMuteToggle(chat: ChatSummary): { muted: boolean; busy: boolean; error: string | undefined; toggle: () => void }
   ```

   - `muted` is `chat.muted === true`.
   - `toggle` ignores a second click while busy, and otherwise sets `'forever'` when unmuted and `null` when muted.
   - `error` is "Could not update notifications. Try again." after a failure, cleared while the next toggle runs, exactly like today.
2. **The callers.** All five use the hook.
   - Remove the local `MUTE_ERROR` constants that become unused.
   - Copies 4 and 5 use `error !== undefined` where they used `failed`.
   - Keep each caller's markup and wording unchanged.
3. **Tests.** No new tests (UI).
4. **Size.** Product lines must go down by at least 30. Report the counts.

### Allowed files
- `apps/web/src/components/useMuteToggle.ts`
- `apps/web/src/components/ContactPanel.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/channel-info/ChannelInfoRoot.tsx`
- `apps/web/src/components/ChannelComposerBar.tsx`
- `apps/web/src/components/topic/TopicMuteLeave.tsx`
- `work/T-2069-web-mute-toggle.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 30 lower.
- **Lead check, web mock:** mute and unmute work from the contact panel and the group info.

---

## Report (written by the worker when done)

### What I did

- Added `apps/web/src/components/useMuteToggle.ts`: `useMuteToggle(chat)` returns `{ muted, busy, error, toggle }`. It reads `chat.muted === true`, sends `'forever'` when unmuted and `null` when muted through the store's `setMuted`, ignores a second click while busy, and reports the fixed sentence "Could not update notifications. Try again." on failure (cleared while the next toggle runs).
- Replaced the five copies:
  - `ContactPanel.tsx`: mute action/state/toggle removed; its mute error now comes from the hook and still falls back to the block error.
  - `GroupInfoRoot.tsx` and `ChannelInfoRoot.tsx`: same hook, local `MUTE_ERROR` constants and `PanelFailure` mute paths removed; markup and wording unchanged.
  - `ChannelComposerBar.tsx` and `topic/TopicMuteLeave.tsx`: use `error !== undefined` where they used `failed`; their own displayed sentences are unchanged.
- No tests added (UI change, per spec).

Line counts (wc -l):
- Before, the five callers: 304 + 246 + 334 + 74 + 91 = 1049.
- After, the five callers: 287 + 226 + 316 + 64 + 83 = 976; plus the new 36-line hook = 1012.
- Net: 37 lines fewer including the hook (73 fewer in the callers alone).

### Checks run

- `pnpm install`: "Done in 16.9s using pnpm v10.32.1".
- `pnpm gate` (first run): GATE FAIL on `format` for `ChannelComposerBar.tsx`; everything else passed and scope was clean.
- `pnpm exec prettier --write apps/web/src/components/ChannelComposerBar.tsx`: reformatted (only that allowed file).
- `pnpm gate` (final run):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.4s)
PASS  typecheck  (3.3s)
PASS  effect  (0.7s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I did not run any test file separately: the gate reported no nearby test files for `@zilar/web`.

### Notes for the lead

- Mute/unmute in the live web UI was not exercised here; it still needs the lead's web mock check (contact panel and group info).
- Only the six allowed product files plus this task file were changed; the gate's scope check confirms it.

## Review (written by Claude)

Approved. The pre-review was clean (2 nits: a Report line count and a stale "(the hook's default mode)" note).
- **What changed.** `useMuteToggle(chat)` replaces five copies.
- **Size.** −43 product lines.
- **Lead Playwright check** (web mock, :5231):
  - opening the panel via "Open Ana …" and "Open Acme …" and toggling gives Mute → Unmute → Mute in both the contact panel and the channel info;
  - no page errors.
