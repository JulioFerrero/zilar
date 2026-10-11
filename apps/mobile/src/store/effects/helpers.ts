import type { MentionMember, UiMessage } from '@zilar/chat-core';
import { clearFailure, createMessageLedger } from '@zilar/client-core/store';

import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { Topic } from '../../lib/topics-api';
import type { VoiceFailureReason } from '../../lib/voice-native';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../types';
import { summariesFor } from './chat-rows';
import type { StoreLocals } from './locals';
import type { AppStateLike } from './ports';

export interface StoreHelpersDeps {
  readonly locals: StoreLocals;
  readonly get: () => ChatStoreState;
  readonly set: SetState<ChatStoreState>;
  readonly appState: AppStateLike;
}

/**
 * The plain helpers the closure and the effect modules call: the message
 * ledger, the chat-row and group caches, the voice failure marker and the
 * sender nickname. They read the closure's mutable locals through
 * `deps.locals`, so the closure keeps one owner of its state.
 */
export function makeStoreHelpers(deps: StoreHelpersDeps) {
  const { locals, get, set, appState } = deps;

  function isVisible(): boolean {
    return appState.current() === 'active';
  }

  // Message ids and aliases, edits, reactions, mentions, sender names and
  // the message mutators (`@zilar/client-core/store`).
  const ledger = createMessageLedger({
    get,
    set,
    memberName: (chatId, localpart) => locals.groupMembers.get(chatId)?.get(localpart),
    occupantNick: (chatId, fromJid) =>
      locals.core
        ?.occupants(chatId)
        .find((item) => item.realJid === fromJid || item.jid === fromJid)?.nick,
    mediaToken: () => locals.mediaToken,
  });
  const { listFor, myJid, sameMessage } = ledger;

  function clearAttachmentFailure(chatId: string, messageId: string): void {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? clearFailure(item) : item,
        ),
      },
    }));
  }

  // A failed voice send (T-0154, review round 1): the bubble keeps its
  // local recording and shows a Retry with the plain reason, never a
  // silent "sending". The reason rides the message in a subset of the
  // shared `SendFailureReason` buckets plus `other` (a subset so the
  // message keeps exactly the shared type); the bubble renders the
  // matching copy.
  function markVoiceFailed(
    chatId: string,
    messageId: string,
    reason: VoiceFailureReason = 'server_unavailable',
  ): void {
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: listFor(state, chatId).map((item): UiMessage =>
          sameMessage(item.id, messageId) ? { ...item, failed: true, failureReason: reason } : item,
        ),
      },
    }));
  }

  // The room identity of a forward and the origin header live in the core
  // (`forwardOriginFor` in `@zilar/client-core/store`), so the mobile store no
  // longer keeps its own copy.

  function rememberGroupIds(entries: ChatEntry[]): void {
    for (const entry of entries) {
      if (entry.kind === 'group') {
        locals.groupIds.set(entry.chatJid, entry.groupId);
        for (const row of summariesFor(entry)) {
          locals.groupIds.set(row.id, entry.groupId);
        }
      }
    }
  }

  // The group id behind one chat row: topic rows carry it directly
  // (T-0139: the live row first, so a deep-linked topic works before any
  // entry flowed through `rememberGroupIds`), legacy group rows resolve it
  // through the remembered `/api/chats` entries.
  function groupIdForChat(chatId: string): string | undefined {
    return get().chats.find((entry) => entry.id === chatId)?.groupId ?? locals.groupIds.get(chatId);
  }

  // Remembers the roles of one full topic response (create/patch/roles),
  // replacing whatever was cached. The response is the server truth, so a
  // private-to-public flip clears the entry instead of leaving it stale.
  function rememberTopicRoles(topic: Topic): void {
    locals.topicRolesById.set(topic.id, {
      roles: topic.roles,
      approverRole: topic.approverRole,
    });
    set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
  }

  // Remembers the member names of a group for one chat row (the loader is
  // `ensureGroupMembers` in `effects/groups.ts`).
  function rememberMembers(chatId: string, detail: GroupDetail): void {
    const members = new Map<string, string>();
    for (const member of detail.members) {
      members.set(member.userId.toLowerCase(), member.name);
    }
    locals.groupMembers.set(chatId, members);
  }

  // The mention members behind one chat row (T-0227, built like web's
  // `applyGroupDetail`): people as `{ jid: localpart@domain, name, handle?
  // }` plus the group's AIs as `{ jid, name }`, never yourself. Self is
  // excluded by `userId` against `currentUserId` (T-0227 S2): `me?.jid`
  // is undefined before boot and in the mock store, while `currentUserId`
  // is always set (`me.id` after boot). The sender-name map above keeps
  // working from the same detail. Reads the shared detail cache (so
  // every topic row of a group agrees) and never fetches on its own.
  function mentionMembersFor(chatId: string): MentionMember[] {
    const groupId = groupIdForChat(chatId);
    if (groupId === undefined) {
      return [];
    }
    const detail = locals.groupDetails.get(groupId);
    if (detail === undefined) {
      return [];
    }
    const mine = myJid();
    const domain = mine === undefined ? undefined : mine.slice(mine.indexOf('@') + 1);
    const meId = get().currentUserId;
    const members: MentionMember[] = [];
    for (const member of detail.members) {
      if (member.userId === meId) {
        continue;
      }
      const localpart = member.userId.toLowerCase();
      members.push({
        jid: domain === undefined ? member.userId : `${localpart}@${domain}`,
        name: member.name,
        ...(member.handle === undefined || member.handle === '' ? {} : { handle: member.handle }),
      });
    }
    for (const ai of detail.ais) {
      members.push({ jid: ai.jid, name: ai.name });
    }
    return members;
  }

  // An optimistic bubble also records its text as the base text, which the
  // ledger restores when an edit is reverted (the web send pipeline does the
  // same). Without it a revert would strip the text of an unechoed message.
  function setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void {
    ledger.setChatMessage(chatId, message, clearUnread);
    if (message.text !== undefined) {
      ledger.rememberBaseText(message.id, message.text);
    }
  }

  function nick(me: Me): string {
    const name = me.name.trim();
    if (name.length > 0) {
      return name;
    }
    return me.jid?.split('@')[0] ?? 'me';
  }

  return {
    ...ledger,
    isVisible,
    ledger,
    clearAttachmentFailure,
    markVoiceFailed,
    rememberGroupIds,
    groupIdForChat,
    rememberTopicRoles,
    rememberMembers,
    mentionMembersFor,
    setChatMessage,
    nick,
  };
}
