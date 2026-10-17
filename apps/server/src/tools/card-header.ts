// T-1766: the card header a saved tool may return, and the readable-name
// fallback for `tool.run`. A tool's `card` is passed through unchecked like
// `blocks`; only `buildBlocksPayload` validates it, so these helpers never
// reject a shape, they only read its keys safely.
import type { Block } from '@zilar/protocol';
import { buildBlocksPayload } from '../message-blocks/build';
import { CARD_KINDS } from '../message-blocks/guide';

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

// T-1768: after a saved tool's test run, tell the AI whether its card would
// post. This reads the tool output exactly as `tool.run` does, so the AI learns
// from the same answer. It never throws and it never rejects a card itself:
// `buildBlocksPayload` owns the shape, and `CARD_KINDS` owns what the apps draw.
export function describeToolCard(
  output: { text: string; blocks?: unknown; card?: unknown },
  toolName: string,
): string | null {
  const { blocks } = output;
  if (blocks === undefined) {
    return null;
  }
  const undrawn = firstUndrawnKind(blocks);
  if (undrawn !== null) {
    return `card: ${undrawn} is not drawn by the apps yet`;
  }
  const card = cardHeader(output.card);
  const built = buildBlocksPayload(
    {
      title: card.title ?? readableToolName(toolName),
      icon: card.icon,
      meta: card.meta,
      blocks,
    },
    output.text,
  );
  if (!built.ok) {
    return `card invalid: ${built.reason}`;
  }
  const payload = built.payload;
  if (payload.type !== 'blocks') {
    return null;
  }
  const kinds = payload.data.blocks.map((block) => block.kind);
  return `card ok: ${kinds.length} blocks (${kinds.join(', ')})`;
}

function firstUndrawnKind(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) {
    return null;
  }
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) {
      continue;
    }
    const kind = (block as { kind?: unknown }).kind;
    if (typeof kind === 'string' && !CARD_KINDS.includes(kind as Block['kind'])) {
      return kind;
    }
  }
  return null;
}
