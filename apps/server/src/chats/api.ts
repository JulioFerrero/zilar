import type { ServerCore } from '../app/deps';
import { Effect } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import { ChatsGroup } from '@zilar/api-contract';
import { buildDisplayed } from '@zilar/xmpp-core';
import type { HttpServerRequest } from 'effect/http';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder';
import {
  handler,
  httpErrorResponse,
  mountGroups,
  requestIdOf,
  type EffectApiMount,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { limiter } from '../rate-limit';
import type { ArchivePool } from '../search/service';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { chatAccessFromParam } from './access';
import { markDeliveredAndNotify } from './deliveries';
import { listChats } from './list';
import { putChatRead } from './reads';
import { kindFor, replyFor } from './reply-handler';
export interface ChatsApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  archive: ArchivePool | undefined;
  adminClient?: EjabberdAdminClient;
  getGateway?: () => TurnWatcher | null;
  now?: () => number;
}
type ChatJidRequest = { params: { jid: string }; request: HttpServerRequest.HttpServerRequest };
const MAX_ARCHIVE_ID = 9223372036854775807n;
function rateLimited(request: ChatJidRequest, message: string) {
  return httpErrorResponse(
    requestIdOf(request.request),
    new HttpError(429, 'rate_limited', message),
  );
}
async function dmAccess(deps: ChatsApiDependencies, encodedJid: string, userId: string) {
  const { bare } = await chatAccessFromParam(deps, encodedJid, userId);
  if (kindFor(bare, deps.config.xmpp.mucDomain) === 'groupchat') {
    throw new HttpError(400, 'invalid_request', 'Only direct chats');
  }
  return bare;
}
const AUDIT_DEFAULTS = {
  aiId: null,
  groupId: null,
  subjectId: null,
  argsHash: null,
  costCurrency: null,
  costAmount: null,
  result: 'ok',
} as const;
function auditDelete(
  audit: AuditRecorder,
  userId: string,
  action: string,
  bare: string,
  deleted: number,
) {
  return audit.record({
    ...AUDIT_DEFAULTS,
    actorUserId: userId,
    action,
    detail: { chatJid: bare, deleted },
  });
}
async function deleteOwn(
  deps: ChatsApiDependencies,
  audit: AuditRecorder,
  userId: string,
  bare: string,
  archiveId?: string,
): Promise<void> {
  if (deps.archive === undefined) throw xmppUnavailable();
  if (archiveId !== undefined && (!/^\d+$/.test(archiveId) || BigInt(archiveId) > MAX_ARCHIVE_ID)) {
    throw new HttpError(400, 'invalid_request', 'archiveId must be an archive id');
  }
  const username = localpartFor(userId);
  const deleted =
    archiveId === undefined
      ? await deps.archive.query(
          'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 RETURNING timestamp',
          [username, bare],
        )
      : await deps.archive.query(
          'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 AND timestamp = $3 RETURNING timestamp',
          [username, bare, archiveId],
        );
  if (archiveId !== undefined) {
    if (deleted.length === 0) throw new HttpError(404, 'not_found', 'Message not found');
    await auditDelete(audit, userId, 'chat.message_deleted', bare, 1);
    return;
  }
  await Promise.all([
    runSql(
      deps.db,
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`DELETE FROM chat_reads WHERE user_id = ${userId} AND chat_jid = ${bare}`,
      ),
    ),
    runSql(
      deps.db,
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`DELETE FROM chat_deliveries WHERE user_id = ${userId} AND chat_jid = ${bare}`,
      ),
    ),
  ]);
  await auditDelete(audit, userId, 'chat.history_cleared', bare, deleted.length);
}
const ChatsApi = HttpApi.make('chats').add(ChatsGroup);
export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimit = limiter('chatRead', now);
  const replyLimit = limiter('chatReply', now);
  const historyLimit = limiter('chatHistoryWrite', now);
  const audit = createAuditRecorder({ db: deps.db, logger });
  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listChats(deps, user.id)),
      )
      .handle(
        'markRead',
        handler(logger, async (request, user) => {
          const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
          if (!readLimit.allow(user.id))
            return rateLimited(request, 'Too many read updates, try again later');
          await putChatRead(deps.db, {
            bare,
            userId: user.id,
            messageId: request.payload.messageId,
          });
          const displayed = request.payload.displayed;
          if (displayed === undefined || deps.adminClient === undefined) return;
          try {
            const callerBare = jidFor(localpartFor(user.id), deps.config.xmpp.domain);
            const stanza = buildDisplayed({
              chatJid: bare,
              kind: kindFor(bare, deps.config.xmpp.mucDomain),
              messageId: displayed,
            }).toString();
            await deps.adminClient.sendStanza(callerBare, bare, stanza);
          } catch {
            deps.logger.warn({ userId: user.id, chatJid: bare }, 'read marker send failed');
          }
        }),
      )
      .handle(
        'markDelivered',
        handler(logger, async (request, user) => {
          const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
          if (!readLimit.allow(user.id))
            return rateLimited(request, 'Too many delivered updates, try again later');
          await markDeliveredAndNotify(deps, {
            bare,
            userId: user.id,
            originIds: request.payload.originIds,
          });
        }),
      )
      .handle(
        'clearHistory',
        handler(logger, async (request, user) => {
          const bare = await dmAccess(deps, request.params.jid, user.id);
          if (!historyLimit.allow(user.id))
            return rateLimited(request, 'Too many history changes, try again later');
          await deleteOwn(deps, audit, user.id, bare);
        }),
      )
      .handle(
        'deleteForMe',
        handler(logger, async (request, user) => {
          const bare = await dmAccess(deps, request.params.jid, user.id);
          if (!historyLimit.allow(user.id))
            return rateLimited(request, 'Too many history changes, try again later');
          await deleteOwn(deps, audit, user.id, bare, request.params.archiveId);
        }),
      )
      .handle(
        'reply',
        handler(logger, (request, user) => replyFor(deps, replyLimit, request, user)),
      ),
  );
  return mountGroups(ChatsApi, groupLayer, { auth: deps.auth, logger, schemaErrors: true });
}
