// T-0481: locating the `@<nick>` handoff mention in a group reply, split out of
// `group-turn.ts` so that file stays under the 400-line cap.
// A handoff mention is only offered when the `@<nick>` in the reply text is a
// whole word: the character after the nick must end the text or be
// whitespace / punctuation. Case-insensitive, and offsets are in the final
// wire text (the `@<sender> ` prefix shifted by its length).
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
