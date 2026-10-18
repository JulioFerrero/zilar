// Seven colours, all readable on the dark incoming bubble (contrast ≥ 4.5:1); the pick is a stable hash of the bare JID, so a sender keeps one colour.
export const SENDER_COLORS = [
  '#e17076',
  '#faa774',
  '#a695e7',
  '#7bc862',
  '#6ec9cb',
  '#65aadd',
  '#ee7aae',
] as const;

export function senderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SENDER_COLORS[(hash >>> 0) % SENDER_COLORS.length] ?? SENDER_COLORS[0];
}
