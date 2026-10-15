---
id: T-1489
title: "Mobile turns on Android predictive back (MUX-24): app.json sets predictiveBackGestureEnabled to true, so Android 14+ shows the back preview; the lead tests every back path on the Android 16 emulator"
status: merged
milestone: M5
branch: task/T-1489-predictive-back
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1489: Predictive back on Android

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` (MUX-24, P3) found that predictive back is off, so Android 14+ users get no back preview. The audit's fix is to enable it once MUX-6 (back from a chat opened by a push goes to the chat list) is in. MUX-6 is merged: `goBackOrHome` is at `apps/mobile/src/lib/navigation.ts:10`.

### Facts (the lead read them on main, 2026-10-15)
- `apps/mobile/app.json:21` sets `"predictiveBackGestureEnabled": false` inside the `android` block.
- The app runs Expo `~57.0.25`, React Native `0.86.3` and react-native-screens `~4.26.0` (`apps/mobile/package.json`).
- **Back interceptors the change could affect (the lead tests each one):**
  - one `BackHandler` listener: `apps/mobile/src/components/chat/selection-bar.tsx:26`, where back leaves message selection;
  - six React Native `Modal`s close through `onRequestClose`, among them `confirm-dialog.tsx:57`, `attach-sheet.tsx:64`, `sticker-panel.tsx:251`, `emoji-sheet.tsx:102`, `image-viewer.tsx:203` and `ais/tool-detail-sheet.tsx:39`.

### What to build
1. In `apps/mobile/app.json`, change `"predictiveBackGestureEnabled": false` to `true`. Change nothing else.
2. No other file changes. If you believe another change is needed, write it in the Report and do not make it.

### Tests
None (a native config flag).

### Allowed files
`apps/mobile/app.json`, `work/T-1489-predictive-back.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Emulator (lead, Android 16, release build):** system back, both the key and the edge swipe, does the right thing on each path:
  - from a chat to the chat list;
  - in message selection, back clears the selection and stays in the chat;
  - an open sheet (attach, emoji, stickers), the image viewer and a confirm dialog each close, and the chat stays;
  - from Settings subpages back to Settings;
  - on the chat list, back leaves the app.
- If any path breaks, the lead drops the task and records why in NOW.md.

---

## Report (written by the worker when done)

### What I did
- Changed only the Android config flag in `apps/mobile/app.json:21` from `"predictiveBackGestureEnabled": false` to `"predictiveBackGestureEnabled": true`, as specified. No other file content changed.
- No other change was needed or made; the spec's item 2 is satisfied.

### Checks run
- `pnpm install` (repo root): done in 10.9s; one pre-existing peer-dependency warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18), unrelated to this change.
- `pnpm gate` (repo root): `gate: 2 changed file(s) against main` (`apps/mobile/app.json`, `work/T-1489-predictive-back.md`); `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `SKIP effect (no source files changed)`, `SKIP tests @zilar/mobile (no nearby test files)`; `scope: every changed file is inside the Allowed files`; ended with `GATE PASS`.
- No single test files were run: the change is a native config flag and the spec says no tests.

### Notes for the lead
- This is a config-only change; it is not verifiable from the CLI. Emulator verification (all back paths on Android 16, release build) is the lead's acceptance step and was not run here.
- Files changed: `apps/mobile/app.json`, `work/T-1489-predictive-back.md` (front matter status + this Report).


## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **The diff:** the one flag at `apps/mobile/app.json:21`. The pre-review packet was clean (nit 0) for head `e834eb9d3`.
- **The build:** the generated manifest has `enableOnBackInvokedCallback="true"`.
- **Emulator, Android 16** (gesture navigation, mock release build of this branch). Each path was tried with the back key and with an edge swipe:
  - **chat to the chat list:** pass;
  - **Sheets close and the chat stays:**
    - attach sheet: pass. Opening it raises the OS photo prompt; back dismissed the prompt without granting.
    - emoji, sticker and GIF panels: pass;
    - message menu: pass with the back key;
  - **Message selection** (the `BackHandler` at `selection-bar.tsx:26`): back clears the selection and stays in the chat. Pass.
  - **The delete dialog:** it closes and the message stays. Pass.
  - **The image viewer:** it closes and the chat stays. Pass.
  - **A Settings subpage** (Contacts) back to Settings, and Settings back to the list: pass;
  - **The chat list:** back goes to the launcher. Pass.
- **Logs:** no crash in the crash buffer and no React Native error lines.
- **Carried:**
  - `work/BOARD.md` drops the stale "Mobile markdown has no tables" follow-up and the dropped T-1298 row;
  - `docs/audit/findings-sweep-client.md` marks MP-9 not actionable (Telegram's group rule).
