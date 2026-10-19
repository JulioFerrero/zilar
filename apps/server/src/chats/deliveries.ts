import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { ownBareJid } from '../jid';
import { allowedArchives, type ArchivePool, type ArchiveRow } from '../search/service';
import type { TopicView } from '../topics/access';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { isOwnRow, type ChatUnread } from './unread';
const DELIVERED_NAMESPACE = 'urn:zilar:delivered:0';
const NO_STORE_NAMESPACE = 'urn:xmpp:hints';
export type DeliveryScope =
  { kind: 'dm'; authorLocalpart: string; callerBareJid: string } | { kind: 'room'; room: string };
export type DeliveryLookup = { chatJid: string; dmPeerUserId?: string; roomJid?: string };
export type DeliveredNotice = { authorBare: string; chatJid: string; until: string };
export async function deliveredForChats(
  db: ServerDatabase,
  options: { userId: string; callerJid: string; lookups: DeliveryLookup[] },
): Promise<Record<string, string>> {
  const peerIds = options.lookups.flatMap((lookup) =>
    lookup.dmPeerUserId === undefined ? [] : [lookup.dmPeerUserId],
  );
  const roomJids = options.lookups.flatMap((lookup) =>
    lookup.roomJid === undefined ? [] : [lookup.roomJid.toLowerCase()],
  );
  const [dmRows, roomRows] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const dm =
        peerIds.length === 0
          ? []
          : yield* sql<{
              userId: string;
              deliveredId: string;
            }>`SELECT user_id, max(delivered_id::bigint) AS delivered_id FROM chat_deliveries WHERE chat_jid = ${options.callerJid.toLowerCase()} AND user_id IN ${sql.in(peerIds)} GROUP BY user_id`;
      const rooms =
        roomJids.length === 0
          ? []
          : yield* sql<{
              chatJid: string;
              deliveredId: string;
            }>`SELECT chat_jid, max(delivered_id::bigint) AS delivered_id FROM chat_deliveries WHERE user_id <> ${options.userId} AND chat_jid IN ${sql.in(roomJids)} GROUP BY chat_jid`;
      return [dm, rooms] as const;
    }),
  );
  const marks = new Map<string, string>([
    ...dmRows.map((row) => [row.userId, String(row.deliveredId)] as const),
    ...roomRows.map((row) => [row.chatJid.toLowerCase(), String(row.deliveredId)] as const),
  ]);
  const answer: Record<string, string> = {};
  for (const lookup of options.lookups) {
    const mark = marks.get(lookup.dmPeerUserId ?? lookup.roomJid?.toLowerCase() ?? '');
    if (mark !== undefined) answer[lookup.chatJid] = mark;
  }
  return answer;
}
export function mergeTopicMarks(
  topics: TopicView[],
  unread: Record<string, ChatUnread>,
  deliveredMarks: Record<string, string>,
): TopicView[] {
  return topics.map((topic) => {
    const fields = unread[topic.chatJid];
    const delivered = deliveredMarks[topic.chatJid];
    if (fields === undefined && delivered === undefined) return topic;
    return {
      ...topic,
      ...(fields === undefined ? {} : { unread: fields.unread, lastMessage: fields.lastMessage }),
      ...(delivered === undefined ? {} : { deliveredUntil: delivered }),
    };
  });
}
export async function putDeliveredMark(
  db: ServerDatabase,
  config: ServerConfig,
  archive: ArchivePool | undefined,
  options: { bare: string; userId: string; originIds: readonly string[] },
): Promise<DeliveredNotice | undefined> {
  if (archive === undefined) return undefined;
  const allowed = await allowedArchives(db, config, options.userId);
  const ownJid = ownBareJid(allowed, config.xmpp.domain);
  const scope: DeliveryScope = allowed.rooms.some((room) => room.toLowerCase() === options.bare)
    ? { kind: 'room', room: options.bare }
    : {
        kind: 'dm',
        authorLocalpart: options.bare.slice(0, options.bare.indexOf('@')),
        callerBareJid: ownJid,
      };
  const values: unknown[] = [];
  const next = (value: unknown): string => `$${values.push(value)}`;
  const where =
    scope.kind === 'dm'
      ? `username = ${next(scope.authorLocalpart)} AND bare_peer = ${next(scope.callerBareJid)}`
      : `username = ${next(scope.room)}`;
  const ids = next(`{${options.originIds.map((id) => `"${id.replaceAll('"', '""')}"`).join(',')}}`);
  const rows = (await archive.query(
    `SELECT kind, nick, bare_peer AS "barePeer", xml, timestamp FROM archive WHERE ${where} AND origin_id = ANY(${ids})`,
    values,
  )) as unknown as ArchiveRow[];
  const timestamps = rows
    .filter((row) => !isOwnRow(row, ownJid))
    .map((row) =>
      typeof row.timestamp === 'bigint' ? row.timestamp.toString() : String(row.timestamp),
    );
  const [first, ...rest] = timestamps;
  if (first === undefined) return undefined;
  const until = rest.reduce((best, id) => (BigInt(id) > BigInt(best) ? id : best), first);
  const moved = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        deliveredId: string;
      }>`INSERT INTO chat_deliveries (user_id, chat_jid, delivered_id, updated_at) VALUES (${options.userId}, ${options.bare}, ${until}, now()) ON CONFLICT (user_id, chat_jid) DO UPDATE SET delivered_id = EXCLUDED.delivered_id, updated_at = EXCLUDED.updated_at WHERE EXCLUDED.delivered_id::bigint > chat_deliveries.delivered_id::bigint RETURNING delivered_id`;
    }),
  );
  return moved.length > 0 && scope.kind === 'dm'
    ? { authorBare: options.bare, chatJid: scope.callerBareJid, until }
    : undefined;
}
export function notifyDelivered(options: {
  adminClient: EjabberdAdminClient | undefined;
  logger: Logger;
  notice: DeliveredNotice;
}): Effect.Effect<void> {
  const { adminClient, logger, notice } = options;
  const escape = (value: string): string =>
    value.replace(
      /[&<>']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;' })[char]!,
    );
  return Effect.promise(async () => {
    try {
      if (adminClient === undefined) return;
      const at = notice.authorBare.indexOf('@');
      if (at <= 0) return;
      const resources = await adminClient.userResources(notice.authorBare.slice(0, at));
      await Promise.all(
        resources.map((resource) => {
          const to = `${notice.authorBare}/${resource}`;
          const stanza =
            `<message type='headline' from='${escape(notice.authorBare)}' to='${escape(to)}'>` +
            `<delivered xmlns='${DELIVERED_NAMESPACE}' chat='${escape(notice.chatJid)}' until='${escape(notice.until)}'/>` +
            `<no-store xmlns='${NO_STORE_NAMESPACE}'/></message>`;
          return adminClient.sendStanza(notice.authorBare, to, stanza).catch(() => undefined);
        }),
      );
    } catch {
      logger.warn({ chatJid: notice.chatJid, until: notice.until }, 'delivered notice failed');
    }
  });
}
export async function markDeliveredAndNotify(
  deps: {
    db: ServerDatabase;
    config: ServerConfig;
    archive: ArchivePool | undefined;
    adminClient?: EjabberdAdminClient;
    logger: Logger;
  },
  input: { bare: string; userId: string; originIds: readonly string[] },
): Promise<void> {
  const notice = await putDeliveredMark(deps.db, deps.config, deps.archive, input);
  if (notice !== undefined) {
    Effect.runFork(notifyDelivered({ adminClient: deps.adminClient, logger: deps.logger, notice }));
  }
}
