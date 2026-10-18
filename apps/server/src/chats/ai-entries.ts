// Each active AI the caller owns is a DM with its own XMPP account.
// It carries the AI's `createdAt` (ISO) so a just-created, still-empty AI chat sorts first, like a group.
import type { PublicAi } from '../ais/persona';
import { avatarUrlFor } from '../avatars/service';
import type { ChatListEntry } from './api';

// Disabled AIs and other people's AIs are left out; no avatar key when the AI has none.
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
