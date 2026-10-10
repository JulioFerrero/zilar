/**
 * The real native attachment seams (T-0150): `expo-image-picker` for photos,
 * videos and the camera, `expo-document-picker` for generic files,
 * `expo-file-system` for the XEP-0363 PUT, and React Native's built-in
 * `Share` for opening downloaded files. Only imported by the chat screen
 * (and tests through the port interfaces), so Vitest never loads the
 * native modules uninvoked.
 *
 * Split into `attachment-picker`, `attachment-uploader`, `attachment-opener`
 * and `gif-downloader` (T-1021); this barrel keeps the original path and
 * exports every name unchanged.
 */

export type { PickedFile, PickResult } from './attachment-ports';
export { createAttachmentPicker, createSizeReader } from './attachment-picker';
export type { SizeReader } from './attachment-picker';
export { createAttachmentUploader } from './attachment-uploader';
export { cacheDestinationFor, createAttachmentOpener } from './attachment-opener';
export { createGifDownloader, GIF_DOWNLOAD_FAILED_MESSAGE } from './gif-downloader';
