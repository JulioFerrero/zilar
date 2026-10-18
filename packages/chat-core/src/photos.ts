import type { UiMessage } from './types';

export interface ViewerPhoto {
  messageId: string;
  url: string;
  alt: string;
}

// The kind, not the MIME, is the test: an untrusted photo is downgraded to `kind: 'file'` while keeping `image/*`, and stepping onto it would leak the reader's IP.
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
