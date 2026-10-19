import { avatarIdentity } from '@zilar/chat-core';
import type { EntityAvatarProps } from '@zilar/client-core';

import { useAuth } from '@/auth/AuthProvider';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { Avatar } from './Avatar';

/** Fills a missing picture from the stores the app already holds; no call site picks a URL. */
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
  // Subscribe to the one picture row only: a whole-array read re-renders every avatar on each store write.
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
