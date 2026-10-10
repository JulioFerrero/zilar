import type { MentionMember } from '@zilar/chat-core';
import { sortFolders } from '@zilar/chat-core';
import {
  createMessageLedger,
  deleteForEveryone,
  editMessage,
  react,
  sendTyping,
} from '@zilar/client-core/store';
import { type XmppCore } from '@zilar/xmpp-core';
import { sortByRecency, summariesFor } from './effects/chatRows';
import {
  loadOlder as loadOlderInStore,
  openAtMessage as openAtMessageEffect,
  openChat as openChatInStore,
  openHistory as openHistoryEffect,
  scheduleChatsRefresh,
} from './effects/history';
import {
  loadChatMedia,
  pinMessage,
  refreshPinsFor as refreshPinsForEffect,
  setPushPair,
  unpinMessage,
} from './effects/pins';
import { dismissNotificationsInBackground, syncBadgeInBackground } from './effects/badge';
import type { SendRun, StoreCtx } from './effects/ctx';
import { loadGroupMembersInBackground } from './effects/groupMembers';
import { clearDraftTimeout, markTurnFinished } from './effects/polling';
import {
  refreshChatPrefs,
  refreshDefaultBackground,
  setArchived,
  setChatBackground,
  setChatBackgroundImage,
  setDefaultBackground,
  setDefaultBackgroundImage,
  setMuted,
  setPinned,
} from './effects/prefs';
import {
  addGroupAi,
  addTopicAi,
  addTopicMember,
  changeChannelRole,
  createChannel as createChannelEffect,
  createGroup as createGroupEffect,
  createInvite as createInviteEffect,
  createTopic,
  joinPublicGroup,
  leaveChannel,
  leaveTopic,
  patchTopic,
  refreshGeneralTopic,
  refreshTopicRow,
  removeGroupAi,
  removeTopicAi,
  removeTopicMember,
  setGroupBackground,
  setGroupListener,
  setGroupVisibility,
  setMembersCanCreateTopics,
  setTopicRoles,
} from './effects/groups';
import {
  deleteFailedMessage,
  forwardMessages,
  retryAttachment,
  retrySticker,
  retryVoice,
  sendAttachment,
  sendSticker,
  sendText,
  sendVoice,
} from './effects/send';
import { retryBoot, signOutStore, startStore, stopStore } from './effects/lifecycle';
import { portsLayer, readPorts, type RealStoreDeps } from './effects/ports';
import { makeLifetime } from './effects/runtime';
import { createAtomStore, type StoreApi } from './atomStore';
import { type ChatEntry, type GroupDetail, type Me } from '@/lib/api';
import { type MediaTokenShape } from '@/lib/attachments';
import type { ChatStoreState } from './store';

export { CONNECT_RETRY_DELAYS_MS, TOPIC_REFRESH_INTERVAL_MS } from './effects/constants';
export { mergeWithPainted, summariesFor } from './effects/chatRows';

export { SEND_TIMEOUT_MS } from './effects/constants';
export { sendFailureReasonFor } from './effects/sendFailure';
export { DRAFT_END_FALLBACK_MS, DRAFT_IDLE_MS } from './effects/constants';

