/** Length of the longest shared prefix of two strings. */
export function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

// Never cut between the two halves of a surrogate pair (most emoji): a half
// renders as a replacement glyph for a frame.
export function safeCut(text: string, progress: number): number {
  const end = Math.floor(progress);
  const last = text.charCodeAt(end - 1);
  return end > 0 && end < text.length && last >= 0xd800 && last <= 0xdbff ? end + 1 : end;
}
