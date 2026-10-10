// The ledger's identity helpers: who "me" is, whether a stanza is my own, the
// group member and room occupant names behind a sender, a display name that
// never falls back to a JID localpart, and a reactor's display name. Moved
// unchanged from `store/ledger.ts` (size split).
import { userLocalpartOf as sharedUserLocalpartOf } from '@zilar/chat-core';
import type { LedgerStanza, LedgerState, MessageLedgerDeps } from './ledger-types';

interface LedgerIdentityDeps {
  readonly get: () => LedgerState;
  readonly deps: MessageLedgerDeps;
}

export function createLedgerIdentity({ get, deps }: LedgerIdentityDeps) {
  function myJid(): string | undefined {
    const jid = get().me?.jid;
    return jid === undefined || jid === null || jid === '' ? undefined : jid;
  }

  function isOwnSender(fromJid: string): boolean {
    const jid = myJid();
    return jid !== undefined && fromJid === jid;
  }

  function userLocalpartOf(fromJid: string): string | undefined {
    return sharedUserLocalpartOf(myJid(), fromJid);
  }

  function groupMemberNameFor(chatId: string, fromJid: string): string | undefined {
    const localpart = userLocalpartOf(fromJid);
    if (localpart === undefined) {
      return undefined;
    }
    const name = deps.memberName(chatId, localpart);
    return name !== undefined && name !== '' ? name : undefined;
  }

  function occupantNameFor(chatId: string, fromJid: string): string | undefined {
    const nick = deps.occupantNick(chatId, fromJid);
    return nick !== undefined && nick !== '' ? nick : undefined;
  }

  // Resolves a display name without ever falling back to a JID localpart.
  // Order: me, contact, MUC nick, group member, room occupant, DM title,
  // then "Someone".
  function senderNameFor(message: LedgerStanza): string {
    if (message.outgoing || isOwnSender(message.fromJid)) {
      return 'You';
    }
    const contact = get().contacts.find((entry) => entry.jid === message.fromJid);
    if (contact !== undefined) {
      return contact.name;
    }
    if (message.fromNick !== undefined && message.fromNick !== '') {
      return message.fromNick;
    }
    const member = groupMemberNameFor(message.chatJid, message.fromJid);
    if (member !== undefined) {
      return member;
    }
    const occupant = occupantNameFor(message.chatJid, message.fromJid);
    if (occupant !== undefined) {
      return occupant;
    }
    const chat = get().chats.find((entry) => entry.id === message.chatJid);
    if (chat !== undefined && chat.kind === 'dm') {
      return chat.title;
    }
    return 'Someone';
  }

  // A reactor's display name: "You" for me, the DM title for a DM, else the
  // group member, the room occupant, or "Someone".
  function reactorName(chatId: string, reactorJid: string): string {
    const mine = myJid();
    if (mine !== undefined && reactorJid === mine) {
      return 'You';
    }
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (chat !== undefined && chat.kind === 'dm') {
      return chat.title;
    }
    return (
      groupMemberNameFor(chatId, reactorJid) ?? occupantNameFor(chatId, reactorJid) ?? 'Someone'
    );
  }

  return { myJid, isOwnSender, groupMemberNameFor, senderNameFor, reactorName };
}

export type LedgerIdentity = ReturnType<typeof createLedgerIdentity>;