export type { ApiClient, RealStoreDeps, StorageLike } from './effects/ports';

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const ports = readPorts(portsLayer(deps));
  const { api } = ports;
  const rt = makeLifetime(ports);

  return createAtomStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let lastRead: Record<string, string> = {};
    let lastReadUserId: string | undefined;
    // Group history (MUC MAM) only works once the room is joined, which
    // happens after the connection is online.
    let groupsJoined = false;
    // Turn ids whose draft is done, so a late `draft` is ignored.
    const finishedTurns = new Set<string>();
    const finishedTurnOrder: string[] = [];

    // The XMPP token the latest session connected with, kept for the media
    // allow-list (T-0065 round 1): images are only auto-loaded from hosts the
    // server names, so a chat peer cannot make every viewer fetch a tracker.
    let mediaToken: MediaTokenShape | undefined;
    // Open chat ids whose next disappearance moves silently (T-0130 review):
    // the client just archived that topic itself from its own header, so
    // the removed-while-open flow navigates without the "no longer
    // available" notice. Consumed on first use.
    const quietArchiveIds = new Set<string>();
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    // An outgoing attachment's bytes, kept for a Retry after a failed upload.
    const pendingAttachments = new Map<string, File>();
    // An outgoing voice recording's bytes, kept for a Retry after a failed
    // send (T-0168); dropped once the stanza send succeeds, like attachments.
    const pendingVoices = new Map<string, { blob: Blob; waveform: number[] }>();
    // The current send attempt of a message, keyed by its alias root (T-0168).
    // The run lets a retry's deadline and a previous run's late pipeline agree
    // on which outcome counts.
    const sendRuns = new Map<string, SendRun>();
    const groupIds = new Map<string, string>();
    // chatId -> (lowercased user id -> member)
    const groupMembers = new Map<string, Map<string, MentionMember>>();
    // chatId -> the last group detail (people + AIs), for the info panel.
    const groupInfos = new Map<string, GroupDetail>();
    const loadingGroupMembers = new Set<string>();
    const loadingOlder = new Set<string>();
    // First-page history loads currently in flight, by chat id.
    const loadingHistory = new Set<string>();
    // A chat opened before the core was connected or before the chats had
    // arrived (e.g. a reload of /c/<jid>). Only the latest one counts; it
    // loads as soon as both are ready.
    let pendingOpenChatId: string | undefined;

    // Message ids and aliases, edits, reactions, mentions, sender names and
    // the message mutators (`@zilar/client-core/store`).
    const ledger = createMessageLedger({
      get,
      set,
      memberName: (chatId, localpart) => groupMembers.get(chatId)?.get(localpart)?.name,
      occupantNick: (chatId, fromJid) =>
        core?.occupants(chatId).find((item) => item.realJid === fromJid || item.jid === fromJid)
          ?.nick,
      mediaToken: () => mediaToken,
    });

    // Removes a failed local bubble together with its kept bytes (T-0168).
    function removeFailedMessage(chatId: string, messageId: string): void {
      pendingAttachments.delete(ledger.aliasRoot(messageId));
      pendingAttachments.delete(messageId);
      ledger.removeFailedMessage(chatId, messageId);
    }

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          for (const row of summariesFor(entry)) {
            groupIds.set(row.id, entry.groupId);
          }
        }
      }
    }

    function nick(me: Me): string {
      const name = me.name.trim();
      if (name.length > 0) {
        return name;
      }
      return me.jid?.split('@')[0] ?? 'me';
    }

    // What the Effect modules share. The accessors read and write the
    // closure variables the helpers above still use.
    const ctx: StoreCtx = {
      get,
      set,
      ports,
      rt,
      k: {
        ...ledger,
        removeFailedMessage,
        rememberGroupIds,
        nick,
      },
      // The web code the core modules call (`CoreHooks`).
      fx: {
        syncBadge: () => syncBadgeInBackground(ctx),
        dismissChatNotifications: (chatId) => dismissNotificationsInBackground(ctx, chatId),
        loadGroupMembers: (chatId) => loadGroupMembersInBackground(ctx, chatId),
        finishDraftTurn: (chatId, turnId) => {
          markTurnFinished(ctx, turnId);
          clearDraftTimeout(ctx, chatId);
        },
        forgetRetryBytes: (messageId) => {
          pendingVoices.delete(messageId);
          pendingAttachments.delete(messageId);
        },
      },
      get core() {
        return core;
      },
      set core(value) {
        core = value;
      },
      get groupsJoined() {
        return groupsJoined;
      },
      set groupsJoined(value) {
        groupsJoined = value;
      },
      get pendingOpenChatId() {
        return pendingOpenChatId;
      },
      set pendingOpenChatId(value) {
        pendingOpenChatId = value;
      },
      get mediaToken() {
        return mediaToken;
      },
      set mediaToken(value) {
        mediaToken = value;
      },
      get lastRead() {
        return lastRead;
      },
      set lastRead(value) {
        lastRead = value;
      },
      get lastReadUserId() {
        return lastReadUserId;
      },
      set lastReadUserId(value) {
        lastReadUserId = value;
      },
      cachedUserId: undefined,
      connectRetryAttempt: 0,
      connectRetryPending: false,
      groupIds,
      loadingGroupMembers,
      groupMembers,
      groupInfos,
      messageAuthors: ledger.messageAuthors,
      messageOriginIds: ledger.messageOriginIds,
      messageBaseTexts: ledger.messageBaseTexts,
      finishedTurns,
      finishedTurnOrder,
      cursors,
      loadingHistory,
      loadingOlder,
      quietArchiveIds,
      sequence: 0,
      pendingOutgoing,
      pendingAttachments,
      pendingVoices,
      sendRuns,
    };

    return {
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      // Unknown means never requested, and the real store never has data
      // without requesting it: that is still loading, never empty.
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'loading',
      chats: [],
      contacts: [],
      chatPrefs: {},
      defaultBackground: null,
      messagesByChat: {},
      reactions: {},
      pinsByChat: {},
      pinsReady: {},
      pinsError: undefined,
      dismissPinsError: () => set({ pinsError: undefined }),
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => [...(groupMembers.get(chatId)?.values() ?? [])],
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: (chatId) => {
        loadGroupMembersInBackground(ctx, chatId, true);
      },
      listMyAis: () => api.listAis(),
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      refreshChats: () => {
        scheduleChatsRefresh(ctx);
      },
      // T-0130 (review): resolves General from the painted list, refreshing
      // it first. `refreshChats` only schedules the 500 ms debounce, so this
      // runs the real refresh and waits for it, never the schedule.
      refreshGeneralTopic: (groupId) => rt.runPromise(refreshGeneralTopic(ctx, groupId)),
      createTopic: (chatId, input) => rt.runPromise(createTopic(ctx, chatId, input)),
      patchTopic: (chatId, input) => rt.runPromise(patchTopic(ctx, chatId, input)),
      addTopicAi: (chatId, aiId) => rt.runPromise(addTopicAi(ctx, chatId, aiId)),
      removeTopicAi: (chatId, aiId) => rt.runPromise(removeTopicAi(ctx, chatId, aiId)),
      addTopicMember: (chatId, userId) => rt.runPromise(addTopicMember(ctx, chatId, userId)),
      removeTopicMember: (chatId, userId) => rt.runPromise(removeTopicMember(ctx, chatId, userId)),
      setTopicRoles: (chatId, input) => rt.runPromise(setTopicRoles(ctx, chatId, input)),
      // T-0130 (review): re-reads the chat list and reports whether the
      // topic row is still there, so a member-removal 404 can be told
      // apart from a gone topic (last member removed → archived). A
      // failed refresh throws (instead of reading a stale list as
      // "alive"), so the panel shows the inline removal error.
      refreshTopicRow: (chatId, topicId) => rt.runPromise(refreshTopicRow(ctx, chatId, topicId)),
      leaveTopic: (chatId) => rt.runPromise(leaveTopic(ctx, chatId)),
      // T-0124: channels share the create/list/refresh flow with groups (the
      // detail carries `kind`, the chat list paints the feed row).
      // T-0164: `visibility: 'public'` + `handle` creates the channel with
      // its directory entry in one transaction.
      createChannel: (title, memberIds, description, options) =>
        rt.runPromise(createChannelEffect(ctx, title, memberIds, description, options)),
      // T-0124: leaving a channel removes the caller's membership through
      // the member route (the same route admins use to remove others). The
      // list refreshes itself away; the caller navigates away.
      leaveChannel: (chatId) => rt.runPromise(leaveChannel(ctx, chatId)),
      // T-0124: promote/demote through the role route (owner only). The
      // detail refreshes, so the panel updates at once; the chat list
      // refreshes too, so the acting device's rows (myRole, counts) match
      // server truth and the composer bar flips. The target's own device
      // converges on the next list refresh (60s poll / focus), like every
      // other membership change in the app.
      changeChannelRole: (chatId, userId, role) =>
        rt.runPromise(changeChannelRole(ctx, chatId, userId, role)),
      setMembersCanCreateTopics: (chatId, allowed) =>
        rt.runPromise(setMembersCanCreateTopics(ctx, chatId, allowed)),
      // T-0466: owners/admins set the group's shared background; the detail
      // refresh repaints every chat of the group at once.
      setGroupBackground: (chatId, background) =>
        rt.runPromise(setGroupBackground(ctx, chatId, background)),
      // T-0478: owners/admins turn the group's AI listener on/off or set its
      // eagerness; the detail refresh repaints the panel.
      setGroupListener: (chatId, input) => rt.runPromise(setGroupListener(ctx, chatId, input)),
      // T-0164: the owner flips a group public (with a handle) or back to
      // private. The detail refreshes from server truth (like the role
      // change), so the panel, the label and the share link update at once.
      setGroupVisibility: (chatId, input) => rt.runPromise(setGroupVisibility(ctx, chatId, input)),
      // T-0164: joins a public group with one request, then opens it: the
      // list refreshes (the new membership arrives) and the General chat id
      // resolves from the painted rows, falling back to undefined when the
      // list has not caught up yet (the caller navigates home instead).
      joinPublicGroup: (groupId) => rt.runPromise(joinPublicGroup(ctx, groupId)),
      addGroupAi: (chatId, aiId) => rt.runPromise(addGroupAi(ctx, chatId, aiId)),
      removeGroupAi: (chatId, aiId) => rt.runPromise(removeGroupAi(ctx, chatId, aiId)),
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      openChat: (chatId) => {
        openChatInStore(ctx, chatId);
      },
      retryChats: () => {
        rt.runDetached(retryBoot(ctx));
      },
      retryHistory: (chatId) => {
        rt.fork(openHistoryEffect(ctx, chatId));
      },
      loadOlder: (chatId) => {
        loadOlderInStore(ctx, chatId);
      },
      pins: (chatId) => get().pinsByChat[chatId] ?? [],
      pinsLoaded: (chatId) => get().pinsReady[chatId] === true,
      loadPins: (chatId) => rt.runPromise(refreshPinsForEffect(ctx, chatId)),
      loadChatMedia: (chatId, tab, before) =>
        rt.runPromise(loadChatMedia(ctx, chatId, tab, before)),
      canPin: (chatId) => {
        const state = get();
        const chat = state.chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return false;
        }
        // Either side of a DM may pin.
        if (chat.kind === 'dm') {
          return true;
        }
        // A topic manager: a group owner/admin (roles ride the group
        // detail loaded on open), or the topic creator. The creator edge
        // without a manager role is enforced by the server; the menu hides
        // until the detail loads rather than guessing.
        const role = state.groupInfos[chatId]?.members.find(
          (member) => member.userId === state.currentUserId,
        )?.role;
        return role === 'owner' || role === 'admin';
      },
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinMessage: (chatId, messageId) => rt.runPromise(pinMessage(ctx, chatId, messageId)),
      unpinMessage: (chatId, pinId) => rt.runPromise(unpinMessage(ctx, chatId, pinId)),
      pinsPanel: undefined,
      setPinsPanel: (chatId) => set({ pinsPanel: chatId === undefined ? undefined : { chatId } }),
      openAtMessage: (chatId, messageId) =>
        rt.runPromise(openAtMessageEffect(ctx, chatId, messageId)),
      react: (chatId, messageId, emoji) => {
        react(ctx, chatId, messageId, emoji);
      },
      startEdit: (chatId, messageId) => {
        set({ editTarget: { chatId, messageId }, actionError: undefined });
      },
      cancelEdit: () => {
        set({ editTarget: undefined });
      },
      editMessage: (chatId, messageId, text) => {
        editMessage(ctx, chatId, messageId, text);
      },
      deleteForEveryone: (chatId, messageId) => {
        deleteForEveryone(ctx, chatId, messageId);
      },
      sendTyping: (chatId) => {
        sendTyping(ctx, chatId);
      },
      setPushPair: (input) => rt.runPromise(setPushPair(ctx, input)),
      sendText: (chatId, text, options) => {
        sendText(ctx, chatId, text, options);
      },
      sendVoice: (chatId, recording, options) => {
        sendVoice(ctx, chatId, recording, options);
      },
      retryVoice: (chatId, messageId) => {
        retryVoice(ctx, chatId, messageId);
      },
      deleteFailedMessage: (chatId, messageId) => {
        deleteFailedMessage(ctx, chatId, messageId);
      },
      sendAttachment: (chatId, file, options) => {
        sendAttachment(ctx, chatId, file, options);
      },
      sendSticker: (chatId, sticker, options) => {
        sendSticker(ctx, chatId, sticker, options);
      },
      forwardMessages: (targets, messages, options) => {
        forwardMessages(ctx, targets, messages, options);
      },
      retrySticker: (chatId, messageId) => {
        retrySticker(ctx, chatId, messageId);
      },
      retryAttachment: (chatId, messageId) => {
        retryAttachment(ctx, chatId, messageId);
      },
      createGroup: (title, memberIds, options) =>
        rt.runPromise(createGroupEffect(ctx, title, memberIds, options)),
      createInvite: () => rt.runPromise(createInviteEffect()),
      signOut: () => rt.runPromise(signOutStore(ctx)),
      start: () => {
        rt.runDetached(startStore(ctx));
      },
      stop: () => {
        rt.runDetached(stopStore(ctx));
      },
      setSearch: (value) => set({ search: value }),
      setSearchChat: (chatId) => set({ searchChat: chatId }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      setFolders: (folders) => {
        const sorted = sortFolders(folders);
        set((state) => ({
          folders: sorted,
          activeFolder:
            state.activeFolder === 'all' ||
            sorted.some((folder) => folder.id === state.activeFolder)
              ? state.activeFolder
              : 'all',
        }));
      },
      refreshChatPrefs: () => rt.runPromise(refreshChatPrefs(ctx)),
      refreshDefaultBackground: () => rt.runPromise(refreshDefaultBackground(ctx)),
      setPinned: (chatId, pinned) => rt.runPromise(setPinned(ctx, chatId, pinned)),
      setMuted: (chatId, duration) => rt.runPromise(setMuted(ctx, chatId, duration)),
      setArchived: (chatId, archived) => rt.runPromise(setArchived(ctx, chatId, archived)),
      setChatBackground: (chatId, presetId) =>
        rt.runPromise(setChatBackground(ctx, chatId, presetId)),
      setDefaultBackground: (presetId) => rt.runPromise(setDefaultBackground(ctx, presetId)),
      setChatBackgroundImage: (chatId, imageId, dim) =>
        rt.runPromise(setChatBackgroundImage(ctx, chatId, imageId, dim)),
      setDefaultBackgroundImage: (imageId, dim) =>
        rt.runPromise(setDefaultBackgroundImage(ctx, imageId, dim)),
      archivedChats: () =>
        sortByRecency(
          get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
        ),
    };
  });
}
