import type { ReplyRef, UiMention } from '@zilar/chat-core';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

/** Whether the chat list has arrived: loading until the first /api/chats merge, error when
 *  that first load fails. */
export type ChatsState = 'loading' | 'ready' | 'error';

export type HistoryState = 'loading' | 'ready' | 'error';

export interface TypingState {
  names: string[];
}

export interface DraftState {
  turnId: string;
  text: string;
}

export interface SendTextOptions {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
}

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  waveform: number[];
}

export interface SendAttachmentOptions {
  caption?: string;
  replyTo?: ReplyRef;
}

export interface SendStickerInput {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}
