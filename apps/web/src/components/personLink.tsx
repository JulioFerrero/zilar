import { bareJid, jidLocal } from '@zilar/protocol';
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

/**
 * Where a person opens from the web app: their DM when they are a contact or
 * have a chat row (the viewer's own AI included), the Add contact card for a
 * known handle, and nothing for yourself or an unknown sender.
 */
export function usePersonHref(target: PersonTarget): PersonHref | undefined {
  const currentUserId = useChatSelector((state) => state.currentUserId);
  const contacts = useChatSelector((state) => state.contacts);
  const chats = useChatSelector((state) => state.chats);
  const groupInfos = useChatSelector((state) => state.groupInfos);
  const storeApi = useChatStoreApi();

  const { jid, userId, handle } = target;

  return useMemo(() => {
    // A full JID carries a resource (room@conf/nick): it is the occupant form a
    // group message uses when the sender is unknown, so it opens nothing.
    if (jid !== undefined && jid.includes('/')) {
      return undefined;
    }
    const bare = jid === undefined ? undefined : bareJid(jid).toLowerCase();
    const me = currentUserId.toLowerCase();
    if (userId !== undefined && userId.toLowerCase() === me) {
      return undefined;
    }
    if (bare !== undefined && jidLocal(bare) === me) {
      return undefined;
    }

    const contact = contacts.find(
      (row) =>
        (bare !== undefined && bareJid(row.jid).toLowerCase() === bare) ||
        (userId !== undefined && row.userId === userId),
    );
    if (contact !== undefined) {
      return {
        to: `/c/${encodeURIComponent(contact.jid)}`,
        // The list may not have the new chat row yet; the shell opens the DM
        // when it lands (the same hand-off as the global people search).
        onOpen: () => {
          if (!chats.some((chat) => chat.id === contact.jid)) {
            storeApi.getState().refreshChats();
          }
        },
      };
    }

    if (bare !== undefined) {
      // An unresolved group sender carries the occupant JID room@conf/nick, so
      // its bare form is the group room itself; opening that is not a person.
      const chat = chats.find((row) => row.kind !== 'group' && row.id.toLowerCase() === bare);
      if (chat !== undefined) {
        return { to: `/c/${encodeURIComponent(chat.id)}`, onOpen: noop };
      }
    }

    const knownHandle = handle ?? (bare === undefined ? undefined : memberHandle(groupInfos, bare));
    if (knownHandle !== undefined && knownHandle !== null && knownHandle !== '') {
      return { to: `/u/${encodeURIComponent(knownHandle)}`, onOpen: noop };
    }

    return undefined;
  }, [jid, userId, handle, currentUserId, contacts, chats, groupInfos, storeApi]);
}

/**
 * A group member carries the handle the Add contact card needs; the message
 * sender itself only carries a JID, so match its localpart to a member's user
 * id across the group details already loaded for the open chats.
 */
function memberHandle(groupInfos: Record<string, GroupDetail>, bare: string): string | undefined {
  const localpart = jidLocal(bare);
  for (const info of Object.values(groupInfos)) {
    const member = info.members.find((row) => row.userId.toLowerCase() === localpart);
    if (member?.handle !== undefined && member.handle !== null && member.handle !== '') {
      return member.handle;
    }
  }
  return undefined;
}

/**
 * Wraps a person's avatar and name in the link that opens them. A person with
 * nowhere to open stays exactly as it was, so self and unknown senders keep
 * their plain rendering.
 */
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
      // The bubble CSS styles every anchor white and underlined; the sender
      // name must keep its per-sender colour and the panels their own type.
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
