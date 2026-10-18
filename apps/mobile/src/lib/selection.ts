export function toggleSelected(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/** The selected messages in chat order, whatever order they were picked in. */
export function selectedInOrder<T extends { id: string }>(
  messages: readonly T[],
  ids: readonly string[],
): T[] {
  const selected = new Set(ids);
  return messages.filter((message) => selected.has(message.id));
}
