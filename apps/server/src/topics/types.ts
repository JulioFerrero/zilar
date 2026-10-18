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

/** One AI at work in a topic, with its state and picture. */
export interface TopicActivityEntry {
  aiId: string;
  name: string;
  /** The AI's bare JID, so the client can match its live card. */
  jid?: string;
  avatarUrl?: string;
  /** An open question makes the AI wait; this is the card's message id. */
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
  /** When a person marked the topic done, an ISO time, null when open;
   * optional only so older fixtures typecheck. */
  doneAt?: string | null;
  memberCount: number;
  /** The people in this topic (General: the whole group; otherwise its
   * `topic_members` plus role holders), sorted; optional only so older
   * fixtures typecheck. */
  memberIds?: string[];
  /** AIs added to this topic (never private names). */
  ais: TopicAiView[];
  /** roles with access to this topic (empty for public topics). */
  roles: TopicRoleView[];
  /** the role whose holders may decide approvals here, if any. */
  approverRole: { id: string; name: string } | null;
  /** The AIs at work in this topic, idle ones left out; filled on the list
   * routes only. */
  activity?: TopicActivityEntry[];
}

export interface TopicAiView {
  id: string;
  name: string;
  /** the AI's picture; omitted when it has none. */
  avatarUrl?: string;
  /** the AI's JID, so its row can open the AI's chat. */
  jid?: string;
}
