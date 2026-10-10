// The message ledger shared by the web and mobile chat stores: message ids and
// their aliases, origin ids, authors and base texts, edits, reactions,
// mentions, previews, reply quotes, sender and reactor names, the mapping of a
// received stanza to a bubble, and the mutators every send and receive path
// goes through. It reads and writes the store state through `get` and `set`,
// and reads back its own writes (`refreshEdits`, `migrateReactionTargets`), so
// the store must keep a synchronous `set`.
//
// This is the barrel: the ledger's pieces live in `ledger-types.ts`,
// `ledger-signatures.ts`, `ledger-ids.ts`, `ledger-edits.ts`,
// `ledger-mutators.ts`, `ledger-identity.ts`, `ledger-reactions.ts` and
// `ledger-incoming.ts`, and are assembled here. Moved unchanged from the
// former single file (size split).
import { createLedgerEdits } from './ledger-edits';
import { createLedgerIdentity } from './ledger-identity';
import { createLedgerIds } from './ledger-ids';
import { createLedgerIncoming } from './ledger-incoming';
import { createLedgerMutators } from './ledger-mutators';
import { createLedgerReactions } from './ledger-reactions';
import {
  isEditStanza,
  isReactionOnly,
  listFor,
  previewFor,
  signatureFor,
  stickerSignatureFor,
} from './ledger-signatures';
import type { LedgerMaps, MessageLedgerDeps } from './ledger-types';

export type {
  LedgerContact,
  LedgerPatch,
  LedgerSet,
  LedgerState,
  LedgerStanza,
  MessageLedgerDeps,
  StoreMessage,
} from './ledger-types';
export { isEditStanza, isReactionOnly, listFor, previewFor, signatureFor, stickerSignatureFor };

export type MessageLedger = ReturnType<typeof createMessageLedger>;

export function createMessageLedger(deps: MessageLedgerDeps) {
  const { get, set } = deps;

  // The id side tables the moved modules share; they stay here so the returned
  // object can hand the raw maps to the store's sign-out.
  const maps: LedgerMaps = {
    aliases: new Map(),
    serverIds: new Map(),
    originIds: new Map(),
    authors: new Map(),
    baseTexts: new Map(),
  };

  // `ids` needs the edit and reaction refresh paths, which are built after it;
  // the wrappers defer to them so the two do not have to be created in order.
  const ids = createLedgerIds({
    get,
    set,
    maps,
    refreshEdits: (chatId) => edits.refreshEdits(chatId),
    refreshReactions: (chatId) => reactions.refreshReactions(chatId),
  });
  const identity = createLedgerIdentity({ get, deps });
  const reactions = createLedgerReactions({ get, set, ids, identity });
  const incoming = createLedgerIncoming({ get, set, deps, ids, identity, reactions });
  const edits = createLedgerEdits({ get, set, ids, incoming });
  const mutators = createLedgerMutators({ set, ids });

  // Forgets every id the ledger knows, for a store whose sign-out resets it.
  function reset(): void {
    maps.aliases.clear();
    maps.serverIds.clear();
    maps.originIds.clear();
    maps.authors.clear();
    maps.baseTexts.clear();
  }

  return {
    reset,
    /** Read by the store's sign-out, which clears them. */
    messageAuthors: maps.authors,
    messageOriginIds: maps.originIds,
    messageBaseTexts: maps.baseTexts,
    listFor,
    sameMessage: ids.sameMessage,
    ingestHistoryReactions: reactions.ingestHistoryReactions,
    ingestHistoryEdits: edits.ingestHistoryEdits,
    isReactionOnly,
    isEditStanza,
    toUiMessage: incoming.toUiMessage,
    resolvePendingEdits: edits.resolvePendingEdits,
    withEdits: edits.withEdits,
    refreshEdits: edits.refreshEdits,
    refreshReactions: reactions.refreshReactions,
    previewFor,
    myJid: identity.myJid,
    aliasRoot: ids.aliasRoot,
    linkMessageIds: ids.linkMessageIds,
    linkLocalToServer: ids.linkLocalToServer,
    linkAckToServer: ids.linkAckToServer,
    rememberOriginId: ids.rememberOriginId,
    rememberAuthor: ids.rememberAuthor,
    rememberBaseText: ids.rememberBaseText,
    authorFor: ids.authorFor,
    correctionTargetFor: ids.correctionTargetFor,
    signatureFor,
    stickerSignatureFor,
    setChatMessage: incoming.setChatMessage,
    updateMessageStatus: mutators.updateMessageStatus,
    updateMessageVoice: mutators.updateMessageVoice,
    updateMessageAttachment: mutators.updateMessageAttachment,
    markSendFailed: mutators.markSendFailed,
    markSendRetrying: mutators.markSendRetrying,
    markStickerFailed: mutators.markStickerFailed,
    markAttachmentFailed: mutators.markAttachmentFailed,
    removeFailedMessage: mutators.removeFailedMessage,
    clearSendFailure: mutators.clearSendFailure,
    isOwnSender: identity.isOwnSender,
    senderNameFor: identity.senderNameFor,
    ingestEdit: edits.ingestEdit,
    ingestReaction: reactions.ingestReaction,
    applyReactionUpdate: reactions.applyReactionUpdate,
    wireTargetFor: ids.wireTargetFor,
    retractionTargetFor: ids.retractionTargetFor,
    restoreMessage: edits.restoreMessage,
    restoreEdits: edits.restoreEdits,
  };
}
