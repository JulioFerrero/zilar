import type { MentionMember, UiMessage } from '@zilar/chat-core';
import { clearFailure, createMessageLedger } from '@zilar/client-core/store';

import type { ChatEntry, GroupDetail, Me } from '../../lib/chat-api';
import type { Topic } from '../../lib/topics-api';
import type { VoiceFailureReason } from '../../lib/voice-failure';
import type { SetState } from '@zilar/client-core';
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

export function makeStoreHelpers(deps: StoreHelpersDeps) {
  const { locals, get, set, appState } = deps;

  function isVisible(): boolean {
    return appState.current() === 'active';
  }

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

  // Keeps its local recording and shows a Retry: the reason is a subset of the shared `SendFailureReason` buckets plus `other`, so the bubble renders the matching copy.
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

  // The live row first, so a deep-linked topic works before any entry flowed through `rememberGroupIds`.
  function groupIdForChat(chatId: string): string | undefined {
    return get().chats.find((entry) => entry.id === chatId)?.groupId ?? locals.groupIds.get(chatId);
  }

  // The response is server truth, so a private-to-public flip clears the entry instead of leaving it stale.
  function rememberTopicRoles(topic: Topic): void {
    locals.topicRolesById.set(topic.id, {
      roles: topic.roles,
      approverRole: topic.approverRole,
    });
    set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
  }

  function rememberMembers(chatId: string, detail: GroupDetail): void {
    const members = new Map<string, string>();
    for (const member of detail.members) {
      members.set(member.userId.toLowerCase(), member.name);
    }
    locals.groupMembers.set(chatId, members);
  }

  // Self is excluded by `userId` against `currentUserId`: `me?.jid` is undefined before boot and in the mock store, while `currentUserId` is always set.
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

  // Also records the text as the base text, which the ledger restores when an edit is reverted.
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
