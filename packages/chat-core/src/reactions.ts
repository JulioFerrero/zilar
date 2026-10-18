export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

// XEP-0444: a reactor may hold at most this many distinct reactions.
export const MAX_REACTIONS_PER_MESSAGE = 6;

export interface ReactionEntry {
  emojis: string[];
  order: number;
}

export interface ReactionsState {
  targets: Record<string, Record<string, ReactionEntry>>;
}

export interface ReactionUpdate {
  targetId: string;
  reactorJid: string;
  emojis: string[];
  order: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  reactors: string[];
}

export function emptyReactions(): ReactionsState {
  return { targets: {} };
}

function cleanedSet(emojis: readonly string[]): string[] {
  const result: string[] = [];
  for (const emoji of emojis) {
    if (result.length >= MAX_REACTIONS_PER_MESSAGE) break;
    if (emoji === '' || result.includes(emoji)) continue;
    result.push(emoji);
  }
  return result;
}

// The latest order per (target, reactor) wins; an equal order replaces the previous one (last applied wins). An empty set clears the reactor's reactions.
export function applyReaction(state: ReactionsState, update: ReactionUpdate): ReactionsState {
  const existing = state.targets[update.targetId]?.[update.reactorJid];
  if (existing !== undefined && update.order < existing.order) {
    return state;
  }
  return {
    targets: {
      ...state.targets,
      [update.targetId]: {
        ...state.targets[update.targetId],
        [update.reactorJid]: { emojis: cleanedSet(update.emojis), order: update.order },
      },
    },
  };
}

// Each emoji is ranked by the earliest (order, position in the set) at which a reactor used it; `mine` marks a reaction of `meJid`.
export function summarize(
  state: ReactionsState,
  targetId: string,
  meJid: string,
): ReactionSummary[] {
  const byReactor = state.targets[targetId];
  if (byReactor === undefined) return [];

  const buckets = new Map<
    string,
    { count: number; mine: boolean; reactors: string[]; rank: [number, number] }
  >();
  for (const [reactorJid, entry] of Object.entries(byReactor)) {
    entry.emojis.forEach((emoji, index) => {
      let bucket = buckets.get(emoji);
      if (bucket === undefined) {
        bucket = { count: 0, mine: false, reactors: [], rank: [entry.order, index] };
        buckets.set(emoji, bucket);
      }
      bucket.count += 1;
      bucket.mine = bucket.mine || reactorJid === meJid;
      bucket.reactors.push(reactorJid);
      if (entry.order < bucket.rank[0]) {
        bucket.rank = [entry.order, index];
      }
    });
  }

  return [...buckets.entries()]
    .sort((left, right) => left[1].rank[0] - right[1].rank[0] || left[1].rank[1] - right[1].rank[1])
    .map(([emoji, bucket]) => ({
      emoji,
      count: bucket.count,
      mine: bucket.mine,
      reactors: bucket.reactors,
    }));
}

// Used when two message ids turn out to be the same message (the optimistic local id and the server id).
export function mergeTargets(state: ReactionsState, from: string, to: string): ReactionsState {
  if (from === to) return state;
  const source = state.targets[from];
  if (source === undefined) return state;

  const merged = { ...state.targets[to] };
  for (const [reactorJid, entry] of Object.entries(source)) {
    const existing = merged[reactorJid];
    if (existing === undefined || entry.order >= existing.order) {
      merged[reactorJid] = entry;
    }
  }
  const targets = { ...state.targets, [to]: merged };
  delete targets[from];
  return { targets };
}
