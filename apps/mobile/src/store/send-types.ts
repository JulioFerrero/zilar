import type { AlbumRef, ReplyRef, UiMention } from '@zilar/chat-core';

export type SendTextOptions = {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
};

export type SendAttachmentOptions = {
  caption?: string;
  replyTo?: ReplyRef;
  /** Album membership (`urn:zilar:album:0`). */
  album?: AlbumRef;
};

export type SendVoiceRecording = {
  /** Local `file://` URI of the recorded bytes (m4a on iOS). */
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
  waveform: number[];
};

export type SendStickerChoice = {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
};
