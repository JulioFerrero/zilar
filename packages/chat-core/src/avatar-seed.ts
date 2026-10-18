// `Array.from` yields a valid pair as one string, so `length === 1` in the surrogate range means there is no pair;
// `String.prototype.normalize` throws on lone surrogates, so this runs first.
function wellFormed(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : character;
  }).join('');
}

// A name's orb seed: NFC, trimmed, inner whitespace collapsed and lowercased, so `'  Ana  María '` and `'ana maría'` draw the same ball.
export function nameSeed(name: string): string {
  return wellFormed(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
