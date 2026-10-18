// The ledger's id side tables: alias roots, local-to-server links, table migration when
// two ids merge, and the id an edit or reaction must name.
import type { ChatSummary, EditAuthor, EditsState, ReactionsState } from '@zilar/chat-core';
import { isSameAuthor, mergeEdits, mergeTargets } from '@zilar/chat-core';
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
    originClaims: messageOriginClaims,
    authors: messageAuthors,
    baseTexts: messageBaseTexts,
    cards: messageCards,
  } = deps.maps;

  // A message may be known under its optimistic local id and later its server id; the
  // alias map keeps the two linked so a status change reaches whichever form is stored.
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
      // Reactions were stored under whichever id was known when they arrived; move them
      // onto the surviving root so the alias lookup finds them.
      migrateReactionTargets(rootRight, rootLeft);
      migrateEditTargets(rootRight, rootLeft);
      migrateCardEntries(rootRight, rootLeft);
      migrateIdMap(messageOriginIds, rootRight, rootLeft);
      migrateAuthor(rootRight, rootLeft);
      migrateIdMap(messageBaseTexts, rootRight, rootLeft);
    }
  }

  // The first author recorded for a message wins: an origin id can name
  // another sender's message, and linking must not hand that message over.
  function migrateAuthor(from: string, to: string): void {
    const value = messageAuthors.get(from);
    if (value === undefined) {
      return;
    }
    const existing = messageAuthors.get(to);
    if (existing !== undefined && !isSameAuthor(existing, value)) {
      return;
    }
    messageAuthors.set(to, value);
    messageAuthors.set(from, value);
  }

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

  // Keeps the newest card update when two ids turn out to be one, like `mergeEdits` does
  // for edit state.
  function migrateCardEntries(from: string, to: string): void {
    const source = messageCards.get(from);
    if (source === undefined) {
      return;
    }
    const existing = messageCards.get(to);
    messageCards.set(
      to,
      existing === undefined || source.order > existing.order ? source : existing,
    );
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

  // Remembers the server id a local optimistic id resolved to, so a later reaction can
  // name the target everyone knows.
  function linkLocalToServer(localId: string, serverId: string): void {
    if (localId !== serverId) {
      messageServerIds.set(localId, serverId);
      // Also under the alias root, so an action that already canonicalised (e.g. a chip
      // tap before the echo) resolves.
      messageServerIds.set(aliasRoot(localId), serverId);
    }
  }

  // The same link for a send's ack. In a group, reactions must name the room's stanza id
  // (XEP-0444), which only the echo carries: when the echo came first, the ack keeps it;
  // when the ack came first, the echo overwrites.
  function linkAckToServer(chat: ChatSummary, localId: string, serverId: string): void {
    if (
      chat.kind === 'group' &&
      (messageServerIds.has(localId) || messageServerIds.has(aliasRoot(localId)))
    ) {
      return;
    }
    linkLocalToServer(localId, serverId);
  }

  // The id to put on the wire: the server (or archive) id when known, else the message
  // id. A still-unacked `local-*` id cannot be named.
  function wireTargetFor(messageId: string): string | undefined {
    const root = aliasRoot(messageId);
    const server = messageServerIds.get(root);
    if (server !== undefined) {
      return server;
    }
    return root.startsWith('local-') ? undefined : root;
  }

  // Remembers the author under both its own id and its alias root, so a later edit can be
  // authorized without the original stanza.
  function rememberAuthor(messageId: string, author: EditAuthor): void {
    messageAuthors.set(messageId, author);
    messageAuthors.set(aliasRoot(messageId), author);
  }

  // Remembers a message's sender-generated origin id and links the two ids that name one
  // message: a resend keeps its origin id and the server can archive it twice with
  // different stanza-ids, so aliasing makes `sameMessage` true and the history dedupe drops
  // the second copy. Scoped to chat and sender because origin ids are client-generated.
  // A correction or retraction names its target by origin id but is never a second copy.
  function rememberOriginId(
    messageId: string,
    originId: string,
    chatId?: string,
    sender?: string,
  ): void {
    messageOriginIds.set(messageId, originId);
    messageOriginIds.set(aliasRoot(messageId), originId);
    if (chatId === undefined || sender === undefined) {
      return;
    }
    const key = `${chatId}|${originId}`;
    const claim = messageOriginClaims.get(key);
    if (claim === undefined) {
      // The first message of this origin id in this chat. An origin id is client-generated
      // and may name another sender's message: linking would let a later correction take it
      // over.
      const originAuthor = authorFor(originId);
      if (
        originAuthor !== undefined &&
        !isSameAuthor(originAuthor, { jid: sender, resolved: true })
      ) {
        return;
      }
      if (originId !== messageId) {
        linkMessageIds(originId, messageId);
      }
    } else if (claim.sender === sender) {
      if (!sameMessage(claim.root, messageId)) {
        linkMessageIds(claim.root, messageId);
      }
    } else {
      return;
    }
    messageOriginClaims.set(key, { sender, root: aliasRoot(messageId) });
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

  // The id a correction must name: the original sender-generated id, in DMs and groups
  // alike (XEP-0308).
  function correctionTargetFor(messageId: string): string | undefined {
    const root = aliasRoot(messageId);
    return messageOriginIds.get(root) ?? messageOriginIds.get(messageId);
  }

  // The id a retraction must name: the origin id in a DM, the stanza-id in a group
  // (XEP-0424); a still-unacked group message has none.
  function retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined {
    if (chat.kind === 'group') {
      const message = listFor(get(), chat.id).find((item) => sameMessage(item.id, messageId));
      const stanzaId = message?.id;
      return stanzaId === undefined || stanzaId.startsWith('local-') ? undefined : stanzaId;
    }
    return correctionTargetFor(messageId);
  }

  // Drops every per-message map entry of a chat's pruned messages, so the ledger's maps do
  // not grow for the life of the session.
  function forgetMessages(chatId: string, messageIds: readonly string[]): void {
    if (messageIds.length === 0) {
      return;
    }
    const roots = new Set(messageIds.map((id) => aliasRoot(id)));
    const ids = new Set<string>(messageIds);
    for (const root of roots) {
      ids.add(root);
    }
    // An alias goes when it names a forgotten id or points at one, so no later lookup
    // resolves a pruned message.
    for (const [alias, target] of messageAliases) {
      if (ids.has(alias) || roots.has(target)) {
        messageAliases.delete(alias);
      }
    }
    for (const id of ids) {
      messageServerIds.delete(id);
      const originId = messageOriginIds.get(id);
      messageOriginIds.delete(id);
      messageAuthors.delete(id);
      messageBaseTexts.delete(id);
      messageCards.delete(id);
      if (originId !== undefined) {
        messageOriginClaims.delete(`${chatId}|${originId}`);
      }
    }
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
    forgetMessages,
  };
}

export type LedgerIds = ReturnType<typeof createLedgerIds>;
