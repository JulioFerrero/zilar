---
id: T-0356
title: "Mobile fix: the Profile settings buttons show their labels again (wrap the label in Text)"
status: merged
milestone: M5
branch: task/T-0356-mobile-profile-button-labels
model: auto
effort: low
depends_on: [T-0349]
estimate: 0.1 day
---

# T-0356: Profile button labels

## Spec (written by Claude, do not edit)

### Why
QA run 27 (emulator, mock, main at 75617e36) shows every kit Button on Settings → Profile as a small blank pill with no label (`qa27/11.png`, seen by the lead). T-0349 caused it: it passed the label to `Button` as a bare string. React Native shows a label only when it is inside a `Text`, and the kit `Button` styles its label through a `Text` child that reads `TextClassContext`. Every other migrated screen wraps the label in `<Text>`.

### Verified facts (do not re-derive)
The lead found the bare-string labels by scanning every `<Button` outside `components/ui/`. They are only in these three files:
- `apps/mobile/src/app/settings/profile.tsx:323`: `Retry`
- `apps/mobile/src/app/settings/profile.tsx:370`: `{nameBusy ? 'Saving…' : 'Save name'}`
- `apps/mobile/src/components/settings/avatar-control.tsx:76`: `{currentUrl === undefined ? 'Add picture' : 'Change picture'}`
- `apps/mobile/src/components/settings/avatar-control.tsx:86`: `{phase.name === 'uploading' ? 'Working…' : 'Remove'}`
- `apps/mobile/src/components/settings/avatar-control.tsx:113`: `Save picture`
- `apps/mobile/src/components/settings/handle-field.tsx:80`: `{busy ? 'Saving…' : 'Save username'}`

All three files already import `Text` from `@/components/ui/text`.

Test: `apps/mobile/src/components/settings/settings-ui.test.tsx` renders `AvatarControl` and `HandleField` and mocks `Text` as the string tag `'Text'`.

### What to build
1. Wrap each of the six labels in `<Text>…</Text>`, with no className, as in `apps/mobile/src/app/settings/machines.tsx` (for example `<Button …><Text>Done</Text></Button>`).
2. In `settings-ui.test.tsx`, add one assertion each for `HandleField` and `AvatarControl`: the rendered markup contains the label inside a `Text` element, for example `<Text>Save username</Text>` and `<Text>Add picture</Text>`. These fail on the current code.
3. Report: say that the real check is on the emulator; the lead runs QA after the merge.

### Read first
`AGENTS.md`, the six lines above, `apps/mobile/src/app/settings/machines.tsx` (a correct kit Button label) and `apps/mobile/src/components/settings/settings-ui.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/avatar-control.tsx`, `apps/mobile/src/components/settings/handle-field.tsx`, `apps/mobile/src/components/settings/settings-ui.test.tsx`, `work/T-0356-mobile-profile-button-labels.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-ui
pnpm gate
```

### Acceptance
- All six labels are inside a `Text`.
- The new assertions pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Wrapped all six bare-string kit Button labels in `<Text>` with no className (matching machines.tsx):
- `apps/mobile/src/app/settings/profile.tsx`: Retry, Save name / Saving….
- `apps/mobile/src/components/settings/avatar-control.tsx`: Add/Change picture, Working…/Remove, Save picture.
- `apps/mobile/src/components/settings/handle-field.tsx`: Save username / Saving….
Added two assertions in `settings-ui.test.tsx`: AvatarControl markup contains `<Text>Add picture</Text>`; HandleField markup contains `<Text>Save username</Text>` (Text mocked as the `'Text'` tag, so these fail on the old code).
Files changed: the four Allowed files above (3 source + test + this task file).
Commands:
- `pnpm install`: pass (11.2s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-ui`: 13 passed, 1 file.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/mobile all PASS; scope: every changed file inside Allowed files (4 changed files).
Note: the real visual check is on the emulator; the lead runs QA after the merge.
Security checklist: no secrets, no deletes/updates, no caps, no routes, no audit entries — not applicable to this UI-label fix.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). All six labels are now inside `<Text>`. The new assertions pin the label inside a `Text` for `HandleField` and `AvatarControl`. Emulator confirmation is in QA run 28.
