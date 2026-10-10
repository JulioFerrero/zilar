import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { InviteLogger } from '../groups/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { TopicKind, TopicRow, TopicStatus, TopicVisibility } from './access';

// The request bodies are validated at the Effect HTTP boundary in `api.ts`;
// these are the shapes the service accepts.
export interface CreateTopicBody {
  name: string;
  kind?: TopicKind | undefined;
  visibility?: TopicVisibility | undefined;
  memberIds?: string[] | undefined;
  glyph?: string | undefined;
  owner?: { kind: 'user' | 'ai'; id: string } | null | undefined;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
}

export interface PatchTopicBody {
  name?: string | undefined;
  glyph?: string | undefined;
  kind?: TopicKind | undefined;
  status?: TopicStatus | undefined;
  owner?: { kind: 'user' | 'ai'; id: string } | null | undefined;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
  archived?: true | undefined;
  visibility?: TopicVisibility | undefined;
  memberIds?: string[] | undefined;
  confirmExposeHistory?: boolean | undefined;
}

export interface TopicServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export interface CreateTopicInput extends CreateTopicBody {
  groupId: string;
  actorId: string;
}

export function defaultGlyph(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

// Audit detail for topic actions never contains the topic name for a private
// topic: ids and counts only.
export function auditDetail(topic: TopicRow, extra: Record<string, unknown> = {}) {
  if (topic.visibility === 'private') {
    return { topicId: topic.id, groupId: topic.groupId, ...extra };
  }
  return { topicId: topic.id, groupId: topic.groupId, name: topic.name, ...extra };
}

export function toAuditEntry(
  topic: TopicRow,
  action: string,
  actorUserId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    actorUserId,
    aiId: null as string | null,
    groupId: topic.groupId,
    action,
    subjectId: topic.id,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    detail: auditDetail(topic, extra),
  };
}
