---
id: T-2163
title: "Clean-up (phone): blocks copied between two files of the same app or package get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2163-phone-clone-pairs
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2163: One home for blocks copied between files (phone)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead ran a clone scan at `2044ba9fe` that finds runs of 8 or more normalised lines shared by two files (comments, blanks, imports and lone braces ignored). Each row below is a pair of files with the copied ranges. A row with no ranges is a pair whose files share several small blocks; read both files to find them.

| Copy A | Copy B |
| --- | --- |
| `apps/mobile/src/app/settings/stickers.tsx:123-154` | `apps/mobile/src/components/stickers/use-stickers-panel.ts:286-317` |
| `apps/mobile/src/app/settings/profile.tsx:149-162` | `apps/mobile/src/components/settings/use-profile-settings.ts:399-412` |
| `apps/mobile/src/app/group/new.tsx:90-103` | `apps/mobile/src/components/chat/new-chat-button.tsx:479-491` |
| `apps/mobile/src/app/group-info/[id].tsx` | `apps/mobile/src/app/group/[id].tsx` |
| `apps/mobile/src/components/ais/screen-shell.tsx` | `apps/mobile/src/components/settings/screen-shell.tsx` |
| `apps/mobile/src/components/chat/chat-rows.tsx` | `apps/mobile/src/components/chat/topic-row.tsx` |
| `apps/mobile/src/app/settings/connections.tsx` | `apps/mobile/src/app/settings/machines.tsx` |
| `apps/mobile/src/app/settings/devices.tsx` | `apps/mobile/src/app/settings/connections.tsx` |
| `apps/mobile/src/components/chat/attachment-body.tsx` | `apps/mobile/src/components/chat/media-bubble.tsx` |

### Steps
For each pair, read both copies:
1. **Same code:** keep one copy where it fits best, usually the file the other already imports from, or the more general one. Export it and make the other file use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the pair.
3. **Look-alikes:** skip a pair whose copies only look alike (different props, different labels, different meaning) and say why.
4. **Keep the sum smaller:** a shared piece must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same values, the same markup, labels and styles, the same order of effects.
- Keep every "why" comment, once.
- Do not create a new file unless both copies have no better home.
- No new tests. Run the nearest existing tests with `--reporter=dot`.

### Allowed files
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/app/group/new.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/app/settings/devices.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/profile.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/chat-rows.tsx`
- `apps/mobile/src/components/chat/media-bubble.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/settings/use-profile-settings.ts`
- `apps/mobile/src/components/stickers/use-stickers-panel.ts`
- `work/T-2163-phone-clone-pairs.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each pair: merged (lines saved) or skipped (why).
- **Lead check:** phone emulator: Settings → Stickers, Profile, Connections, Machines, Devices; new group; group info; chat list topic rows; an AI settings screen; attachment and media bubbles.

---

## Report (written by the worker when done)

### What I did

Extended `SettingsScreenShell` so it can cover the other shell-shaped screens without changing what they render:

- `scroll` (default `true`; `false` renders the old non-scrolling `flex-1 p-4` body), `footer`, `after`, `contentClassName`, `contentPaddingBottom` and a `refreshControl` override.
- `AisScreenShell` now delegates to `SettingsScreenShell` with `scroll = false` as its default, so the AI screens keep their exact header, body and footer.
- `Connections` and `Devices` now render through `SettingsScreenShell` instead of hand-written `SafeAreaView` + `ScreenHeader` + `ScrollView` blocks. Their `paddingBottom: 32` is passed explicitly, Connections keeps its `gap-4 py-4` body, Devices keeps its own refresh control and its mock footer plus `ConfirmDialog` in `after`. Sheets/dialogs stay outside the scroll exactly as before.
- `ConnectionsHeader` is deleted; Connections uses the shell header with the same "Add key" button. `MachinesHeader` stays as the only copy.

Pair-by-pair result:

| Pair | Result |
| --- | --- |
| stickers vs `use-stickers-panel` | Skipped: look-alike. The screen's destructuring mirrors the hook's return object; merging would turn ~40 uses into `panel.x` and add lines. |
| profile vs `use-profile-settings` | Skipped: same interface look-alike as above. |
| `group/new` vs `new-chat-button` | Skipped: two four-line alert `Text` blocks with no shared home inside the Allowed files; a new component is longer than the copies. |
| `group-info/[id]` vs `group/[id]` | Skipped: the shared ranges are one small `useMemo` filter and one identical `NewTopicSheet` call site; their proper home (`use-group-new-topic`) is outside the Allowed files, and a wrapper costs more than it removes. |
| ais vs settings screen shells | Merged: `AisScreenShell` delegates to `SettingsScreenShell`; net -25 lines across the two shell files (shell +31, AI shell -56). |
| `chat-rows` vs `topic-row` | Skipped after an attempt: extracting the preview hook and line moved `topic-row` +70 and `chat-rows` -47 (net +23), so I reverted both files to `main` per the "keep the sum smaller" rule. |
| connections vs machines headers | Merged through the shell: Connections' duplicate header is gone and the shell renders it; `MachinesHeader` is untouched. |
| devices vs connections scroll shells | Merged: both use `SettingsScreenShell`; net -42 lines across the two screens (Connections -38, Devices -4). |
| `attachment-body` vs `media-bubble` | Skipped: the copies are two short `AlbumGrid`/`AttachmentViewer` call sites; sharing them needs extra props and adds more than it saves, and the two components are deliberate variants (bubble vs attachment body). |

Net product lines from `git diff main --numstat` (task file excluded): 294 added, 358 deleted, **-64**. The task file itself shows +83 against `main` because it is not on `main` in this worktree; it is not product code.

### Checks run

- `pnpm install` — Done in 15.6s.
- `pnpm gate` (final run, after reverting the pair-6 attempt):

```text
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.9s)
PASS  lint  (1.1s)
PASS  typecheck  (5.6s)
PASS  effect  (0.9s)
SKIP  build @zilar/server (no server, package or manifest change)
SKIP  tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/mobile/src/app/settings/connections.tsx: 582 lines (main 620); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No separate test file was run: the gate reported no nearby test files for this UI-only change.

### Notes for the lead

- Files changed: `apps/mobile/src/components/settings/screen-shell.tsx`, `apps/mobile/src/components/ais/screen-shell.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/app/settings/devices.tsx`, and this task file.
- Behaviour is intended to be unchanged: same header variant/subtitle/right slot, same scroll props, same `paddingBottom: 32`, same refresh wiring, same order of sheets and dialogs. Ais keeps `scroll = false` by default and its footer markup is unchanged.
- The only remaining gate warning is the soft 400-line limit on `connections.tsx` (582 lines, down from 620); no file crosses 800.
- Not smoke-tested on a phone; the acceptance lead check still covers Settings → Stickers, Profile, Connections, Machines, Devices, new group, group info, chat list topic rows, an AI settings screen, and attachment/media bubbles.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −64:
- The AIs screen shell and the settings screen shell are now one (`components/settings/screen-shell.tsx`), and the AIs one is a thin wrapper.
- Devices and Connections use it instead of their own header and scroll.

**Skipped:** five pairs (alert texts, a call site, the topic-row preview, which grew +23 and was reverted, and the album call sites). Reasons are in the Report.

**Comments:** none lost.

**Phone emulator smoke passed:** Devices (list, "Sign out all other devices", per-row Sign out, the mock footer), Connections, Approvals (the request row and Always allowed), Routines, Machines (the pairing code, Deny/Approve, the revoked row), Profile.
