// The card header a saved tool may return; these helpers read keys safely, `buildBlocksPayload` validates.
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

// `market-prices` reads as `Market prices`.
export function readableToolName(name: string): string {
  const spaced = name.replace(/[-_]/g, ' ').trim();
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Tells the AI whether its card would post, from the same check `tool.run` applies; never throws and never rejects a card.
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
