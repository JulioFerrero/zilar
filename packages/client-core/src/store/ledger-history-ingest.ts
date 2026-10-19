// Ingesting a history page as one batch: every reaction and edit is applied to a working
// copy, and the result lands in one store update with the merged page.
import { Effect } from 'effect';
import type { EditUpdate } from '@zilar/chat-core';
import { applyEdit, emptyEdits, isSameAuthor } from '@zilar/chat-core';
import type { LedgerEdits } from './ledger-edits';
import type { LedgerIds } from './ledger-ids';
import { correctionChanged } from './ledger-routine-bump';
import { authorOfChatMessage, isEditStanza } from './ledger-signatures';
import type {
  CardEdit,
  LedgerPatch,
  LedgerSet,
  LedgerState,
  LedgerStanza,
  StoreMessage,
} from './ledger-types';
import { sortMessages } from './rows';

interface EditRecorderDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  readonly ids: LedgerIds;
  readonly cards: Map<string, CardEdit>;
}

export interface RecordedEdit {
  readonly update: EditUpdate | undefined;
  readonly applied: boolean;
}

export function createEditRecorder(deps: EditRecorderDeps) {
  const { get, set, cards } = deps;
  const { aliasRoot, authorFor } = deps.ids;

  function editUpdateFor(message: LedgerStanza): EditUpdate | undefined {
    const order = message.timestamp.getTime();
    const author = authorOfChatMessage(message);
    if (message.retraction !== undefined) {
      return {
        kind: 'retraction',
        targetId: aliasRoot(message.retraction.targetId),
        author,
        order,
      };
    }
    if (message.correction !== undefined) {
      // A correction without a body has no new text: ignore it rather than blanking the
      // original.
      if (message.body === undefined) {
        return undefined;
      }
      const update: EditUpdate = {
        kind: 'correction',
        targetId: aliasRoot(message.correction.targetId),
        author,
        text: message.body,
        order,
      };
      if (message.mentions !== undefined && message.mentions.length > 0) {
        update.mentions = message.mentions;
      }
      return update;
    }
    return undefined;
  }

  // A correction carrying a progress or blocks payload replaces its target's card; a
  // body-less one still counts, since the card is the whole update.
  function cardEditFor(message: LedgerStanza): CardEdit | undefined {
    const correction = message.correction;
    const payload = message.payload;
    const isCard = payload?.type === 'progress' || payload?.type === 'blocks';
    if (correction === undefined || payload === undefined || !isCard) {
      return undefined;
    }
    return {
      order: message.timestamp.getTime(),
      author: authorOfChatMessage(message),
      payload,
    };
  }

  // Remembers a card update under the alias root of its target; an update from another
  // author is ignored, and an older stanza never overwrites a newer one.
  function rememberCard(targetId: string, entry: CardEdit): void {
    const targetAuthor = authorFor(targetId);
    if (targetAuthor !== undefined && !isSameAuthor(targetAuthor, entry.author)) {
      return;
    }
    const root = aliasRoot(targetId);
    const existing = cards.get(root);
    if (existing !== undefined && existing.order > entry.order) {
      return;
    }
    cards.set(root, entry);
  }

  // `applyEdit` returns a fresh object even for a stale order or duplicate, so the edit
  // state itself is compared.
  function applyEditState(chatId: string, update: EditUpdate): boolean {
    const target = authorFor(update.targetId);
    const before = get().edits[chatId]?.targets[update.targetId];
    set((state) => ({
      edits: {
        ...state.edits,
        [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, target),
      },
    }));
    const after = get().edits[chatId]?.targets[update.targetId];
    return target !== undefined && correctionChanged(before, after);
  }

  function recordEdit(message: LedgerStanza): RecordedEdit {
    const card = cardEditFor(message);
    if (card !== undefined && message.correction !== undefined) {
      rememberCard(message.correction.targetId, card);
    }
    const update = editUpdateFor(message);
    return { update, applied: update !== undefined && applyEditState(message.chatJid, update) };
  }

  return { recordEdit, hasCard: (message: LedgerStanza) => cardEditFor(message) !== undefined };
}

export type EditRecorder = ReturnType<typeof createEditRecorder>;

interface HistoryIngestDeps {
  readonly recorder: EditRecorder;
  readonly edits: Pick<LedgerEdits, 'resolvePendingEdits' | 'refreshEdits'>;
}

export function createHistoryIngest(deps: HistoryIngestDeps) {
  const { recorder, edits } = deps;

  // History never bumps a routine chat: an old page read back at boot or on open must not
  // reorder or inflate.
  function ingestHistoryEdits(messages: readonly LedgerStanza[]): void {
    const chats = new Set<string>();
    for (const message of messages) {
      if (!isEditStanza(message)) {
        continue;
      }
      const { update } = recorder.recordEdit(message);
      if (update !== undefined || recorder.hasCard(message)) {
        chats.add(message.chatJid);
      }
    }
    for (const chatId of chats) {
      edits.resolvePendingEdits(chatId);
      edits.refreshEdits(chatId);
    }
  }

  return { ingestHistoryEdits };
}

export interface LedgerBatchView {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
}

const LEDGER_KEYS = ['messagesByChat', 'chats', 'edits', 'reactions'] as const;

/**
 * A working copy of the ledger's state. Inside `collect`, `set` writes to the copy and
 * nothing reaches the store; `collect` returns what changed.
 */
export function createLedgerBatch(store: LedgerBatchView) {
  let working: LedgerState | undefined;
  const touched = new Set<string>();

  const get = (): LedgerState => working ?? store.get();

  const set: LedgerSet = (update) => {
    if (working === undefined) {
      store.set(update);
      return;
    }
    const patch = typeof update === 'function' ? update(working) : update;
    for (const key of LEDGER_KEYS) {
      if (patch[key] !== undefined) {
        touched.add(key);
      }
    }
    working = { ...working, ...patch };
  };

  function commit(): LedgerPatch {
    const patch: LedgerPatch = {};
    for (const key of LEDGER_KEYS) {
      if (touched.has(key) && working !== undefined) {
        Object.assign(patch, { [key]: working[key] });
      }
    }
    return patch;
  }

  function collect(run: (view: LedgerBatchView) => void): LedgerPatch {
    if (working !== undefined) {
      run({ get, set });
      return {};
    }
    working = store.get();
    touched.clear();
    // The copy is dropped when `run` throws too, so later writes reach the store.
    return Effect.runSync(
      Effect.sync(() => {
        run({ get, set });
        return commit();
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            working = undefined;
          }),
        ),
      ),
    );
  }

  return { get, set, collect };
}

/**
 * Merges an older page into the loaded list in O(page + loaded): an already loaded message
 * keeps its copy, and the list is sorted only when the concatenation is not in order.
 */
export function mergeOlderPage(
  aliasRoot: (id: string) => string,
  loaded: readonly StoreMessage[],
  page: readonly StoreMessage[],
): StoreMessage[] {
  const known = new Set(loaded.map((message) => aliasRoot(message.id)));
  const merged = [...page.filter((message) => !known.has(aliasRoot(message.id))), ...loaded];
  return isInOrder(merged) ? merged : sortMessages(merged);
}

function isInOrder(messages: readonly StoreMessage[]): boolean {
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const message = messages[index];
    if (previous === undefined || message === undefined) {
      continue;
    }
    const order =
      previous.createdAt.getTime() - message.createdAt.getTime() ||
      previous.id.localeCompare(message.id);
    if (order > 0) {
      return false;
    }
  }
  return true;
}
