import type { ChatMessage } from '@zilar/xmpp-core';

// Later corrections win, so the newest body is the one applied.
function correctedBodies(history: ChatMessage[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const message of history) {
    const target = message.correction?.targetId;
    if (target !== undefined && typeof message.body === 'string') {
      bodies.set(target, message.body);
    }
  }
  return bodies;
}

// Every id a correction names, even one that carries no usable body: such a
// target must lose its pre-edit text rather than keep it.
function correctionTargets(history: ChatMessage[]): Set<string> {
  const targets = new Set<string>();
  for (const message of history) {
    const target = message.correction?.targetId;
    if (target !== undefined) {
      targets.add(target);
    }
  }
  return targets;
}

// Collects every retraction target id, in both shapes: the origin id in DMs and
// the stanza-id in groups.
function retractedIds(history: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of history) {
    const target = message.retraction?.targetId;
    if (target !== undefined) {
      ids.add(target);
    }
  }
  return ids;
}

// Resolves a message against an id map, trying its origin id first and its
// archive id second: a correction names the origin id, while a retraction may
// name either.
function lookup<T>(map: Map<string, T>, message: ChatMessage): T | undefined {
  if (message.originId !== undefined) {
    const byOrigin = map.get(message.originId);
    if (byOrigin !== undefined) {
      return byOrigin;
    }
  }
  return map.get(message.id);
}

function isTarget(targets: Set<string>, message: ChatMessage): boolean {
  return (
    targets.has(message.id) || (message.originId !== undefined && targets.has(message.originId))
  );
}

// Applies the archive's edits to a history before it becomes AI context:
// corrections replace or retract their target, and neither they nor the AI's
// own progress lines appear as turns. Pure and order-preserving.
export function applyEdits(history: ChatMessage[]): ChatMessage[] {
  const corrections = correctedBodies(history);
  const corrected = correctionTargets(history);
  const retracted = retractedIds(history);
  const kept: ChatMessage[] = [];
  for (const message of history) {
    if (
      message.correction !== undefined ||
      message.retraction !== undefined ||
      message.payload?.type === 'progress' ||
      isTarget(retracted, message)
    ) {
      continue;
    }
    if (isTarget(corrected, message)) {
      const body = lookup(corrections, message);
      if (body === undefined) {
        continue;
      }
      kept.push({ ...message, body });
      continue;
    }
    kept.push(message);
  }
  return kept;
}
