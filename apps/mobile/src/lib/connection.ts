import type { ConnectionStatus } from '../store/types';

/**
 * The thin status bar text shown in the chat list while the XMPP connection is
 * not `online`, like Telegram (see `ui-style.md` §4).
 */
export function connectionLabel(status: ConnectionStatus): string | undefined {
  switch (status) {
    case 'connecting':
    case 'reconnecting':
      return 'Connecting…';
    case 'offline':
      return 'Waiting for network…';
    default:
      return undefined;
  }
}
