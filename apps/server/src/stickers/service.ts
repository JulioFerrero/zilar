// T-0958: the stickers service was split into `schemas`, `storage`, `packs`,
// `panel`, `favorites` and `telegram`. This file stays the barrel so
// importers (routes, api, avatars, backgrounds, main) do not change.
export {
  STICKER_PACKS_MAX_PER_USER,
  STICKER_PACK_TITLE_MAX,
  STICKER_PACK_TITLE_MIN,
  STICKER_PANEL_MAX,
  STICKERS_MAX_PER_PACK,
  STICKER_EMOJI_MAX,
  DISCOVER_PAGE_SIZE,
  stickerVisibilitySchema,
  createPackBodySchema,
  patchPackBodySchema,
} from './schemas';
export type {
  StickerVisibility,
  StickerPackRow,
  StickerRow,
  StickerView,
  StickerPackView,
  StickersServiceDeps,
  CreatePackBody,
  PatchPackBody,
  UploadStickerBody,
} from './schemas';

export {
  resolveStorageDir,
  serverPackageRoot,
  SERVER_PACKAGE_ROOT,
  toStickerView,
  toPackView,
  escapeLike,
  uploadSticker,
  deleteSticker,
  readStickerFile,
} from './storage';
export type { StickerFile } from './storage';

export { listPanelPacks, createPack, patchPack, deletePack, discoverPacks } from './packs';

export { addPanelPack, removePanelPack, reorderPanelBodySchema, reorderPanelPacks } from './panel';
export type { ReorderPanelBody } from './panel';

export {
  STICKER_FAVORITES_MAX,
  favoriteBodySchema,
  listFavorites,
  addFavorite,
  removeFavorite,
} from './favorites';
export type { FavoriteBody } from './favorites';

export {
  TELEGRAM_IMPORT_CONSIDER_MAX,
  TELEGRAM_IMPORT_STICKERS_MAX,
  TELEGRAM_IMPORT_CONCURRENCY,
  importTelegramPack,
} from './telegram';
export type { TelegramImportResult, TelegramImportDeps } from './telegram';
