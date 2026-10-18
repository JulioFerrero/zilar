import type { EffectApiMount } from '../effect/http-core';
import { createAvatarsApi } from '../avatars/api';
import { createBackgroundsApi } from '../backgrounds/api';
import { createCardMediaApi } from '../card-media/api';
import { createGetBotToken } from '../integrations/routes';
import { settingsCipherFor } from '../setup/settings';
import { createStickerConverter } from '../stickers/convert';
import { createStickersApi } from '../stickers/api';
import type { RouteWiring } from './deps';
import { opt } from './opt';

export function mediaRoutes({ deps, base, audit }: RouteWiring): EffectApiMount[] {
  const { config } = base;
  const mounts: EffectApiMount[] = [];
  // The bot token resolves per request: env wins, else the stored integrations value.
  const getBotToken = createGetBotToken({
    ...base,
    cipher: settingsCipherFor(config),
  });
  const stickersDeps = {
    ...base,
    storageDir: deps.stickerStorageDir ?? config.STICKER_STORAGE_DIR,
    audit,
    getBotToken,
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
  const avatarsApi = createAvatarsApi({
    ...base,
    storageDir: deps.avatarStorageDir ?? config.AVATAR_STORAGE_DIR,
    audit,
    ...opt('now', deps.avatarNow),
    ...opt('uploadLimiter', deps.avatarUploadLimiter),
  });
  mounts.push(avatarsApi);
  const backgroundsApi = createBackgroundsApi({
    ...base,
    storageDir: deps.backgroundStorageDir ?? config.BACKGROUND_STORAGE_DIR,
    ...opt('now', deps.backgroundNow),
    ...opt('uploadLimiter', deps.backgroundUploadLimiter),
  });
  mounts.push(backgroundsApi);

  const cardMediaApi = createCardMediaApi({
    ...base,
    storageDir: deps.cardMediaStorageDir ?? config.CARD_MEDIA_STORAGE_DIR,
  });
  mounts.push(cardMediaApi);

  return mounts;
}
