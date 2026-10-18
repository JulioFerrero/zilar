// Imported only by the chat screen (tests use the port interfaces), so Vitest never loads the native modules uninvoked.

export type { PickedFile, PickResult } from './attachment-ports';
export { createAttachmentPicker, createGalleryReader, createSizeReader } from './attachment-picker';
export type {
  GalleryAsset,
  GalleryPage,
  GalleryPickResult,
  GalleryReader,
  SizeReader,
} from './attachment-picker';
export { createAttachmentUploader } from './attachment-uploader';
export { cacheDestinationFor, createAttachmentOpener } from './attachment-opener';
export { createGifDownloader, GIF_DOWNLOAD_FAILED_MESSAGE } from './gif-downloader';
