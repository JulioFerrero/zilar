// The ledger's id side tables: alias roots the store looks a message up by,
// linking a local optimistic id to the server id it resolved to, migrating the
// per-message tables when two ids merge, and resolving the id an edit or
// reaction must name. Moved unchanged from `store/ledger.ts` (size split); the
// maps themselves stay in `createMessageLedger` and arrive through `deps.maps`.
import type { ChatSummary, EditAuthor, EditsState, ReactionsState } from '@zilar/chat-core';
import { mergeEdits, mergeTargets } from '@zilar/chat-core';
import { listFor } from './ledger-signatures';
import type { LedgerMaps, LedgerSet, LedgerState } from './ledger-types';

interface LedgerIdsDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly maps: LedgerMaps;
  readonly refreshEdits: (chatId: string) => void;
  readonly refreshReactions: (chatId: string) => void;
}

export function createLedgerIds(deps: LedgerIdsDeps) {
  const { get, set, refreshEdits, refreshReactions } = deps;
  const {
    aliases: messageAliases,
    serverIds: messageServerIds,
    originIds: messageOriginIds,
    authors: messageAuthors,
    baseTexts: messageBaseTexts,
  } = deps.maps;

  // A message may be known under its optimistic local id and later under its
  // server id. The alias map keeps the two linked so a status change can be
  // applied to whichever form is currently in the store.
  function aliasRoot(id: string): string {
    let current = id;
    let next = messageAliases.get(current);
    while (next !== undefined && next !== current) {
      current = next;
      next = messageAliases.get(current);
    }
    return current;
  }

  function linkMessageIds(left: string, right: string): void {
    if (left === right) {
      return;
    }
    const rootLeft = aliasRoot(left);
    const rootRight = aliasRoot(right);
    if (rootLeft !== rootRight) {
      messageAliases.set(rootRight, rootLeft);
      // Reactions were stored under whichever id was known when they
      // arrived; move them onto the surviving root so the alias-aware
      // lookup finds them.
      migrateReactionTargets(rootRight, rootLeft);
      migrateEditTargets(rootRight, rootLeft);
      migrateIdMap(messageOriginIds, rootRight, rootLeft);
      migrateIdMap(messageAuthors, rootRight, rootLeft);
      migrateIdMap(messageBaseTexts, rootRight, rootLeft);
    }
  }

  // Copies the value stored under `from` (when any) onto `to`, keeping both
  // keys readable; used for the per-message side tables when two ids merge.
  function migrateIdMap<T>(map: Map<string, T>, from: string, to: string): void {
    const value = map.get(from);
    if (value === undefined) {
      return;
    }
    map.set(to, value);
    map.set(from, value);
  }

  function migrateEditTargets(from: string, to: string): void {
    const state = get();
    let changed = false;
    const next: Record<string, EditsState> = { ...state.edits };
    for (const [chatId, chatEdits] of Object.entries(state.edits)) {
      if (chatEdits.targets[from] === undefined) {
        continue;
      }
      next[chatId] = mergeEdits(chatEdits, from, to);
      changed = true;
    }
    if (!changed) {
      return;
    }
    set({ edits: next });
    for (const chatId of Object.keys(next)) {
      refreshEdits(chatId);
    }
  }

  function migrateReactionTargets(from: string, to: string): void {
    const state = get();
    let changed = false;
    const next: Record<string, ReactionsState> = { ...state.reactions };
    for (const [chatId, chatState] of Object.entries(state.reactions)) {
      if (chatState.targets[from] === undefined) {
        continue;
      }
      next[chatId] = mergeTargets(chatState, from, to);
      changed = true;
    }
    if (!changed) {
      return;
    }
    set({ reactions: next });
    for (const chatId of Object.keys(next)) {
      refreshReactions(chatId);
    }
  }

  function sameMessage(left: string, right: string): boolean {
    return aliasRoot(left) === aliasRoot(right);
  }

  // Remembers the server id that a local optimistic id resolved to, so a
  // reaction sent after the echo can name the target everyone else knows.
  function linkLocalToServer(localId: string, serverId: string): void {
    if (localId !== serverId) {
      messageServerIds.set(localId, serverId);
      // Also under the alias root so an action that already canonicalised
      // (e.g. a chip tap before the echo) resolves to the server id.
      messageServerIds.set(aliasRoot(localId), serverId);
    }
  }

  // The same link for a send's ack, which names the sender-generated id. In a
  // group, reactions must name the room's stanza id (XEP-0444), which only the
  // echo carries: when the echo came first and filed it, the later ack keeps
  // it. When the ack comes first, the echo overwrites the ack's id as before.
  // A DM links the ack's id either way, as before.
  function linkAckToServer(chat: ChatSummary, localId: string, serverId: string): void {
    if (
      chat.kind === 'group' &&
      (messageServerIds.has(localId) || messageServerIds.has(aliasRoot(localId)))
    ) {
      return;
    }
    linkLocalToServer(localId, serverId);
  }

  // The id to put on the wire for a message: the server (or archive) id when
  // it is known, else the message id itself. A still-unacked `local-*` id has
  // no server id yet and cannot be named, so it resolves to undefined.
  function wireTargetFor(messageId: string): string | undefined {
    const root = aliasRoot(messageId);
    const server = messageServerIds.get(root);
    if (server !== undefined) {
      return server;
    }
    return root.startsWith('local-') ? undefined : root;
  }

  // Remembers the author as the stanza described it, under both its own id
  // and its alias root, so a later edit can be authorized without the
  // original stanza.
  function rememberAuthor(messageId: string, author: EditAuthor): void {
    messageAuthors.set(messageId, author);
    messageAuthors.set(aliasRoot(messageId), author);
  }

  function rememberOriginId(messageId: string, originId: string): void {
    messageOriginIds.set(messageId, originId);
    messageOriginIds.set(aliasRoot(messageId), originId);
  }

  function rememberBaseText(messageId: string, text: string): void {
    messageBaseTexts.set(messageId, text);
    messageBaseTexts.set(aliasRoot(messageId), text);
  }

  function baseTextFor(messageId: string): string | undefined {
    return messageBaseTexts.get(aliasRoot(messageId)) ?? messageBaseTexts.get(messageId);
  }

  function authorFor(messageId: string): EditAuthor | undefined {
    return messageAuthors.get(aliasRoot(messageId)) ?? messageAuthors.get(messageId);
  }

  // The id a correction must name: the original sender-generated id, in DMs
  // and in groups alike (XEP-0308).
  function correctionTargetFor(messageId: string): string | undefined {
    const root = aliasRoot(messageId);
    return messageOriginIds.get(root) ?? messageOriginIds.get(messageId);
  }

  // The id a retraction must name: the origin id in a DM, the stanza-id in a
  // group (XEP-0424). A still-unacked group message has no stanza-id yet.
  function retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined {
    if (chat.kind === 'group') {
      const message = listFor(get(), chat.id).find((item) => sameMessage(item.id, messageId));
      const stanzaId = message?.id;
      return stanzaId === undefined || stanzaId.startsWith('local-') ? undefined : stanzaId;
    }
    return correctionTargetFor(messageId);
  }

  return {
    aliasRoot,
    linkMessageIds,
    sameMessage,
    linkLocalToServer,
    linkAckToServer,
    wireTargetFor,
    rememberAuthor,
    rememberOriginId,
    rememberBaseText,
    baseTextFor,
    authorFor,
    correctionTargetFor,
    retractionTargetFor,
  };
}

export type LedgerIds = ReturnType<typeof createLedgerIds>;
