/** The 7 avatar gradients from docs/design/ui-style.md §2. */
export const AVATAR_GRADIENTS = [
  ['#ff885e', '#ff516a'],
  ['#ffcd6a', '#ffa85c'],
  ['#82b1ff', '#665fff'],
  ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'],
  ['#72d5fd', '#2a9ef1'],
  ['#e0a2f3', '#d669ed'],
] as const;

export type AvatarGradient = (typeof AVATAR_GRADIENTS)[number];

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return result;
}

/** Deterministic gradient for a chat or user id. */
export function avatarGradient(id: string): AvatarGradient {
  return AVATAR_GRADIENTS[hash(id) % AVATAR_GRADIENTS.length];
}

/** The solid color used for a sender's name in group messages. */
export function senderColor(id: string): string {
  return avatarGradient(id)[0];
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Up to 2 letters, from the first letters of the first two words. */
export function initials(name: string): string {
  const letters: string[] = [];
  for (const word of name.trim().split(/\s+/).filter(Boolean)) {
    const first = Array.from(word)[0];
    if (first && LETTER_OR_DIGIT.test(first)) {
      letters.push(first.toUpperCase());
    }
    if (letters.length === 2) {
      break;
    }
  }
  if (letters.length > 0) {
    return letters.join('');
  }
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '';
}
