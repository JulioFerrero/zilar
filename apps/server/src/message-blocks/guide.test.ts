import { describe, expect, it } from 'vitest';
import { BlockSchema } from '@zilar/protocol';
import { CARD_KINDS, CARD_RULES, CARD_SHAPES, cardGuide } from './guide';

// T-1768: the guide names the kinds the apps draw and gives each one's exact
// fields. If a kind leaves the protocol union, or a shape line is dropped, the
// AI would be told about a card that cannot be built or drawn.
describe('card guide', () => {
  // `BlockSchema` is a union of the per-kind structs; each member's `kind` is a
  // mutable-key wrapper around a `Schema.Literal`, so the inner literal is the
  // kind the protocol accepts.
  const members = BlockSchema.members as unknown as ReadonlyArray<{
    fields: { kind: { schema: { literal: string } } };
  }>;
  const literalKinds = members.map((member) => member.fields.kind.schema.literal);

  it('every guide kind is a protocol kind and has a shape line', () => {
    for (const kind of CARD_KINDS) {
      expect(literalKinds).toContain(kind);
      expect(CARD_SHAPES).toContain(`kind=${kind} `);
    }
  });

  it('returns the rules followed by the shapes', () => {
    expect(cardGuide()).toBe(CARD_RULES + '\n' + CARD_SHAPES);
  });
});
