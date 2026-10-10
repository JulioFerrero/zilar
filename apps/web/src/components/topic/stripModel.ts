import type { ChatSummary } from '@zilar/chat-core';
import { jidLocal } from '@zilar/protocol';
import { Option, Schema } from 'effect';
import type { PatchTopicInput, TopicStatus } from '@/lib/api';

export const SAVE_FAILED = 'Could not save. Try again.';

export interface TopicChange {
  readonly input: PatchTopicInput;
  /** Puts the topic back as it was before the optimistic change. */
  readonly rollback: () => void;
}

export const STATUS_ORDER: TopicStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'done'];

export const STATUS_LABEL: Record<TopicStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};

// The status dot is always paired with its text, never color alone.
export const STATUS_DOT: Record<TopicStatus, string> = {
  open: 'bg-[#8a8a8a]',
  in_progress: 'bg-amber-400',
  in_review: 'bg-blue-400',
  blocked: 'bg-red-400',
  done: 'bg-green-400',
};

export function typeLabel(chat: ChatSummary): string {
  const topic = chat.topic;
  if (topic === undefined) {
    return 'TOPIC';
  }
  if (topic.isGeneral) {
    return 'GENERAL';
  }
  switch (topic.kind) {
    case 'task':
      return 'TASK';
    case 'bug':
      return 'BUG';
    case 'ui':
      return 'UI';
    case 'routine':
      return 'ROUTINE';
    default:
      return 'TOPIC';
  }
}

export function ownerLabel(chat: ChatSummary): string {
  const owner = chat.topic?.owner;
  if (owner === null || owner === undefined) {
    return 'No owner';
  }
  return `Owner: ${owner.name}`;
}

/** Only `https:` URLs render as links; anything else renders as plain text. */
export function httpsUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) {
    return undefined;
  }
  const trimmed = url.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.URLFromString)(trimmed));
  return parsed?.protocol === 'https:' ? parsed.toString() : undefined;
}

export function linkText(chat: ChatSummary): string {
  const topic = chat.topic;
  if (topic?.linkLabel !== null && topic?.linkLabel !== undefined && topic.linkLabel !== '') {
    return topic.linkLabel;
  }
  const href = httpsUrl(topic?.linkUrl);
  if (href !== undefined) {
    return new URL(href).hostname;
  }
  return 'Add link';
}

// The strip owner id is the server's id: a bare user id for people, the
// full AI id for AIs. Derive it the same way for both kinds by stripping
// the mention JID's domain (users are `<id>@<domain>`, AIs
// `ai-<id>@<domain>`), never by display name: two AIs can share a name.
export function ownerIdFor(jid: string): string {
  const localpart = jidLocal(jid);
  return localpart.startsWith('ai-') ? localpart.slice('ai-'.length) : localpart;
}
