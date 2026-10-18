---
id: T-2117
title: "Store phase 2, T2: the pin permission rule (canPinFor), which also fixes the phone hiding Pin in channels for owners and admins — one shared copy in packages/client-core/src/store, both apps call it"
status: merged
milestone: M5
branch: task/T-2117-store-pins
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2117: Store phase 2, T2

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and web and phone share code. T-2112 read both stores and wrote the plan: `docs/audit/store-phase2-plan.md`.

### What to do
Do **task T2** exactly as the plan describes it, in section "2. Tasks", heading "### T2". The section gives the core function to add, the web and phone lines that shrink or go (`file:line`), and the tests that cover them.

Read the inventory section for your area (section 1) first. The lead accepted the plan's section 5 decisions:
- apply the returned detail when the route answers `GroupDetail`, and reload when it answers `void`;
- the role and invite wrappers stay.

Rules:
1. **Behaviour stays the same** on web and phone, except where the plan names a fix.
2. **Out of scope:** the message hot path (send, ledger, incoming). Do not touch it.
3. **Line numbers.** The plan's line numbers were read at `c0af99b3b`, and later merges may have moved them. Re-read each place before you edit it.
4. **Tests.** No new tests. Run the tests the plan names (`--reporter=dot`), then `pnpm gate`.
5. **Report** the line counts: web, phone, core and net.

### Allowed files
- `packages/client-core/src/store/pins.ts`
- `apps/web/src/store/realStore.ts`
- `apps/mobile/src/store/effects/pins.ts`
- `work/T-2117-store-pins.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 10 lower.
- **Lead check:** web mock: Pin shows on a message in a DM and in a group you own. Phone emulator: the channel screen opens.

---

## Report (written by the worker when done)

### What I did
- Added `canPinFor(chat, role)` to `packages/client-core/src/store/pins.ts`: a DM is always pin-able; a group or channel needs an `owner`/`admin` role. A missing chat still answers `false`, as before.
- Web: `apps/web/src/store/realStore.ts` `canPin` now only looks up the role in `groupInfos` and delegates the rule to `canPinFor`.
- Phone: `apps/mobile/src/store/effects/pins.ts` `canPinIn` delegates to `canPinFor` and drops the topic/`groupId` gate. The role now comes from the row's `myRole` (channels carry it) and otherwise from the loaded group detail, resolved through `ctx.h.groupIdForChat` so channel rows find their detail. The action-level guard in `pinMessage` stays unchanged.
- No new tests, as the spec says.

Line counts (diff against `main`, insertions/deletions):
- web: 2 / 10 → **−8**
- phone: 5 / 13 → **−8**
- core: 6 / 0 → **+6**
- net: 13 / 23 → **−10**

### Checks run
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/pins.test.ts` → 1 file passed, 5 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` → 1 file passed, 12 tests passed.
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (9.8s)
  PASS  effect  (1.5s)
  PASS  build @zilar/server  (0.8s)
  PASS  tests @zilar/client-core  (3.0s)
  PASS  tests @zilar/mobile  (7.5s)
  PASS  tests @zilar/web  (13.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead
- The channel fix relies on `ChatSummary.myRole`, which channel rows already carry (`chat-rows.ts`); topic rows fall back to the group detail role. This is why dropping the topic/`groupId` gate is enough for channels.
- I did not run the web mock or the phone emulator; the two lead checks (web Pin in a DM and an owned group, phone channel screen) still need Julio/you.
- No deviations from the spec, no new dependencies, no blocked items.


## Review (written by Claude)

Approved; the pre-review was clean. Net −10; one shared `canPinFor` rule in `packages/client-core/src/store/pins.ts` for both apps.
- **Web mock** (`:5246`, main side by side on `:5233`): the message menu offers "Pin" in Ana's DM, in Dev team (owned group) and in Acme Announcements (owned channel), identical on both. No page errors.
- **Phone emulator:** the smoke passed (`/chat/acme@rooms.zilar.test`, `/chat/ana@zilar.test`).
  - **The fix:** long-press on the Acme Announcements post now offers "Pin"; before, the phone hid it in channels.
  - Tapping it shows the pinned bar "You: Acme 2.4 is out…" at the top of the channel.
