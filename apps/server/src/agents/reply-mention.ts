// T-1625: a group reply is wired as `@<asker> ` plus the model's text. When the
// model's text already starts with `@<asker>` (live "ai test › General" showed
// `@Claude Test @Claude Test …`), drop the model's copy so the reply has exactly
// one leading mention. Case-insensitive, and repeated copies are all dropped.
// If stripping would leave nothing, the input is returned unchanged so a reply
// of just `@<asker>` is never emptied.
//
// T-1625 finding 1: `@<nick>` only counts when the nick ends at a word
// boundary, the same rule `findHandoffIndex` uses for handoff mentions.
// Without it a name that is a prefix of another word gets eaten: asker `Al`
// turned the model's `@Alice, can you review?` into `@Al ice, can you review?`.
const MENTION_BOUNDARY = /[\s.,!?;:'"()[\]{}<>|\u2014\u2013-]/;

export function stripLeadingMention(text: string, name: string): string {
  const nick = name.trim();
  if (nick === '') {
    return text;
  }
  const pattern = new RegExp(
    `^@${escapeRegExp(nick)}(?=$|${MENTION_BOUNDARY.source})\\s*[,:]?\\s*`,
    'i',
  );
  let rest = text;
  for (;;) {
    const next = rest.replace(pattern, '');
    if (next === rest || next === '') {
      break;
    }
    rest = next;
  }
  return rest === '' ? text : rest;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
