// Middleware tags shared by the chain A groups (T-0892): groups, invite-links,
// roles, chat-folders, chat-prefs, topics. Tags only; the server implements
// them as layers and a client skips them (none is `requiredForClient`, none
// declares an error schema).

import { HttpApiMiddleware } from 'effect/http-api';
import type { CurrentUser } from './middleware';

/**
 * Renders a params, query or payload decode failure as 400 `invalid_request`.
 * It plays the role of `SchemaErrors` in `apps/server/src/effect/http-core.ts`
 * for the groups that moved into the contract.
 */
export class ChainASchemaErrors extends HttpApiMiddleware.Service<ChainASchemaErrors>()(
  'zilar/effect/http/ChainASchemaErrors',
) {}

/**
 * The join preview budget. It runs before the token is checked, so a malformed
 * token still spends budget.
 */
export class InviteLinksPreviewRateLimit extends HttpApiMiddleware.Service<
  InviteLinksPreviewRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/InviteLinksPreviewRateLimit') {}

/**
 * The role-change budget (T-0124): role changes hit ejabberd, so they are
 * capped per owner. It runs before the payload is decoded, so an invalid body
 * still spends budget.
 */
export class GroupsRoleRateLimit extends HttpApiMiddleware.Service<
  GroupsRoleRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsRoleRateLimit') {}

/**
 * The open-join budget (T-0164). It runs before the path is decoded, so a bad
 * group id still spends budget.
 */
export class GroupsJoinRateLimit extends HttpApiMiddleware.Service<
  GroupsJoinRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/GroupsJoinRateLimit') {}

/**
 * The topic-creation budget (T-0108): creating a topic hits ejabberd, so it is
 * capped per user. It runs before the payload is decoded, so an invalid body
 * still spends budget.
 */
export class TopicsCreateRateLimit extends HttpApiMiddleware.Service<
  TopicsCreateRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/TopicsCreateRateLimit') {}
