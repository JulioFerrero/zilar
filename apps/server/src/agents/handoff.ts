// T-1572: locating the `@<nick>` handoff mention in a group reply, split out of
// `group-turn.ts` so that file stays under the 400-line cap.
// A handoff mention is only offered when the `@<nick>` in the reply text is a
// whole word: the character after the nick must end the text or be
// whitespace / punctuation. Case-insensitive, and offsets are in the final
// wire text (the `@<sender> ` prefix shifted by its length).
import type { HandoffLine } from '@zilar/protocol';

const HANDOFF_BOUNDARY = /[\s.,!?;:'"()[\]{}<>|\u2014\u2013-]/;

export function findHandoffIndex(text: string, nick: string): number | null {
  const needle = `@${nick}`;
  const lowerNeedle = needle.toLowerCase();
  for (let index = 0; index + needle.length <= text.length; index += 1) {
    if (text.slice(index, index + needle.length).toLowerCase() !== lowerNeedle) {
      continue;
    }
    const after = text[index + needle.length];
    if (after === undefined || HANDOFF_BOUNDARY.test(after)) {
      return index;
    }
  }
  return null;
}

const HANDOFF_TASK_MAX = 200;

// T-1572: the server-set handoff marker an AI reply carries when `wire()`
// adds a handoff mention. It mirrors the mentions `wire()` adds: every target
// whose whole-word `@nick` is in the reply is handed to (at most two, like the
// mentions), and the task text is what follows the last such mention, on one
// line. Null when no target's `@nick` is in the reply.
export function buildHandoffLine(input: {
  fromJid: string;
  text: string;
  targets: ReadonlyArray<{ nick: string; jid: string }>;
}): HandoffLine | null {
  const to: string[] = [];
  let lastEnd = -1;
  for (const target of input.targets) {
    const nick = target.nick.trim();
    if (nick === '') {
      continue;
    }
    const index = findHandoffIndex(input.text, nick);
    if (index === null) {
      continue;
    }
    if (to.length < 2) {
      to.push(target.jid.toLowerCase());
    }
    lastEnd = Math.max(lastEnd, index + nick.length + 1);
  }
  if (lastEnd === -1) {
    return null;
  }
  return {
    from: input.fromJid,
    to,
    task: oneLineTask(input.text.slice(lastEnd)),
  };
}

// The reply text after the mention, collapsed to one line, with the leading
// `:`, `,`, `-` and spaces stripped, then cut to 200 characters.
function oneLineTask(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+/, '')
    .trimEnd()
    .slice(0, HANDOFF_TASK_MAX);
}
