import { avatarIdentity, type AvatarChatInput, type AvatarPersonInput } from '@zilar/chat-core';

import { useAuthStore } from '@/auth/session';
import { Avatar } from '@/components/chat/avatar';
import { useChatStore } from '@/store/chat-store-provider';

type EntityAvatarProps = {
  person?: AvatarPersonInput | null | undefined;
  chat?: AvatarChatInput | null | undefined;
  me?: boolean | undefined;
  size?: number | undefined;
  online?: boolean | undefined;
  ai?: boolean | undefined;
  className?: string | undefined;
};

export function EntityAvatar({
  person,
  chat,
  me = false,
  size,
  online,
  ai,
  className,
}: EntityAvatarProps) {
  const meState = useAuthStore((state) => state.me);
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);

  const identity = (() => {
    if (me) {
      return avatarIdentity({
        name: meState?.name ?? '',
        id: meState?.id ?? '',
        ...(meState?.avatarUrl === undefined ? {} : { avatarUrl: meState.avatarUrl }),
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
