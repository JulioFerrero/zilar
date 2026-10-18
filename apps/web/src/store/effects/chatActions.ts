import type {
  ChatStoreState,
  SendAttachmentOptions,
  SendStickerInput,
  SendTextOptions,
  VoiceRecording,
} from '../store';
import type { StoreCtx } from './ctx';
import {
  loadOlder as loadOlderInStore,
  openAtMessage as openAtMessageEffect,
  openChat as openChatInStore,
  openHistory as openHistoryEffect,
  scheduleChatsRefresh,
} from './history';
import { resetUserState, retryBoot, signOutStore, startStore, stopStore } from './lifecycle';
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
  setUnreadMark,
} from './prefs';
import { recordRead } from './reads';
import type { Lifetime } from './runtime';
import type { UiMessage } from '@zilar/chat-core';
import type { SetState } from '@zilar/client-core';
import {
  clearHistory as clearHistoryCore,
  clearSupersededMarker,
  deleteForEveryone,
  deleteForMe as deleteForMeCore,
  editMessage,
  react,
  sendTyping,
  setFolders as setFoldersCore,
  stopTyping,
  deleteFailedMessage as deleteFailedMessageCore,
  forwardMessages as forwardMessagesCore,
  retryAttachment as retryAttachmentCore,
  retrySticker as retryStickerCore,
  retryVoice as retryVoiceCore,
  sendAttachment as sendAttachmentCore,
  sendSticker as sendStickerCore,
  sendText as sendTextCore,
  sendVoice as sendVoiceCore,
} from '@zilar/client-core/store';
import { Effect } from 'effect';

const objectUrlFor = (blob: Blob): string | undefined =>
  Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );

function sendText(ctx: StoreCtx, chatId: string, text: string, options?: SendTextOptions): void {
  sendTextCore(ctx, chatId, text, options);
}

function sendVoice(
  ctx: StoreCtx,
  chatId: string,
  recording: VoiceRecording,
  options?: SendTextOptions,
): void {
  // The empty-recording check stays in the web facade.
  if (recording.blob.size === 0) {
    return;
  }
  sendVoiceCore(
    ctx,
    chatId,
    {
      bytes: recording.blob,
      durationMs: recording.durationMs,
      waveform: recording.waveform,
      localUrl: objectUrlFor(recording.blob),
    },
    options,
  );
}

function retryVoice(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryVoiceCore(ctx, chatId, messageId);
}

function deleteFailedMessage(ctx: StoreCtx, chatId: string, messageId: string): void {
  deleteFailedMessageCore(ctx, chatId, messageId);
}

function sendAttachment(
  ctx: StoreCtx,
  chatId: string,
  file: File,
  options?: SendAttachmentOptions,
): void {
  // An empty file is refused silently before any request or optimistic bubble.
  if (file.size === 0) {
    return;
  }
  sendAttachmentCore(ctx, chatId, file, options);
}

function sendSticker(
  ctx: StoreCtx,
  chatId: string,
  sticker: SendStickerInput,
  options?: SendTextOptions,
): void {
  sendStickerCore(ctx, chatId, sticker, options);
}

function forwardMessages(
  ctx: StoreCtx,
  targets: string[],
  messages: UiMessage[],
  options?: { comment?: string },
): void {
  forwardMessagesCore(ctx, targets, messages, options);
}

function retrySticker(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryStickerCore(ctx, chatId, messageId);
}

function retryAttachment(ctx: StoreCtx, chatId: string, messageId: string): void {
  retryAttachmentCore(ctx, chatId, messageId);
}

export type ChatActions = Pick<
  ChatStoreState,
  | 'dismissPinsError'
  | 'refreshChats'
  | 'openChat'
  | 'closeChat'
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
  | 'deleteForMe'
  | 'clearHistory'
  | 'sendTyping'
  | 'stopTyping'
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
  | 'switchUser'
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
  | 'setUnreadMark'
  | 'markChatRead'
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
    closeChat: (chatId) => {
      if (get().activeChatId === chatId) {
        set({ activeChatId: undefined });
      }
      // A deferred open must not fire later for a chat that was left: drop it and its marker.
      if (ctx.pendingOpenChatId === chatId) {
        ctx.pendingOpenChatId = undefined;
        clearSupersededMarker(ctx, chatId);
      }
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
    deleteForMe: (chatId, messageId) => {
      rt.runDetached(deleteForMeCore(ctx, chatId, messageId));
    },
    clearHistory: (chatId) => rt.runPromise(clearHistoryCore(ctx, chatId)),
    sendTyping: (chatId) => {
      sendTyping(ctx, chatId);
    },
    stopTyping: (chatId) => {
      stopTyping(ctx, chatId);
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
    switchUser: () => rt.runPromise(resetUserState(ctx)),
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
    setUnreadMark: (chatId, unreadMark) => rt.runPromise(setUnreadMark(ctx, chatId, unreadMark)),
    // Mark as read: recordRead clears the count, saves the mark and sends it; the pref clears
    // the manual mark.
    markChatRead: (chatId) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      recordRead(ctx, chatId, chat?.lastMessage?.archiveId ?? ctx.lastRead[chatId]);
      return rt.runPromise(setUnreadMark(ctx, chatId, false));
    },
    setChatBackground: (chatId, presetId) =>
      rt.runPromise(setChatBackground(ctx, chatId, presetId)),
    setDefaultBackground: (presetId) => rt.runPromise(setDefaultBackground(ctx, presetId)),
    setChatBackgroundImage: (chatId, imageId, dim) =>
      rt.runPromise(setChatBackgroundImage(ctx, chatId, imageId, dim)),
    setDefaultBackgroundImage: (imageId, dim) =>
      rt.runPromise(setDefaultBackgroundImage(ctx, imageId, dim)),
  };
}
