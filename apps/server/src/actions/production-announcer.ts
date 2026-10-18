import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Payload } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import type { ApprovalRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { approvalCardBody, buildApprovalCardPayload, type ActionAnnouncer } from './announce';

export interface ProductionAnnouncerLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ProductionAnnouncerDeps {
  db: ServerDatabase;
  domain: string;
  mucDomain: string;
  logger: ProductionAnnouncerLogger;
  // Resolved at call time because the action gateway is built before the agent gateway exists.
  getGateway: () => { postToChat(input: PostToChatInput): Promise<boolean> } | null;
}

export interface PostToChatInput {
  aiId: string;
  groupId: string | null;
  topicId?: string;
  text: string;
  payload?: Payload;
}

// Posts one message per tier-2 request and outcome through the AI's own session; failures are a no-op with one log line.
export function createProductionAnnouncer(deps: ProductionAnnouncerDeps): ActionAnnouncer {
  return {
    async approvalRequested(input: {
      aiId: string;
      groupId: string | null;
      topicId?: string;
      approvalId: string;
    }) {
      const gateway = deps.getGateway();
      if (gateway === null) {
        return;
      }
      const { aiId, groupId, topicId, approvalId } = input;
      const [row] = await runSql(
        deps.db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<ApprovalRow>`SELECT * FROM approvals WHERE id = ${approvalId} LIMIT 1`;
        }),
      );
      if (row === undefined) {
        deps.logger.warn({ aiId, approvalId }, 'approval row missing for announcer; skipping card');
        return;
      }
      const [aiRow] = await runSql(
        deps.db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ jid: string; owner: string }>`SELECT jid, owner FROM ais
            WHERE id = ${aiId} LIMIT 1`;
        }),
      );
      if (aiRow === undefined) {
        return;
      }
      const ownerJid = jidFor(localpartFor(aiRow.owner), deps.domain);
      let roomJid: string | null = null;
      if (topicId !== undefined) {
        const [topicRow] = await runSql(
          deps.db,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
              WHERE id = ${topicId} LIMIT 1`;
          }),
        );
        if (topicRow !== undefined) {
          roomJid = jidFor(topicRow.roomLocalpart, deps.mucDomain);
        }
      } else if (groupId !== null) {
        const [groupRow] = await runSql(
          deps.db,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
              WHERE id = ${groupId} LIMIT 1`;
          }),
        );
        if (groupRow !== undefined) {
          roomJid = jidFor(groupRow.roomLocalpart, deps.mucDomain);
        }
      }
      const payload = buildApprovalCardPayload({
        approval: row,
        aiJid: aiRow.jid,
        ownerJid,
        roomJid,
      });
      if (payload === null) {
        deps.logger.warn({ aiId, approvalId }, 'approval card is not valid; nothing was posted');
        return;
      }
      await gateway.postToChat({
        aiId,
        groupId,
        ...(topicId === undefined ? {} : { topicId }),
        text: approvalCardBody(row),
        payload,
      });
    },
    async outcome(input: {
      aiId: string;
      groupId: string | null;
      topicId?: string;
      status: 'executed' | 'failed' | 'cancelled';
      summary: string;
    }) {
      const gateway = deps.getGateway();
      if (gateway === null) {
        return;
      }
      const { aiId, groupId, topicId, summary } = input;
      await gateway.postToChat({
        aiId,
        groupId,
        ...(topicId === undefined ? {} : { topicId }),
        text: summary,
      });
    },
  };
}
