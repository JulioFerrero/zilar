import type { MessageLedger } from '@zilar/client-core/store';

import { CURRENT_USER_ID } from '../../lib/types';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../types';
import type { Events } from './events';
import type { StoreLocals } from './locals';
import type { StoreState } from './runtime';

export interface UserStateDeps {
  readonly locals: StoreLocals;
  readonly s: StoreState;
  readonly set: SetState<ChatStoreState>;
  readonly ownedAis: { id: string; name: string }[] | undefined;
  readonly ledger: MessageLedger;
  readonly events: Events;
  readonly clearPins?: () => void;
}

export interface UserState {
  initialUserState(): Pick<
    ChatStoreState,
    | 'currentUserId'
    | 'me'
    | 'chatsLoad'
    | 'chats'
    | 'contacts'
    | 'messagesByChat'
    | 'historyLoad'
    | 'activeChatId'
    | 'historyComplete'
    | 'search'
    | 'activeFolder'
    | 'folders'
    | 'foldersLoaded'
    | 'typing'
    | 'editTarget'
    | 'actionError'
    | 'jumpTarget'
    | 'topicNotice'
    | 'pinsError'
    | 'ownedAis'
  >;
  teardown(): void;
}

/** `stop()` returns to this state, so the next user never sees the previous user's chats, contacts or messages. */
export function makeUserState(deps: UserStateDeps): UserState {
  const { locals, s, set, ownedAis, ledger, events, clearPins } = deps;

  const initialUserState = (): ReturnType<UserState['initialUserState']> => ({
    currentUserId: CURRENT_USER_ID,
    me: undefined,
    chatsLoad: 'loading',
    chats: [],
    contacts: [],
    messagesByChat: {},
    historyLoad: {},
    activeChatId: null,
    historyComplete: {},
    search: '',
    activeFolder: 'all',
    folders: [],
    foldersLoaded: false,
    typing: {},
    editTarget: undefined,
    actionError: undefined,
    jumpTarget: undefined,
    topicNotice: undefined,
    pinsError: undefined,
    ownedAis: ownedAis ?? [],
  });

  function teardown(): void {
    events.clearTimers();
    locals.pinsPollEnabled = false;
    clearPins?.();
    s.core = undefined;
    for (const chatId of Object.keys(locals.cursors)) {
      delete locals.cursors[chatId];
    }
    locals.lastRead = {};
    locals.chatPrefRows = [];
    locals.groupIds.clear();
    locals.groupMembers.clear();
    locals.loadingOlder.clear();
    locals.pendingOutgoing.clear();
    s.sendRuns.clear();
    locals.pendingVoices.clear();
    locals.groupDetails.clear();
    locals.loadingGroupDetails.clear();
    locals.groupRolesById.clear();
    locals.loadingGroupRoles.clear();
    locals.topicRolesById.clear();
    locals.loadingTopicRoles.clear();
    set({
      ...initialUserState(),
      status: 'offline',
      mediaTrustedHosts: undefined,
      drafts: {},
      finishedDraftMessages: {},
      edits: {},
      reactions: {},
    });
    locals.loadingHistory.clear();
    ledger.reset();
    locals.pendingUploads.clear();
  }

  return { initialUserState, teardown };
}
