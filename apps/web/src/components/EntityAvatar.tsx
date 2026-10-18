import { avatarIdentity, type AvatarChatInput, type AvatarPersonInput } from '@zilar/chat-core';

import { useAuth } from '@/auth/AuthProvider';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { Avatar } from './Avatar';

interface EntityAvatarProps {
  /** A person, contact, member or AI. */
  person?: AvatarPersonInput | null | undefined;
  /** A chat row: DM peer, group, channel, topic or AI chat. */
  chat?: AvatarChatInput | null | undefined;
  /** The signed-in user (resolved from the auth session). */
  me?: boolean | undefined;
  size?: number | undefined;
  online?: boolean | undefined;
  ai?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The one avatar call the screens use (T-1334): it hands the entity to
 * `avatarIdentity` and fills a missing picture from the stores the app
 * already holds — the auth session for the own row, the contacts store for a
 * person (keyed by `userId`, `apps/web/src/store/ChatStoreProvider.tsx`) and
 * the chat rows for a chat (keyed by `id`). No call site decides the seed or
 * picks a URL.
 */
export function EntityAvatar({
  person,
  chat,
  me = false,
  size,
  online,
  ai,
  className,
}: EntityAvatarProps) {
  const user = useAuth().user;
  // Only the one picture row is read (T-2011): a whole-array subscription
  // re-renders every avatar on each store write while an AI reply streams.
  const chatId = chat?.id;
  const chatAvatarUrl = useChatSelector((s) =>
    chatId === undefined ? undefined : s.chats.find((entry) => entry.id === chatId)?.avatarUrl,
  );
  const personId = person?.userId ?? person?.id;
  const contactAvatarUrl = useChatSelector((s) =>
    personId === undefined
      ? undefined
      : s.contacts.find((entry) => entry.userId === personId)?.avatarUrl,
  );

  const identity = (() => {
    if (me) {
      return avatarIdentity({
        name: user?.name ?? '',
        id: user?.id ?? '',
        ...(user?.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
      });
    }
    if (chat !== undefined && chat !== null) {
      return avatarIdentity({ ...chat, avatarUrl: chat.avatarUrl ?? chatAvatarUrl });
    }
    if (person !== undefined && person !== null) {
      return avatarIdentity({
        ...person,
        avatarUrl: person.avatarUrl ?? person.image ?? contactAvatarUrl ?? undefined,
      });
    }
    return avatarIdentity({ name: '', id: '' });
  })();

  return (
    <Avatar
      seed={identity.seed}
      name={identity.name}
      {...(size === undefined ? {} : { size })}
      {...(online === undefined ? {} : { online })}
      {...(ai === undefined ? {} : { ai })}
      {...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
