---
id: T-2205
title: "Server tests, wave C: topic activity and preview, AI catalog and model client, tools, sticker links, drafts and other feature tests cut to the few that pin permissions, keys, delivery or input limits"
status: merged
milestone: M5
branch: task/T-2205-server-tests-cut-c
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2205: Server tests outside the crucial areas, wave C

## Spec (written by Claude, do not edit)

### The rule (Julio, 2026-10-10 and 2026-10-19)
Tests exist only for crucial code: auth and keys, permissions and money, and the message pipeline. On 2026-10-19 Julio chose to cut the server tests outside those areas "to a few each".

In each file below, **keep only the cases that pin one of these**, at most about 4 per file:
- **Who may:** permission, ownership, membership, admin-only, another user's data refused, a non-member refused.
- **Money:** spend limits, usage, budgets, prices.
- **Keys and secrets:** a key or token is never returned, logged or sent where it must not go.
- **Message delivery:** sent once, to the right room, never duplicated, never sent to the wrong person.
- **Safety limits on untrusted input:** private or loopback addresses refused (SSRF), size and count caps, sanitising, injection.

**Delete every other case:** wording and text, ordering, formatting, default values, response shape, and logging details.

If a file has no case of those kinds, keep its single most basic happy-path case, so the module still loads under test. Then delete the helpers, fixtures and imports in the same file that become unused.

### Files (2,834 test lines, counted on 2026-10-19)
- `apps/server/src/topics/ai-activity.test.ts` (524)
- `apps/server/src/topics/preview.test.ts` (327)
- `apps/server/src/topics/ais.test.ts` (205)
- `apps/server/src/topics/one-step-add.test.ts` (112)
- `apps/server/src/topics/visible-batch.test.ts` (140)
- `apps/server/src/ai/catalog.test.ts` (85)
- `apps/server/src/ai/model-client.test.ts` (338)
- `apps/server/src/ai/model-client.openai-compatible.test.ts` (162)
- `apps/server/src/tools/card-header.test.ts` (46)
- `apps/server/src/tools/routine-schedule-prompt.test.ts` (302)
- `apps/server/src/stickers/pack-link.test.ts` (172)
- `apps/server/src/notify/ai-cards.test.ts` (91)
- `apps/server/src/web-tools/adapters.test.ts` (85)
- `apps/server/src/drafts/hub.test.ts` (61)
- `apps/server/src/chat-prefs/unread-mark.test.ts` (123)
- `apps/server/src/startup/post-as-ai.test.ts` (54)

**Not in this wave (they stay as they are):** the auth, keys and crypto tests (`setup/*`, `effect/crypto-envelope`, `xmpp/token`), `ai/cost.test.ts` (money), `avatars/access.test.ts` (permissions), `leader/lock.test.ts`, and all the topics public / join / patch / member tests.

### Steps
1. Work one file at a time. List its cases, mark each keep or delete by the rule above, delete, and run that file with `--reporter=dot`.
2. In the model client tests, keep the cases that prove a provider key is never logged or returned, and the timeout and abort cases.
3. Change test files only: no product code, no other test file.
4. In the Report, give one line per file: cases before → after, lines before → after, and which kept cases pin what.

