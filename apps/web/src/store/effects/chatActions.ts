// The chat, message, pin and preference actions of the web chat store. Each
// one wraps an effect module with the store's `StoreCtx`, lifetime and state
// accessors; `realStore.ts` spreads the returned slice into the store state.
import {
  deleteForEveryone,
  editMessage,
  react,
  sendTyping,
  setFolders as setFoldersCore,
} from '@zilar/client-core/store';
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../store';
import type { StoreCtx } from './ctx';
import {
  loadOlder as loadOlderInStore,
  openAtMessage as openAtMessageEffect,
  openChat as openChatInStore,
  openHistory as openHistoryEffect,
  scheduleChatsRefresh,
} from './history';
import { retryBoot, signOutStore, startStore, stopStore } from './lifecycle';
import type { StoreLocals } from './locals';
import {
  loadChatMedia,
  pinMessage,
  refreshPinsFor as refreshPinsForEffect,
  setPushPair,
  unpinMessage,
} from './pins';
import type { PortsShape } from './ports';
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
} from './prefs';
import type { Lifetime } from './runtime';
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
} from './send';

export type ChatActions = Pick<
  ChatStoreState,
  | 'dismissPinsError'
  | 'refreshChats'
  | 'openChat'
  | 'retryChats'
  | 'retryHistory'
  | 'loadOlder'
  | 'loadPins'
  | 'loadChatMedia'
  | 'pinMessage'
  | 'unpinMessage'
  | 'setPinsPanel'
  | 'openAtMessage'
  | 'react'
  | 'startEdit'
  | 'cancelEdit'
  | 'editMessage'
  | 'deleteForEveryone'
  | 'sendTyping'
  | 'setPushPair'
  | 'sendText'
  | 'sendVoice'
  | 'retryVoice'
  | 'deleteFailedMessage'
  | 'sendAttachment'
  | 'sendSticker'
  | 'forwardMessages'
  | 'retrySticker'
  | 'retryAttachment'
  | 'signOut'
  | 'start'
  | 'stop'
  | 'setSearch'
  | 'setSearchChat'
  | 'setActiveFolder'
  | 'setFolders'
  | 'refreshChatPrefs'
  | 'refreshDefaultBackground'
  | 'setPinned'
  | 'setMuted'
  | 'setArchived'
  | 'setChatBackground'
  | 'setDefaultBackground'
  | 'setChatBackgroundImage'
  | 'setDefaultBackgroundImage'
>;

export interface ChatActionsDeps {
  readonly ctx: StoreCtx;
  readonly rt: Lifetime;
  readonly locals: StoreLocals;
  readonly set: SetState<ChatStoreState>;
  readonly get: () => ChatStoreState;
  readonly ports: PortsShape;
}

/** Builds the chat, message, pin and preference actions of one store. */
export function makeChatActions(deps: ChatActionsDeps): ChatActions {
  const { ctx, rt, set, get } = deps;

  return {
    dismissPinsError: () => set({ pinsError: undefined }),
    refreshChats: () => {
      scheduleChatsRefresh(ctx);
    },
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
    loadPins: (chatId) => rt.runPromise(refreshPinsForEffect(ctx, chatId)),
    loadChatMedia: (chatId, tab, before) => rt.runPromise(loadChatMedia(ctx, chatId, tab, before)),
    pinMessage: (chatId, messageId) => rt.runPromise(pinMessage(ctx, chatId, messageId)),
    unpinMessage: (chatId, pinId) => rt.runPromise(unpinMessage(ctx, chatId, pinId)),
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
      setFoldersCore(
        { activeFolder: () => get().activeFolder, commit: (patch) => set(patch) },
        folders,
      );
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
  };
}
