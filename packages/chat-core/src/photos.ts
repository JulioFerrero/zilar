import type { UiMessage } from './types';

/** One photo of a chat, in message order. */
export interface ViewerPhoto {
  messageId: string;
  url: string;
  alt: string;
}

/**
 * The photos of a chat, in message order: a message with an `image`, or with an
 * attachment whose `kind` is `image`. The kind, not the MIME, is the test: a
 * photo on an untrusted host is downgraded to `kind: 'file'` by
 * `sanitizeIncomingAttachment` while keeping its `image/*` MIME, and stepping
 * onto it would load the bytes from that host and leak the reader's IP. Files
 * and GIF-origin videos are left out.
 */
export function photosOf(messages: readonly UiMessage[]): ViewerPhoto[] {
  const photos: ViewerPhoto[] = [];
  for (const message of messages) {
    if (message.image !== undefined) {
      photos.push({ messageId: message.id, url: message.image.url, alt: 'Photo' });
    } else if (message.attachment !== undefined && message.attachment.kind === 'image') {
      photos.push({
        messageId: message.id,
        url: message.attachment.url,
        alt: message.attachment.name,
      });
    }
  }
  return photos;
}
