import { defineDomain } from '../domain';
import { handleStickers } from './routes';
import { seedStickerPacks } from './seed';
import { createStickersState } from './state';

export const stickersDomain = defineDomain({
  name: 'stickers',
  seed: seedStickerPacks,
  createState: createStickersState,
  routes: handleStickers,
});
