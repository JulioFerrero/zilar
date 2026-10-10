import { defineDomain } from '../domain';
import { handleAvatars } from './routes';
import { createAvatarsState } from './state';

export const avatarsDomain = defineDomain({
  name: 'avatars',
  createState: createAvatarsState,
  routes: handleAvatars,
});
