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
