---
id: T-0381
title: "Web kit: Setup Back, handle Skip, Add machine Close, profile Copy share link and the sign-in Resend/Use a different email links use the kit Button"
status: todo
milestone: M5
branch: task/T-0381-web-auth-setup-text-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0381: onboarding and profile text buttons on the kit

## Spec (written by Claude, do not edit)

### Why
These six text buttons sit next to kit Buttons but are still hand-rolled.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants `default`, `outline` (`border-border-strong bg-surface … hover:bg-surface-raised`), `ghost` and `link` (`text-primary underline-offset-4 hover:underline`);
  - sizes `default` (h-8), `sm` (h-7) and `lg` (h-9);
  - `cn` merges a caller `className`.
  All five files already import `Button` from `@/components/ui/button`.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Sibling | Kit |
| --- | --- | --- | --- | --- |
| `apps/web/src/routes/SetupPage.tsx` | 209 | "Back" (`disabled={busy}`, onClick `setStep(1); setError(undefined);`, `rounded-full border border-input px-5 py-2.5`) | `<Button type="submit" size="lg" className="flex-1">` | `variant="outline" size="lg"` |
| `apps/web/src/routes/HandlePage.tsx` | 147 | "Skip for now" (`onClick={skip}`, `mt-2 w-full … text-muted-foreground`) | `<Button size="lg" className="mt-4 w-full">` Continue | `variant="ghost" size="lg"`, `className="mt-2 w-full text-muted-foreground"` |
| `apps/web/src/components/machines/AddMachineDialog.tsx` | 105 | "Close" (`onClick={onClose}`) | `<Button size="lg">` Try again | `variant="ghost" size="lg"` |
| `apps/web/src/components/ProfileSettingsSection.tsx` | 163 | "Copy share link" or "Copied" (`copyText(shareUrl)`) | the kit Save username Button | `variant="outline"` |
| `apps/web/src/components/auth/AuthFlow.tsx` | 189 | "Resend code" (`disabled={busy}`, `requestCode()`, `text-[14px] text-accent hover:underline`) | none | `variant="link" size="sm"`, `className="h-auto px-0 text-[14px] text-accent"` |
| same | 199 | "Use a different email" (`setStep('email'); setError(undefined);`, `text-[14px] text-muted-foreground hover:underline`) | none | `variant="link" size="sm"`, `className="h-auto px-0 text-[14px] text-muted-foreground"` |

- **Tests:**
  - `apps/web/src/routes/SetupPage.test.tsx`;
  - `apps/web/src/routes/HandlePage.test.tsx`;
  - `apps/web/src/components/machines/AddMachineDialog.test.tsx`;
  - `apps/web/src/components/ProfileSettingsSection.test.tsx`;
  - `apps/web/src/components/auth/AuthFlow.test.tsx`.

  They find buttons by role and name. Keep every text, `disabled` and handler.

### What to build
1. Replace the six buttons with `<Button type="button" …>`, using the table.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and each file around the line above.

### Allowed files
`apps/web/src/routes/SetupPage.tsx`, `apps/web/src/routes/HandlePage.tsx`, `apps/web/src/components/machines/AddMachineDialog.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/routes/SetupPage.test.tsx`, `apps/web/src/routes/HandlePage.test.tsx`, `apps/web/src/components/machines/AddMachineDialog.test.tsx`, `apps/web/src/components/ProfileSettingsSection.test.tsx`, `apps/web/src/components/auth/AuthFlow.test.tsx`, `work/T-0381-web-auth-setup-text-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot SetupPage HandlePage AddMachineDialog ProfileSettingsSection AuthFlow
pnpm gate
```

### Acceptance
- No hand-rolled `<button` remains in the five files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
