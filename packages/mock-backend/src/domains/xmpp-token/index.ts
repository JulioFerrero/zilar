import { defineDomain } from '../domain';
import { handleXmppToken } from './routes';

export const xmppTokenDomain = defineDomain({
  name: 'xmpp-token',
  routes: handleXmppToken,
});
