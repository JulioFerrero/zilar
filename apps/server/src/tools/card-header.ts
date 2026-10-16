// T-1766: the card header a saved tool may return, and the readable-name
// fallback for `tool.run`. A tool's `card` is passed through unchecked like
// `blocks`; only `buildBlocksPayload` validates it, so these helpers never
// reject a shape, they only read its keys safely.
export interface ToolCardHeader {
  title?: unknown;
  icon?: unknown;
  meta?: unknown;
}

export function cardHeader(card: unknown): ToolCardHeader {
  if (typeof card !== 'object' || card === null) {
    return {};
  }
  const record = card as Record<string, unknown>;
  return { title: record.title, icon: record.icon, meta: record.meta };
}

// `market-prices` reads as `Market prices`: hyphens and underscores become
// spaces and the first letter is upper case.
export function readableToolName(name: string): string {
  const spaced = name.replace(/[-_]/g, ' ').trim();
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
