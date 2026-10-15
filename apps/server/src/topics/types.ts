// Topic schemas and view types. Split out of `./access` (T-1546) so both files
// stay under the 400-line limit; `./access` re-exports all of them.

import { Schema } from 'effect';
import type { TopicRow } from '../db/rows';
import type { AiActivityState } from './ai-activity';

export const topicVisibilitySchema = Schema.Literals(['public', 'private']);
export type TopicVisibility = typeof topicVisibilitySchema.Type;

export const topicKindSchema = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);
export type TopicKind = typeof topicKindSchema.Type;

export const topicStatusSchema = Schema.Literals([
  'open',
  'in_progress',
  'in_review',
  'blocked',
  'done',
]);
export type TopicStatus = typeof topicStatusSchema.Type;

export type { TopicRow };

export interface TopicOwnerView {
  kind: 'user' | 'ai';
  id: string;
  name: string;
}

export interface TopicRoleView {
  id: string;
  name: string;
  memberCount: number;
}

/** T-1514: one AI at work in a topic, with its state and its picture. */
export interface TopicActivityEntry {
  aiId: string;
  name: string;
  /** T-1537: the AI's bare JID, so the client can match its live card. */
  jid?: string;
  avatarUrl?: string;
  /** T-1577: an open question makes the AI wait; this is the card's message id. */
  questionId?: string;
  state: AiActivityState;
}

export interface TopicView {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: TopicOwnerView | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  /** T-1521: when a person marked the topic done, an ISO time, null when open.
   * Set on every route by `buildTopicView`; optional only so older fixtures
   * that predate the field still typecheck. */
  doneAt?: string | null;
  memberCount: number;
  /** AIs added to this topic (never private names). */
  ais: TopicAiView[];
  /** T-0116: roles with access to this topic (empty for public topics). */
  roles: TopicRoleView[];
  /** T-0116: the role whose holders may decide approvals here, if any. */
  approverRole: { id: string; name: string } | null;
  /** T-1514: the AIs at work in this topic (idle ones left out), filled on the
   * list routes only; absent on the single-topic routes. */
  activity?: TopicActivityEntry[];
}

export interface TopicAiView {
  id: string;
  name: string;
}
