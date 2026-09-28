import type { MentionMember } from '@galena/chat-core';
import { mockGroupDetails } from './groups';

/**
 * Members of each mock group chat, keyed by the chat id. Derived from
 * `mockGroupDetails` so the picker and the group panel always agree; AIs keep
 * their `ai-<id>@<domain>` JID, which the UI renders with the `AI` badge.
 */
export const mockGroupMembers: Record<string, MentionMember[]> = Object.fromEntries(
  Object.entries(mockGroupDetails).map(([chatId, detail]) => [
    chatId,
    [
      ...detail.members.map((member) => ({
        jid: `${member.userId.toLowerCase()}@galena.test`,
        name: member.name,
      })),
      ...detail.ais.map((ai) => ({ jid: ai.jid, name: ai.name })),
    ],
  ]),
);
