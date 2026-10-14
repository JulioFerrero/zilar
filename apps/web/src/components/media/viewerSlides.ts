import type { ViewerPhoto } from '@zilar/chat-core';
import type { SlideImage } from 'yet-another-react-lightbox';
import { mediaSrc } from '@/lib/attachments';

/**
 * The photo viewer's slides for a chat (T-1343). Every URL goes through
 * `mediaSrc`, the same source rule the rest of the media UI applies: a
 * same-origin `/upload/` photo loads via `GET /api/files`, where the server
 * checks the session and chat membership, and every other URL keeps its own
 * source (`blob:`, `data:`, another origin's trusted host).
 *
 * An untrusted host is never fetched: `photosOf` only returns photos whose
 * attachment kind is `image`, and a peer's non-trusted host is downgraded to
 * `file` before that (`sanitizeIncomingAttachment`).
 */
export function viewerSlides(chatId: string, photos: readonly ViewerPhoto[]): SlideImage[] {
  return photos.map((photo) => ({ src: mediaSrc(chatId, photo.url), alt: photo.alt }));
}
