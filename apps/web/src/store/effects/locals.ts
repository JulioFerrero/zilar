import type { MentionMember } from '@zilar/chat-core';
import { createCoreLocals, type CoreLocals } from '@zilar/client-core/store';
import type { GroupDetail } from '@/lib/api';
import type { SendRun } from './ctx';

/** The mutable locals the store closure owns: the handles effect modules bridge to through
 * StoreCtx, the caches they read and write, and the per-session maps stop() clears. */
export interface StoreLocals extends CoreLocals {
  lastReadUserId: string | undefined;
  finishedTurns: Set<string>;
  finishedTurnOrder: string[];
  // Open chat ids whose next disappearance moves silently: the client just archived that
  // topic itself, so the removed-while-open flow navigates without the notice.
  quietArchiveIds: Set<string>;
  // An outgoing attachment's bytes, kept for a Retry after a failed upload.
  pendingAttachments: Map<string, File>;
  // An outgoing voice recording's bytes, kept for a Retry after a failed send.
  pendingVoices: Map<string, { blob: Blob; waveform: number[] }>;
  // The current send attempt of a message, keyed by its alias root; it lets a retry's
  // deadline and a previous run's late pipeline agree on which outcome counts.
  sendRuns: Map<string, SendRun>;
  // chatId -> (lowercased user id -> member)
  groupMembers: Map<string, Map<string, MentionMember>>;
  // chatId -> the last group detail (people + AIs), for the info panel.
  groupInfos: Map<string, GroupDetail>;
  loadingGroupMembers: Set<string>;
}

export function createStoreLocals(): StoreLocals {
  return {
    ...createCoreLocals(),
    lastReadUserId: undefined,
    finishedTurns: new Set(),
    finishedTurnOrder: [],
    quietArchiveIds: new Set(),
    pendingAttachments: new Map(),
    pendingVoices: new Map(),
    sendRuns: new Map(),
    groupMembers: new Map(),
    groupInfos: new Map(),
    loadingGroupMembers: new Set(),
  };
}
