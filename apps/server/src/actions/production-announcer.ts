import { eq } from 'drizzle-orm';
import type { Payload } from '@galena/protocol';
import type { ServerDatabase } from '../db/client';
import { ais, approvals, groups, topics } from '../db/schema';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { approvalCardBody, buildApprovalCardPayload, type ActionAnnouncer } from './announce';

// The narrow slice of pino the production announcer needs. Real wiring
// passes the server's logger; tests pass a captor.
export interface ProductionAnnouncerLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface ProductionAnnouncerDeps {
  db: ServerDatabase;
  domain: string;
  mucDomain: string;
  logger: ProductionAnnouncerLogger;
  /**
   * Resolves the agent gateway at call time (not at build time): the
   * action gateway is built before the agent gateway exists, so the
   * announcer closes over this accessor and the calls resolve at runtime
   * once the gateway is wired. Null (or a stopped gateway) means every
   * announcement is a no-op — `postToChat` would answer `false` anyway.
   */
  getGateway: () => { postToChat(input: PostToChatInput): Promise<boolean> } | null;
}

export interface PostToChatInput {
  aiId: string;
  groupId: string | null;
  topicId?: string;
  text: string;
  payload?: Payload;
}

// The production announcer (T-0092, topic wiring T-0110): turns a tier-2
// request and its outcome into one chat message each, posted through the
// AI's own live XMPP session. A card requested in a topic goes into that
// topic's room (never bare General); a personal-chat request goes to the
// owner's DM. Every failure is a no-op with one log line: the gateway
// never lets an announcement change an outcome, a row or an audit entry.
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
      const [row] = await deps.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .limit(1);
      if (row === undefined) {
        deps.logger.warn({ aiId, approvalId }, 'approval row missing for announcer; skipping card');
        return;
      }
      const [aiRow] = await deps.db
        .select({ jid: ais.jid, owner: ais.owner })
        .from(ais)
        .where(eq(ais.id, aiId))
        .limit(1);
      if (aiRow === undefined) {
        return;
      }
      const ownerJid = jidFor(localpartFor(aiRow.owner), deps.domain);
      let roomJid: string | null = null;
      if (topicId !== undefined) {
        const [topicRow] = await deps.db
          .select({ roomLocalpart: topics.roomLocalpart })
          .from(topics)
          .where(eq(topics.id, topicId))
          .limit(1);
        if (topicRow !== undefined) {
          roomJid = jidFor(topicRow.roomLocalpart, deps.mucDomain);
        }
      } else if (groupId !== null) {
        const [groupRow] = await deps.db
          .select({ roomLocalpart: groups.roomLocalpart })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);
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
