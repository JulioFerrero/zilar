import type { ViewerPhoto } from '@zilar/chat-core';
import type { SlideImage } from 'yet-another-react-lightbox';
import { mediaSrc } from '@/lib/attachments';

/**
 * Every URL goes through `mediaSrc`: a same-origin `/upload/` photo loads via
 * `GET /api/files`, where the server checks the session and chat membership;
 * every other URL keeps its own source. An untrusted host is never fetched:
 * `photosOf` only returns images, and the sanitizer downgrades a peer's
 * non-trusted host to `file` first.
 */
export function viewerSlides(chatId: string, photos: readonly ViewerPhoto[]): SlideImage[] {
  return photos.map((photo) => ({ src: mediaSrc(chatId, photo.url), alt: photo.alt }));
}
