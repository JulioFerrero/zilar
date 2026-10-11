import type { ReplyRef, UiMention } from '@zilar/chat-core';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

/** Whether the chat list has arrived: `loading` until the first
 * successful `/api/chats` merge, `error` when that first load fails. */
export type ChatsState = 'loading' | 'ready' | 'error';

/** Whether a chat's first history page has arrived. */
export type HistoryState = 'loading' | 'ready' | 'error';

export interface TypingState {
  names: string[];
}

/** The live AI draft of one chat: the latest cumulative reply text. */
export interface DraftState {
  turnId: string;
  text: string;
}

export interface SendTextOptions {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
}

/** A finished recording on its way to the server and then to XEP-0363. */
export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  waveform: number[];
}

/** What the composer passes when it sends a file or image attachment. */
export interface SendAttachmentOptions {
  caption?: string;
  replyTo?: ReplyRef;
}

/** What the sticker panel passes when it sends a sticker (T-0120). */
export interface SendStickerInput {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}