### Allowed files
- The 16 test files listed above
- `work/T-2205-server-tests-cut-c.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/ai-activity.test.ts src/topics/preview.test.ts src/topics/ais.test.ts src/topics/one-step-add.test.ts src/topics/visible-batch.test.ts src/ai src/tools src/stickers/pack-link.test.ts src/notify src/web-tools src/drafts src/chat-prefs src/startup --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- Only the listed test files change.
- These files lose at least 40% of their lines (at least −1,130).

---

## Report (written by the worker when done)

### What I did

Cut the 16 listed test files to the cases that pin permissions/ownership, money, keys/secrets,
message delivery, or safety limits on untrusted input. Two files already held only one such case
and are unchanged: `topics/one-step-add.test.ts` (permission) and `topics/visible-batch.test.ts`
(permission). Only test files and this task file changed.

Totals: **94 → 24 cases**, **2,827 → 1,523 lines** (`wc -l` before and after; −1,304, −46.1%,
acceptance needed at least −1,130). On review, the delivery (streamed call not retried) and keys
(rejected key reply) cases were restored to `ai/model-client.test.ts`, exactly as on `main`.

### Per file (cases before → after, lines before → after, what the kept cases pin)

- `topics/ai-activity.test.ts` 11 → 1, 524 → 150. No case pinned a crucial area; kept the single most basic happy path: a running AI is marked working in its own room and not attributed to another topic.
- `topics/preview.test.ts` 5 → 1, 327 → 184. Permission: a member may preview a public topic, while a private topic, General and an outsider all answer the same 404 as a missing id.
- `topics/ais.test.ts` 4 → 1, 205 → 120. Count cap: two concurrent adds to a group one short of `MAX_GROUP_MEMBERS` both resolve and the membership plus AI count stays at the cap.
- `topics/one-step-add.test.ts` 1 → 1, 112 → 112. Unchanged. Permission: a plain member adding an outsider gets 403 and neither a group nor a topic row is written.
- `topics/visible-batch.test.ts` 1 → 1, 140 → 140. Unchanged. Permission: the batched read matches `visibleTopics` per group across membership, private rows, role access, archives and an outsider group.
- `ai/catalog.test.ts` 3 → 1, 85 → 27. Untrusted input size cap: a models.dev body above the old 5 MB cap is still accepted.
- `ai/model-client.test.ts` 11 → 3, 338 → 108. Message delivery: a call that already streamed is never retried, so the reply is not duplicated. Keys: a rejected key maps to its fixed reply and a 401. Timeout/abort: a retry gets only the remaining deadline and ends with status 0, not a fresh full timeout.
- `ai/model-client.openai-compatible.test.ts` 4 → 2, 162 → 133. SSRF: a caller-supplied `fetchImpl` cannot bypass the pinned fetch, and a 302 redirect is not followed to a second path.
- `tools/card-header.test.ts` 4 → 1, 46 → 24. No case pinned a crucial area; kept the single happy path that describes a valid card.
- `tools/routine-schedule-prompt.test.ts` 8 → 4, 302 → 199. Input limits: mixed tool and prompt args are refused, and a prompt is cut at 500 characters. Host allowlist: a tool-form routine binds the saved tool hosts. Permission: an alert card drives a routine only for this AI, in this chat, with that block.
- `stickers/pack-link.test.ts` 6 → 3, 172 → 135. Permission: a non-owner may read a private pack, editing and deleting stay owner-only (404), and an imported pack is hidden from everyone but its importer (read and panel add both 404).
- `notify/ai-cards.test.ts` 8 → 1, 91 → 19. No case pinned a crucial area; kept the single happy path that decodes a progress payload as the live AI UI.
- `web-tools/adapters.test.ts` 19 → 1, 85 → 28. No case pinned a crucial area; kept the single happy path that parses price, currency, time and symbol.
- `drafts/hub.test.ts` 4 → 1, 61 → 22. Isolation: a subscriber never receives another owner's frame.
- `chat-prefs/unread-mark.test.ts` 2 → 1, 123 → 84. Isolation/scoped update: reading a chat clears only the caller's unread mark and leaves the other user's mark set.
- `startup/post-as-ai.test.ts` 3 → 1, 54 → 38. Message delivery: the card payload is forwarded unchanged to the gateway, not dropped.

### Commands and real results

- `pnpm install` → done in 16.9s; no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <the 16 test files>` → **16 files passed, 22 tests passed** (13.85s). This is the task's checks command with the worker cap AGENTS.md requires.
- `pnpm gate` (first run) → `FAIL format`: Prettier wanted a reflow in `topics/ai-activity.test.ts`; also printed the scope line below. Fixed with `pnpm exec prettier --write apps/server/src/topics/ai-activity.test.ts`.
- `pnpm --filter @zilar/server exec vitest run src/ai/model-client.test.ts --reporter=dot` (after restoring the two cases) → **1 file passed, 3 tests passed** (8.35s).
- `pnpm gate` (final) → **GATE PASS**. Summary:
  - `PASS install (frozen) (1.1s)`, `PASS format (1.4s)`, `PASS lint (0.8s)`, `PASS typecheck (3.3s)`
  - `SKIP effect (no source files changed)`, `PASS build @zilar/server (0.5s)`, `PASS tests @zilar/server (10.9s)`
  - `migration`, `images`, `size`, `comments` all reported clean.

### Deviation: gate scope line

The gate ends with `GATE PASS` but prints `scope: 14 file(s) outside the Allowed files`, listing
exactly the 14 test files I edited (the other two listed files were unchanged). The scope check
only reads backticked paths in the Allowed files section (`packages/devtools/src/gate/scope.ts`),
and that section names the files by reference ("The 16 test files listed above"), so it cannot
expand them. Every listed file is one of the 16 under "Files" in this spec, and no other file
changed. I did not edit the Spec to work around it; the lead can spell the 16 paths out in
Allowed files if the scope line should be clean.

### Problems / questions

- None blocking.


## Review (written by Claude)

Approved. The pre-review was clean (2 nits, nothing blocking). Test-only: 16 files go from 94 to 24 cases, −1,175 lines.

The kept cases pin:
- **Permissions:** topic preview, one-step add, visible-batch, sticker pack owner-only and imported packs.
- **Caps:** the group AI count cap, the models.dev size cap, the routine prompt and arguments limits.
- **SSRF:** the pinned fetch, no redirect follow.
- **Isolation:** draft frames, the unread mark.
- **Delivery:** the post-as-AI payload.
- **Keys:** after the fix round, the rejected-key reply. Also the no-retry-after-streaming case, so a reply is never duplicated.

Cases that pinned only cosmetic or parse details went.
