---
id: T-0356
title: "Mobile fix: the Profile settings buttons show their labels again (wrap the label in Text)"
status: todo
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

## Review (written by Claude)
