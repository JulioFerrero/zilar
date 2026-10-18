import { resolvePerson } from '@zilar/chat-core';
import { type ReactNode, useMemo } from 'react';
import { Link } from 'react-router';
import type { GroupDetail } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

export type PersonTarget = {
  jid?: string;
  userId?: string;
  handle?: string | null | undefined;
};

type PersonHref = {
  to: string;
  onOpen: () => void;
};

const noop = (): void => undefined;

export function usePersonHref(target: PersonTarget): PersonHref | undefined {
  const currentUserId = useChatSelector((state) => state.currentUserId);
  const contacts = useChatSelector((state) => state.contacts);
  const chats = useChatSelector((state) => state.chats);
  const groupInfos = useChatSelector((state) => state.groupInfos);
  const storeApi = useChatStoreApi();

  const { jid, userId, handle } = target;

  return useMemo(() => {
    const destination = resolvePerson(
      { jid, userId, handle },
      {
        contacts,
        chats,
        currentUserId,
        memberHandle: (localpart) => memberHandle(groupInfos, localpart),
      },
    );
    if (destination === undefined) {
      return undefined;
    }
    if (destination.kind === 'profile') {
      return { to: `/u/${encodeURIComponent(destination.handle)}`, onOpen: noop };
    }
    if (destination.kind === 'chat') {
      return { to: `/c/${encodeURIComponent(destination.chatId)}`, onOpen: noop };
    }
    const chatId = destination.chatId;
    return {
      to: `/c/${encodeURIComponent(chatId)}`,
      onOpen: () => {
        if (!chats.some((chat) => chat.id === chatId)) {
          storeApi.getState().refreshChats();
        }
      },
    };
  }, [jid, userId, handle, currentUserId, contacts, chats, groupInfos, storeApi]);
}

/** A group member carries the handle the Add card needs; match the sender's localpart to a member's user id. */
function memberHandle(
  groupInfos: Record<string, GroupDetail>,
  localpart: string,
): string | undefined {
  for (const info of Object.values(groupInfos)) {
    const member = info.members.find((row) => row.userId.toLowerCase() === localpart);
    if (member?.handle !== undefined && member.handle !== null && member.handle !== '') {
      return member.handle;
    }
  }
  return undefined;
}

export function PersonLink({
  target,
  name,
  className,
  children,
}: {
  target: PersonTarget;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const href = usePersonHref(target);
  if (href === undefined) {
    return <>{children}</>;
  }
  return (
    <Link
      to={href.to}
      onClick={(event) => {
        event.stopPropagation();
        href.onOpen();
      }}
      aria-label={`Open ${name}`}
      title={name}
      // The bubble CSS styles every anchor white; keep the sender's colour and the panels' type.
      style={{ color: 'inherit', textDecoration: 'none' }}
      className={cn(
        'rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
    >
      {children}
    </Link>
  );
}
