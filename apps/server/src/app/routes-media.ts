// The sticker, avatar and background routes `createApp` mounts next, in mount
// order (T-1460, plan #48).
import type { EffectApiMount } from '../effect/http-core';
import { createAvatarsApi } from '../avatars/api';
import { createBackgroundsApi } from '../backgrounds/api';
import { createGetBotToken } from '../integrations/routes';
import { settingsCipherFor } from '../setup/settings';
import { createStickerConverter } from '../stickers/convert';
import { createStickersApi } from '../stickers/api';
import type { RouteWiring } from './deps';
import { opt } from './opt';

/** The media-storage mounts: stickers, avatars and backgrounds. */
export function mediaRoutes({ deps, base, audit }: RouteWiring): EffectApiMount[] {
  const { config } = base;
  const mounts: EffectApiMount[] = [];
  // Stickers (T-0120): packs, uploads and file serving. The storage dir
  // comes from `STICKER_STORAGE_DIR`; tests override it with a temp dir.
  // The bot token resolves per request: env wins, else the stored
  // integrations value, else none (T-0162), so saving needs no restart.
  const getBotToken = createGetBotToken({
    ...base,
    cipher: settingsCipherFor(config),
  });
  // The Effect api serves all 14 sticker routes, binary upload and file GET
  // included (T-0582 part A, T-0602 part B).
  const stickersDeps = {
    ...base,
    storageDir: deps.stickerStorageDir ?? config.STICKER_STORAGE_DIR,
    audit,
    getBotToken,
    // T-1567: conversion failures go to the pino log, not `console.warn`.
    converter: createStickerConverter({
      warn: (summary, stderrTail) =>
        base.logger.warn({ stderrTail }, `sticker conversion failed: ${summary}`),
    }),
    ...opt('now', deps.stickerNow),
    ...opt('uploadLimiter', deps.uploadLimiter),
    ...opt('telegramClient', deps.telegramClient),
    ...opt('now', deps.telegramImportNow),
  };
  const stickersApi = createStickersApi(stickersDeps);
  mounts.push(stickersApi);
  // Avatars (T-0165): upload / remove / serve profile pictures for
  // people, AIs, groups and channels. The storage dir comes from
  // `AVATAR_STORAGE_DIR`; tests override it with a temp dir.
  const avatarsApi = createAvatarsApi({
    ...base,
    storageDir: deps.avatarStorageDir ?? config.AVATAR_STORAGE_DIR,
    audit,
    ...opt('now', deps.avatarNow),
    ...opt('uploadLimiter', deps.avatarUploadLimiter),
  });
  mounts.push(avatarsApi);
  // Background images (T-0460): upload / list / serve / delete personal
  // wallpapers, owner-only. The storage dir comes from
  // `BACKGROUND_STORAGE_DIR`; tests override it with a temp dir.
  const backgroundsApi = createBackgroundsApi({
    ...base,
    storageDir: deps.backgroundStorageDir ?? config.BACKGROUND_STORAGE_DIR,
    ...opt('now', deps.backgroundNow),
    ...opt('uploadLimiter', deps.backgroundUploadLimiter),
  });
  mounts.push(backgroundsApi);

  return mounts;
}
