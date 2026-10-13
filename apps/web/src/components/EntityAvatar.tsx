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
  const contacts = useChatSelector((s) => s.contacts);
  const chats = useChatSelector((s) => s.chats);

  const identity = (() => {
    if (me) {
      return avatarIdentity({
        name: user?.name ?? '',
        id: user?.id ?? '',
        ...(user?.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
      });
    }
    if (chat !== undefined && chat !== null) {
      const row = chats.find((entry) => entry.id === chat.id);
      return avatarIdentity({ ...chat, avatarUrl: chat.avatarUrl ?? row?.avatarUrl });
    }
    if (person !== undefined && person !== null) {
      const contact = contacts.find((entry) => entry.userId === (person.userId ?? person.id));
      return avatarIdentity({
        ...person,
        avatarUrl: person.avatarUrl ?? person.image ?? contact?.avatarUrl ?? undefined,
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
