import type { MentionMember } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import type { GroupDetail } from '@/lib/api';
import type { MediaTokenShape } from '@/lib/attachments';
import type { SendRun } from './ctx';

/**
 * The mutable locals the store closure owns: the handles the effect modules
 * bridge to through `StoreCtx`, the caches they read and write, and the
 * per-session maps a `stop()` clears. One object so the closure and its
 * helpers share a single owner instead of a wall of `let` bindings.
 */
export interface StoreLocals {
  core: XmppCore | undefined;
  lastRead: Record<string, string>;
  lastReadUserId: string | undefined;
  // Group history (MUC MAM) only works once the room is joined, which
  // happens after the connection is online.
  groupsJoined: boolean;
  // Turn ids whose draft is done, so a late `draft` is ignored.
  finishedTurns: Set<string>;
  finishedTurnOrder: string[];
  // The XMPP token the latest session connected with, kept for the media
  // allow-list (T-0065 round 1): images are only auto-loaded from hosts the
  // server names, so a chat peer cannot make every viewer fetch a tracker.
  mediaToken: MediaTokenShape | undefined;
  // Open chat ids whose next disappearance moves silently (T-0130 review):
  // the client just archived that topic itself from its own header, so
  // the removed-while-open flow navigates without the "no longer
  // available" notice. Consumed on first use.
  quietArchiveIds: Set<string>;
  cursors: Record<string, string | undefined>;
  pendingOutgoing: Map<string, string[]>;
  // An outgoing attachment's bytes, kept for a Retry after a failed upload.
  pendingAttachments: Map<string, File>;
  // An outgoing voice recording's bytes, kept for a Retry after a failed
  // send (T-0168); dropped once the stanza send succeeds, like attachments.
  pendingVoices: Map<string, { blob: Blob; waveform: number[] }>;
  // The current send attempt of a message, keyed by its alias root (T-0168).
  // The run lets a retry's deadline and a previous run's late pipeline agree
  // on which outcome counts.
  sendRuns: Map<string, SendRun>;
  groupIds: Map<string, string>;
  // chatId -> (lowercased user id -> member)
  groupMembers: Map<string, Map<string, MentionMember>>;
  // chatId -> the last group detail (people + AIs), for the info panel.
  groupInfos: Map<string, GroupDetail>;
  loadingGroupMembers: Set<string>;
  loadingOlder: Set<string>;
  // First-page history loads currently in flight, by chat id.
  loadingHistory: Set<string>;
  // A chat opened before the core was connected or before the chats had
  // arrived (e.g. a reload of /c/<jid>). Only the latest one counts; it
  // loads as soon as both are ready.
  pendingOpenChatId: string | undefined;
}

/** Creates the closure's mutable locals, all fresh for one store instance. */
export function createStoreLocals(): StoreLocals {
  return {
    core: undefined,
    lastRead: {},
    lastReadUserId: undefined,
    groupsJoined: false,
    finishedTurns: new Set(),
    finishedTurnOrder: [],
    mediaToken: undefined,
    quietArchiveIds: new Set(),
    cursors: {},
    pendingOutgoing: new Map(),
    pendingAttachments: new Map(),
    pendingVoices: new Map(),
    sendRuns: new Map(),
    groupIds: new Map(),
    groupMembers: new Map(),
    groupInfos: new Map(),
    loadingGroupMembers: new Set(),
    loadingOlder: new Set(),
    loadingHistory: new Set(),
    pendingOpenChatId: undefined,
  };
}
