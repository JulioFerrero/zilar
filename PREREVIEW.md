# T-0108 Pre-review (HEAD 72ed476)

## Checks (re-run by pre-reviewer)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (turbo 10/10; cached)
- `pnpm --filter @galena/server test --maxWorkers=2`: pass — 64 files passed, 5 skipped; 1094 passed, 7 skipped (~239s). Matches the Report's 1094.
- `pnpm build`: pass (2/2 turbo tasks)
- Banned-pattern sweep (`: any`, `@ts-ignore`, `*-disable`, `console.*`, TODO/FIXME) over all non-test, non-migration touched files: no hits.
- Scope: all 21 changed files are inside the spec's Allowed files. No web/mobile/packages/dependency changes.

## Findings

1. `apps/server/src/topics/service.ts:650,660,675` — should-fix (dead code)
   `syncGroupTopics`, `removeGroupMemberTopics`, and `archiveEmptyPrivateTopics` are exported but imported nowhere (only `groups/service.ts` has its own private copies of the same logic). AGENTS.md bans dead code; one copy should go.
   ```ts
   export async function syncGroupTopics(deps: TopicServiceDeps, groupId: string): Promise<void> {
   export async function removeGroupMemberTopics(
   export async function archiveEmptyPrivateTopics(
   ```
   The same applies to `canSeeTopicById` (`apps/server/src/topics/access.ts:107`), which has no callers.

2. `apps/server/src/groups/service.ts:687-689` — should-fix (accepted-deviation candidate, needs lead sign-off)
   Group add/remove syncs every topic room best-effort: on failure it logs and still answers 200, so the DB and the rooms can disagree with only a warn line marking it. Concrete scenario: ejabberd accepts the group-room removal but rejects a topic-room `setAffiliation` (the round-2 test proves this path exists) → the removed user keeps their affiliation in that public topic's room and keeps receiving its messages until the next membership change re-syncs. The Report discloses this, and answering 502 after a committed group change would be worse, but it bends the "never silently disagree" acceptance criterion — lead should explicitly accept or ask for a reconcile pass.
   ```ts
   } catch {
     logger.warn({ groupId }, 'could not sync a topic room after a group membership change');
   }
   ```

3. `apps/server/src/topics/routes.ts:122` — nit (disclosed extra)
   `POST /api/topics/:id/archive` is not in the spec's route list (spec has archive via `PATCH { archived: true }`). Harmless duplicate, covered by the sweep, but it is new API surface the lead didn't ask for.

No secret leakage found: `resolveOwnerName` selects `id,name` only, member lists return `userId,name`, all room-sync logs carry group id / room localpart / error class name, never a topic name; audit detail omits private names (test asserts it). No cross-user access found: every topic route goes through `requireVisibleTopic` (byte-identical 404 asserted in tests), manage/strip permissions match the spec, audit read filters private-topic entries per viewer. Rollback paths verified by reading: create destroys the room and deletes the row on any failure; patch answers 502 after commit per spec; last-member removal syncs the emptied room before returning. Tests assert on the fake's `affiliationState`, not just call counts, and the negative tests (hidden vs missing 404, audit-hider with `shown > 0` control) fail if the code is broken — not vacuous.

Verdict: no must-fix issues; merge once the dead exports are removed and the lead accepts the best-effort group-sync deviation.
