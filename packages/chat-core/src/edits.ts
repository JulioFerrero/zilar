/**
 * Pure reducer for XEP-0308 corrections and XEP-0424 retractions.
 *
 * It is target-keyed like the reactions reducer: the store canonicalises every
 * target through its alias map before calling in, and updates that arrive
 * before their target message is loaded stay pending until the target shows up.
 */
import type { UiMessage } from './types';

/** Sender-side edit window: only messages sent within this long can be edited. */
export const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * The sender-side edit limit: only my own text messages, within 48 hours.
 * Voice messages, images and cards cannot be edited.
 */
export function canEditMessage(message: UiMessage, currentUserId: string, now: Date): boolean {
  return (
    message.senderId === currentUserId &&
    message.deleted !== true &&
    message.text !== undefined &&
    message.voice === undefined &&
    message.image === undefined &&
    message.card === undefined &&
    now.getTime() - message.createdAt.getTime() <= EDIT_WINDOW_MS
  );
}

/** The sender-side delete limit: my own messages of any kind, no time limit. */
export function canDeleteMessage(message: UiMessage, currentUserId: string): boolean {
  return message.senderId === currentUserId && message.deleted !== true;
}

/** The author identity of a message, as far as it is known. */
export interface EditAuthor {
  /** Real bare JID when resolved, else the occupant JID. */
  jid: string;
  /** True when `jid` is a real bare JID. */
  resolved: boolean;
  occupantId?: string;
  /** MUC nickname, when the message came from a room. */
  nick?: string;
}

/** One XEP-0372 mention carried by a correction. UTF-16 offsets into the text. */
export interface EditMention {
  jid: string;
  begin?: number;
  end?: number;
}

export interface CorrectionUpdate {
  kind: 'correction';
  /** Alias-resolved target message id. */
  targetId: string;
  author: EditAuthor;
  /** The new full text. */
  text: string;
  /** Stanza order: a larger value is newer and wins. */
  order: number;
  mentions?: EditMention[];
}

export interface RetractionUpdate {
  kind: 'retraction';
  targetId: string;
  author: EditAuthor;
  order: number;
}

export type EditUpdate = CorrectionUpdate | RetractionUpdate;

export interface CorrectionEntry {
  text: string;
  order: number;
  mentions?: EditMention[];
}

export interface TargetEdits {
  /** The original message's author, once its message has been seen. */
  author?: EditAuthor;
  /** The latest authorized correction. */
  correction?: CorrectionEntry;
  /** A retraction; it wins over everything, including later corrections. */
  retraction?: { order: number };
  /** Updates that arrived before the target message was loaded. */
  pending: EditUpdate[];
}

export interface EditsState {
  targets: Record<string, TargetEdits>;
}

/** The edit state of one message, ready to apply to its `UiMessage`. */
export interface MessageEdits {
  edited: boolean;
  deleted: boolean;
  /** The corrected text, when `edited` is true. */
  text?: string;
  mentions?: EditMention[];
}

export function emptyEdits(): EditsState {
  return { targets: {} };
}

/**
 * The spec's authorization check: a correction or retraction counts only when
 * it comes from the original sender. A DM compares the bare JID; a group
 * compares the real JID when both sides are resolved, else the occupant-id,
 * else the nick.
 */
export function isSameAuthor(original: EditAuthor, update: EditAuthor): boolean {
  if (original.resolved && update.resolved) {
    return original.jid === update.jid;
  }
  if (original.occupantId !== undefined && update.occupantId !== undefined) {
    return original.occupantId === update.occupantId;
  }
  if (
    original.nick !== undefined &&
    original.nick !== '' &&
    update.nick !== undefined &&
    update.nick !== ''
  ) {
    return original.nick === update.nick;
  }
  return false;
}

function sameUpdate(left: EditUpdate, right: EditUpdate): boolean {
  if (
    left.kind !== right.kind ||
    left.order !== right.order ||
    left.author.jid !== right.author.jid
  ) {
    return false;
  }
  if (left.kind === 'correction' && right.kind === 'correction') {
    return left.text === right.text;
  }
  return true;
}

