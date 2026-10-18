---
id: T-2041
title: "Phone: leaving a topic as its last member succeeds (the server's 404 after the topic archives is treated like web: refresh the chat list and succeed when the row is gone) — plus three helper swaps to shared code (file size → formatFileSize, whistle formatMs → formatClock, push withTimeout → Effect.timeout) — with a test for the leave"
status: merged
milestone: M5
branch: task/T-2041-phone-last-seat-and-helpers
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2041: The phone's last-seat leave, plus small helper swaps (share plan Q6 and W1-b)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/share-plan.md` §4 (Q6, treated as a bug) and W1-b.
- **The bug.** Leaving a topic as its last member fails on the phone. When the last seat leaves, the server archives the topic and answers 404. Core treats that 404 as success after it re-reads the chat list, and web wires it up; the phone hard-codes `isNotFound: () => false`, so the user sees an error although they did leave.
- **The swaps.** Three phone helpers duplicate shared ones.

This is a permissions path, so the leave needs a test.

### Facts (read by the lead on 2026-10-18 at `25c19132d`)
- **Core.** `packages/client-core/src/store/group-actions.ts`, `leaveTopic(ctx, store, hooks, chatId)` (`:131-158`). On a failed `removeMember` with `hooks.isNotFound(error)`, it calls `hooks.refreshTopicRow(chatId, topicId)`. If that returns `true` (the row is gone), it calls `hooks.refreshChats()` and succeeds; otherwise it rethrows. `LeaveTopicHooks` is at `:115-122`.
- **Web wiring.**
  - `apps/web/src/store/effects/groupActions.ts:108` passes `refreshTopicRow: (chatId, topicId) => rt.runPromise(refreshTopicRow(ctx, chatId, topicId))`.
  - Web `refreshTopicRow` (`apps/web/src/store/effects/topics.ts:158-166`) runs `refreshChatsOrThrow(ctx)`, then returns `!ctx.get().chats.some((chat) => chat.id === chatId || chat.topic?.id === topicId)`.
- **Phone wiring.** `apps/mobile/src/store/effects/group-actions.ts` (326 lines), around `:130-142`, calls `leaveTopicCore(...)` with `{ isNotFound: () => false, refreshTopicRow: () => Effect.succeed(false), refreshChats: () => Effect.void }`. The phone history exposes `refreshChats` (`apps/mobile/src/store/effects/history.ts:40,187`) and is reachable as `fx.refreshChats` (see `apps/mobile/src/store/effects/groups.ts:274`).
- **The helper swaps:**
  - `apps/mobile/src/components/chat/file-bubble.tsx:148-` has `formatSize(bytes)`, the same body as `formatFileSize` (`packages/chat-core/src/media.ts`, exported from `@zilar/chat-core`).
  - `apps/mobile/src/app/dev/whistle.tsx:290-295` has `formatMs(value)`, which formats m:ss. Compare it with `formatClock` (`packages/chat-core/src/format-duration.ts:6`); swap only if the output is identical for the same input in ms or seconds, converting units at the call site.
  - `apps/mobile/src/lib/push/native.ts:96-106` has `withTimeout(task, ms)`, a `Promise.race` with `setTimeout`, used at `:263`. Replace it with `Effect.timeout` or `Effect.timeoutOrElse` around the call, failing with the same error message, `'push request timed out'`.

### Steps
1. **The leave.** In `apps/mobile/src/store/effects/group-actions.ts`:
   - `isNotFound` is true for an API error with `status === 404`; read how the phone's API errors carry `status`;
   - `refreshTopicRow` runs the phone's chat-list refresh, then returns whether no chat row has `id === chatId` or `topic?.id === topicId`;
   - `refreshChats` is the phone's refresh.

   The file stays at or under 400 lines.
2. **The test.** Add one test where the phone tests for group actions live; find them with `git grep -ln "leaveTopic" apps/mobile/src`. If none exists, add `apps/mobile/src/store/effects/group-actions.test.ts`, following the nearest mobile store test's setup. Cover:
   - `removeMember` fails with a 404 and the row is gone after the refresh: the leave succeeds;
   - a 404 where the row is still there, or a 500: the leave fails.
3. **The three swaps,** as described above. Remove each local helper.
4. **Size.** Report the line counts.

### Allowed files
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/group-actions.test.ts`
- `apps/mobile/src/components/chat/file-bubble.tsx`
- `apps/mobile/src/app/dev/whistle.tsx`
- `apps/mobile/src/lib/push/native.ts`
- `work/T-2041-phone-last-seat-and-helpers.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store/effects/group-actions.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The test passes, and the gate passes.
- File bubbles show the same size text.

