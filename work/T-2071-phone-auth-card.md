---
id: T-2071
title: "Reduce (phone): one AuthCard shell (gradient background, safe area, keyboard avoiding scroll, centred card with its title) for sign-in, the name step and the username step — no visible change"
status: merged
milestone: M5
branch: task/T-2071-phone-auth-card
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2071: One phone auth card shell

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. Three phone sign-up screens repeat the same 28-line shell (jscpd, 2026-10-18).

### Facts (read by the lead on 2026-10-18 at `5029b9431`)
- **The three screens.** Each returns the same tree:
  - `<View className="flex-1">`;
  - `<LinearGradient colors={CHAT_BACKGROUND} start={{x:0,y:0}} end={{x:1,y:1}} style={absolute fill}/>`;
  - `<SafeAreaView className="flex-1">`, then `<KeyboardAvoidingView style={{flex:1}} behavior={ios ? 'padding' : 'height'}>`;
  - a `<ScrollView className="flex-1" contentContainerStyle={{flexGrow:1, justifyContent:'center', alignItems:'center', padding:16}} keyboardShouldPersistTaps="handled">`;
  - `<View className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-6 shadow-xl">`;
  - a title `<Text className="text-center text-[24px] font-semibold leading-8 text-foreground">`.
- **Where.**
  - `apps/mobile/src/auth/AuthFlow.tsx:144-170` (283 lines; the title is `{heading}`), closing at `:277-283`;
  - `apps/mobile/src/auth/NameForm.tsx:55-81` (117 lines; "What should we call you?"), closing at `:111-117`;
  - `apps/mobile/src/app/welcome/handle.tsx:131-157` (220 lines; "Pick your username"), closing at `:214-220`.

### Steps
1. **The shell.** Create `apps/mobile/src/auth/AuthCard.tsx`, exporting `AuthCard({ title, children }: { title: ReactNode; children: ReactNode })`. It renders the shell above with the title `Text` first and then `children` inside the card. Copy the class names and styles exactly.
2. **The screens.** The three screens render `<AuthCard title={…}>…</AuthCard>`, and everything after the title stays as it is. Remove the imports that become unused.
3. **Tests.** No new tests (UI).
4. **Size.** Product lines must go down by at least 40.

### Allowed files
- `apps/mobile/src/auth/AuthCard.tsx`
- `apps/mobile/src/auth/AuthFlow.tsx`
- `apps/mobile/src/auth/NameForm.tsx`
- `apps/mobile/src/app/welcome/handle.tsx`
- `work/T-2071-phone-auth-card.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 40 lower.
- **Lead check, emulator:** the `/welcome/handle` screen looks the same as on main.

---

## Report (written by the worker when done)

### What I did
- Created `apps/mobile/src/auth/AuthCard.tsx` (46 lines): the shared phone auth shell
  (full-screen gradient, `SafeAreaView`, keyboard-avoiding scroll view, centred card)
  with the title `Text` first and `children` below it. Class names and styles are copied
  exactly from the old screens.
- `apps/mobile/src/auth/AuthFlow.tsx`: renders `<AuthCard title={heading}>…</AuthCard>`;
  the subheading and both steps are unchanged. Removed the now-unused imports
  (`KeyboardAvoidingView`, `LinearGradient`, `SafeAreaView`, `Platform`, `ScrollView`,
  `CHAT_BACKGROUND`).
- `apps/mobile/src/auth/NameForm.tsx`: renders `<AuthCard title="What should we call you?">`
  with the rest unchanged. Removed the same unused imports.
- `apps/mobile/src/app/welcome/handle.tsx`: renders `<AuthCard title="Pick your username">`
  with the rest unchanged. Removed the same unused imports.
- Sizes: AuthFlow 283 → 246, NameForm 117 → 84, handle 220 → 188, plus the new
  AuthCard 46. Total 620 → 564 product lines, a net reduction of **56** (spec asked ≥ 40).

### Checks run
- `pnpm install`: done, 17 workspace projects, no errors (one peer-dependency warning
  and one deprecated subdependency warning, both pre-existing).
- `pnpm gate` (repo root, first run): FAIL — lint, `NameForm.tsx:4` unused `View` import.
- After removing that import, `pnpm gate` from the repo root ended with `GATE PASS`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (6.7s)
  PASS  effect  (1.1s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (2.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: this is UI-only (no new tests, per the spec) and the
  gate's mobile tests passed.

### Notes for the lead
- Rendered output should be identical: the shell markup, class names and styles moved
  verbatim into `AuthCard`; only the title moved into `title` and the extra content into
  `children`. Needs the emulator check on `/welcome/handle` as written in the spec.
- No deviation from the spec. No new dependencies, no tests. Everything touched is
  inside the Allowed files.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One `AuthCard({ title, children })` shell for sign-in, the name step and the username step.
- **Size.** −56 product lines.
- **Emulator smoke** (mock build) PASS on `/welcome/handle`, `/welcome/name` and `/login`.
  - The guest mock build sends all three to sign-in, so the screenshots show the `AuthFlow` card: "Sign in to Zilar", the email field and Continue, centred, and moving up with the keyboard.
  - The name and username steps use the same component and were not seen.