function withTarget(state: EditsState, targetId: string, entry: TargetEdits): EditsState {
  return { targets: { ...state.targets, [targetId]: entry } };
}

/**
 * Applies one correction or retraction. Without a known target author the
 * update is kept pending; with one, an update from any other author is ignored
 * and a retraction wins for good (later corrections and reactions never bring
 * the message back). The latest correction in stanza order wins.
 */
export function applyEdit(state: EditsState, update: EditUpdate, target?: EditAuthor): EditsState {
  const existing = state.targets[update.targetId];
  if (existing?.retraction !== undefined) {
    return state;
  }

  if (target === undefined) {
    const entry = existing ?? { pending: [] };
    if (entry.pending.some((item) => sameUpdate(item, update))) {
      return state;
    }
    return withTarget(state, update.targetId, { ...entry, pending: [...entry.pending, update] });
  }

  if (!isSameAuthor(target, update.author)) {
    return state;
  }

  const entry = existing ?? { pending: [] };
  if (update.kind === 'retraction') {
    return withTarget(state, update.targetId, {
      ...entry,
      author: target,
      retraction: { order: update.order },
    });
  }

  if (entry.correction !== undefined && update.order < entry.correction.order) {
    return withTarget(state, update.targetId, { ...entry, author: target });
  }
  const correction: CorrectionEntry = { text: update.text, order: update.order };
  if (update.mentions !== undefined) correction.mentions = update.mentions;
  return withTarget(state, update.targetId, { ...entry, author: target, correction });
}

/**
 * Learns the target's author and applies its pending updates in stanza order.
 * Called once the target message shows up in the store, so a correction read
 * from an older history page is not lost.
 */
export function resolveEdits(state: EditsState, targetId: string, target: EditAuthor): EditsState {
  const entry = state.targets[targetId];
  if (entry === undefined) {
    return state;
  }
  if (entry.pending.length === 0 && entry.author !== undefined) {
    return state;
  }
  let next = withTarget(state, targetId, { ...entry, author: target, pending: [] });
  const ordered = [...entry.pending].sort((left, right) => left.order - right.order);
  for (const update of ordered) {
    next = applyEdit(next, update, target);
  }
  return next;
}

/** The edit state of one target message. */
export function editsFor(state: EditsState, targetId: string): MessageEdits {
  const entry = state.targets[targetId];
  if (entry === undefined) {
    return { edited: false, deleted: false };
  }
  if (entry.retraction !== undefined) {
    return { edited: false, deleted: true };
  }
  const correction = entry.correction;
  if (correction === undefined) {
    return { edited: false, deleted: false };
  }
  const result: MessageEdits = { edited: true, deleted: false, text: correction.text };
  if (correction.mentions !== undefined) {
    result.mentions = correction.mentions;
  }
  return result;
}

function newerCorrection(
  left: CorrectionEntry | undefined,
  right: CorrectionEntry | undefined,
): CorrectionEntry | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return right.order > left.order ? right : left;
}

/**
 * Moves every entry stored under `from` onto `to`. Used when two message ids
 * turn out to be the same message (the optimistic local id and the server id).
 */
export function mergeEdits(state: EditsState, from: string, to: string): EditsState {
  if (from === to) return state;
  const source = state.targets[from];
  if (source === undefined) return state;

  const existing = state.targets[to];
  const merged: TargetEdits = { pending: [...(existing?.pending ?? []), ...source.pending] };
  const author = existing?.author ?? source.author;
  if (author !== undefined) merged.author = author;
  const retraction = source.retraction ?? existing?.retraction;
  if (retraction !== undefined) merged.retraction = retraction;
  const correction = newerCorrection(existing?.correction, source.correction);
  if (correction !== undefined) merged.correction = correction;

  const targets = { ...state.targets, [to]: merged };
  delete targets[from];
  return { targets };
}