---

## Report (written by the worker when done)

### What I did

**The last-seat leave (`apps/mobile/src/store/effects/group-actions.ts`, 326 → 341 lines).**
- `isNotFound` is now `error instanceof ApiError && error.status === 404` (`ApiError` from `@zilar/api-contract`, the shared error the topic routes reject with).
- `refreshTopicRow` runs the phone's quiet chat-list refresh (`refreshQuietly`, which wraps `fx.refreshChats`) and returns whether no row has `id === chatId` or `topic?.id === topicId`.
- `refreshChats` is the same quiet refresh.
- `removeMember` in the leave path is now a single `changeTopicCore(... topics.removeTopicMember ...)` call instead of `removeTopicMemberEffect`. `removeTopicMemberEffect` wraps the call in `failAfter(..., refreshQuietly)`, so on a 404 the list refresh dropped the row *before* core's `topicIdFor` ran, and the leave failed with "This topic is not available yet." instead of reaching the 404 handling. Web's remove path is likewise a single DELETE; the leave flow itself refreshes after the 404. The `removeTopicMember` action still uses `removeTopicMemberEffect`, unchanged.

**The test (`apps/mobile/src/store/effects/group-actions.test.ts`, new, 115 lines).**
`git grep -ln "leaveTopic" apps/mobile/src` found no test, only `types-groups.ts`, `effects/group-actions.ts` and `effects/groups.ts`, so I added the file, using the real-store setup from `real-store.history.test.ts` (`createRealChatStore`, `fakeApi`, `fakeAppState`, `createFakeXmppCore`) and injecting a fake `TopicsApi`. Three cases:
1. 404 and the refreshed list no longer has the row: the leave resolves, and the route was called with the topic id and `u-me`.
2. 404 with the row still in the list: the leave rejects with the server error.
3. 500 with the row gone: the leave still rejects (only 404 is treated as the archived topic).

Each case first asserts the topic row is in `store.getState().chats`, so they cannot pass because the row failed to load.

**Helper swaps.**
- `file-bubble.tsx` (164 → 147 lines): the local `formatSize` is gone and `sizeTypeOf` calls `formatFileSize` from `@zilar/chat-core`; the bodies were identical, so size text is unchanged.
- `push/native.ts` (278 → 265 lines): `withTimeout` is gone; `unregisterNativePush` now runs `Effect.timeoutOrElse(Effect.tryPromise(() => runApi(...)), { duration: Duration.millis(UNREGISTER_TIMEOUT_MS), orElse: () => Effect.fail(new Error('push request timed out')) })`. Same 3 s deadline and same error message.
- `whistle.tsx` (295 lines): **not swapped.** `formatMs` (`Math.round(value / 1000)`) and `formatClock` (`Math.floor(ms / 1000)`) differ for inputs with a 500–999 ms remainder (e.g. 1500 ms → `0:02` vs `0:01`), so the spec's "swap only if the output is identical" condition is not met. The local helper is unchanged.

### Checks run

- `pnpm install` — done.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/group-actions.test.ts` — 1 file passed, 3 tests passed.
- `pnpm gate` from the repo root (final):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (4.2s)
  PASS  format  (2.4s)
  PASS  lint  (1.4s)
  PASS  typecheck  (13.5s)
  PASS  effect  (6.8s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (16.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Deviation: the whistle `formatMs` → `formatClock` swap was skipped because the two round differently (see above). If you want the behaviour change (floor instead of round), say so and it is a two-line swap plus the call sites.
- Deviation: the leave's `removeMember` no longer uses `removeTopicMemberEffect`, for the race explained above. If you prefer to keep that helper, the alternative is to make its failure refresh not run for this path.
- The test's `topicsApi` fake only implements `removeTopicMember` and is cast to `TopicsApi`; the store never calls the other methods in these cases.

### Line counts

`group-actions.ts` 341, `group-actions.test.ts` 115, `file-bubble.tsx` 147, `native.ts` 265, `whistle.tsx` 295 (unchanged). All under 400.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **The fix.** Leaving a topic as its last member now succeeds on the phone, as on web: a 404 `ApiError` triggers a quiet chat-list refresh, and the leave succeeds when the row is gone. There's a new test covering gone, still-there and 500.
- **The swaps.** `file-bubble` uses `formatFileSize`, and push `withTimeout` became `Effect.timeout`.
- **Accepted deviations:**
  - the whistle `formatMs` stays, because `formatClock` rounds differently;
  - the leave uses one DELETE through `changeTopicCore`, so a failure refresh can't drop the row before core re-reads it.
