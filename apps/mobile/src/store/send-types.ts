import type { AlbumRef, ReplyRef, UiMention } from '@zilar/chat-core';

/**
 * The send option types of the mobile store, split out of `types.ts` by
 * T-1095. Every name is re-exported from `types.ts`, so importers are
 * unchanged.
 */

export type SendTextOptions = {
  replyTo?: ReplyRef;
  /** XEP-0372 mentions tracked by the composer (T-0227, like web). */
  mentions?: UiMention[];
};

/** Options for `sendAttachment`: a caption, an optional reply and album membership, like web. */
export type SendAttachmentOptions = {
  caption?: string;
  replyTo?: ReplyRef;
  /** Album membership (`urn:zilar:album:0`) for a photo sent as part of a pick. */
  album?: AlbumRef;
};

/** A finished voice recording the composer hands to the store (T-0154). */
export type SendVoiceRecording = {
  /** Local `file://` URI of the recorded bytes (m4a on iOS). */
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
  waveform: number[];
};

/** The tap-to-send choice the sticker panel hands to the store. */
export type SendStickerChoice = {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
};
