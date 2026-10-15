// The AI DMs of the chat list (T-1474): each active AI the caller owns is a DM
// with its own XMPP account, and it carries the AI's `createdAt` (ISO) so a
// just-created, still-empty AI chat sorts first, like a group (T-1318). Kept
// out of `api.ts` so that file stays inside its 400-line bar.

import type { PublicAi } from '../ais/persona';
import { avatarUrlFor } from '../avatars/service';
import type { ChatListEntry } from './api';

/**
 * The AI DM entries: disabled AIs and other people's AIs are left out.
 * `aiAvatars` maps an AI id to its avatar file id; an AI without one gets no
 * `avatarUrl` key, exactly as before.
 */
export function aiDmEntries(
  ais: readonly PublicAi[],
  aiAvatars: ReadonlyMap<string, string>,
): ChatListEntry[] {
  return ais
    .filter((ai) => ai.status === 'active')
    .map((ai): ChatListEntry => ({
      kind: 'dm',
      chatJid: ai.jid,
      title: ai.name,
      isAi: true,
      createdAt: ai.createdAt.toISOString(),
      ...(aiAvatars.get(ai.id) === undefined
        ? {}
        : { avatarUrl: avatarUrlFor(aiAvatars.get(ai.id)!) }),
    }));
}
