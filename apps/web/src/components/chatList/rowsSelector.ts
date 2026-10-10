import { Data } from 'effect';
import { groupChats, visibleChats, type ChatStoreState } from '@/store/store';

// A normal (re)connect takes well under this; only a slow one gets a banner.
export const CONNECTION_BANNER_DELAY_MS = 1500;

// The menu badge caps at 9+; any number bigger than that just reads "9+".
export const APPROVAL_BADGE_CAP = 9;

/** The install prompt failed or was refused; the menu then offers a retry. */
export class InstallFailed extends Data.TaggedError('InstallFailed') {}

export interface ChatRows {
  chats: ReturnType<typeof visibleChats>;
  groups: ReturnType<typeof groupChats>;
  archived: ReturnType<ChatStoreState['archivedChats']>;
}

/**
 * Derives the sidebar rows. The result is cached on the slices that feed it,
 * so a typing or presence update returns the same object and does not re-render.
 */
export function createRowsSelector(): (state: ChatStoreState) => ChatRows {
  let last:
    | {
        chats: ChatStoreState['chats'];
        search: string;
        activeFolder: ChatStoreState['activeFolder'];
        folders: ChatStoreState['folders'];
        rows: ChatRows;
      }
    | undefined;
  return (state) => {
    if (
      last !== undefined &&
      last.chats === state.chats &&
      last.search === state.search &&
      last.activeFolder === state.activeFolder &&
      last.folders === state.folders
    ) {
      return last.rows;
    }
    const rows = {
      chats: visibleChats(state),
      groups: groupChats(state),
      archived: state.archivedChats(),
    };
    last = {
      chats: state.chats,
      search: state.search,
      activeFolder: state.activeFolder,
      folders: state.folders,
      rows,
    };
    return rows;
  };
}

export function statusLabel(status: string): string | undefined {
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
