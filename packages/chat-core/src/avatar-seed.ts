// Avatar seed helper (T-1334): the no-picture orb's colour and light come from
// the person's, AI's or group's name, so the same name draws the same ball on
// every screen. `avatarSvg` normalizes its seed (bare, lowercased), so
// `nameSeed` only folds case and whitespace.

/**
 * Replaces a lone surrogate (a corrupt import, a hostile peer) with U+FFFD.
 * `Array.from` yields a valid pair as one two-unit string and a lone surrogate
 * as one, so `length === 1` in the surrogate range means there is no pair.
 * `String.prototype.normalize` throws on lone surrogates, so this runs first.
 */
function wellFormed(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : character;
  }).join('');
}

/**
 * A name's orb seed: Unicode NFC, trimmed, inner whitespace collapsed to one
 * space and lowercased, so `'  Ana  María '` and `'ana maría'` draw the same
 * ball. An empty name returns `''`; the caller then falls back to the id.
 */
export function nameSeed(name: string): string {
  return wellFormed(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
