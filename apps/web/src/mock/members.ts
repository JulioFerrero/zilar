import type { MentionMember } from '@zilar/chat-core';
import { mockGroupDetails } from './groups';

/**
 * Members of each mock group chat, keyed by the chat id. Derived from
 * `mockGroupDetails` so the picker and the group panel always agree; AIs keep
 * their `ai-<id>@<domain>` JID, which the UI renders with the `AI` badge.
 * Handles pass through from the detail (T-0163); AIs have none (T-0169).
 */
function memberHandle(member: { handle?: string | null | undefined }): { handle?: string } {
  return member.handle == null || member.handle === '' ? {} : { handle: member.handle };
}

export const mockGroupMembers: Record<string, MentionMember[]> = Object.fromEntries(
  Object.entries(mockGroupDetails).map(([chatId, detail]) => [
    chatId,
    [
      ...detail.members.map((member) => ({
        jid: `${member.userId.toLowerCase()}@zilar.test`,
        name: member.name,
        ...memberHandle(member),
      })),
      ...detail.ais.map((ai) => ({ jid: ai.jid, name: ai.name })),
    ],
  ]),
);
