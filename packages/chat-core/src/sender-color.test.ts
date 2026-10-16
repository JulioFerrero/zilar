import { describe, expect, it } from 'vitest';
import { replyQuoteContent } from './messages';
import { SENDER_COLORS, senderColor } from './sender-color';

describe('senderColor', () => {
  it('gives the same id the same colour', () => {
    expect(senderColor('ana@zilar.test')).toBe(senderColor('ana@zilar.test'));
    expect(senderColor('ai-dev-1@zilar.test')).toBe(senderColor('ai-dev-1@zilar.test'));
  });

  it('picks a colour from the palette for every id', () => {
    const ids = ['ana@zilar.test', 'luis@zilar.test', 'ai-dev-1@zilar.test', '', 'x'];
    for (const id of ids) {
      expect(SENDER_COLORS).toContain(senderColor(id));
    }
  });

  it('does not give every sender the same colour', () => {
    const colours = new Set(
      ['ana@zilar.test', 'luis@zilar.test', 'marta@zilar.test', 'marco@zilar.test'].map(
        senderColor,
      ),
    );
    expect(colours.size).toBeGreaterThan(1);
  });
});

describe('replyQuoteContent', () => {
  it('treats our own wire reply as own without a loaded target', () => {
    const content = replyQuoteContent({ id: 'm1', senderName: 'You', text: 'hi' }, undefined, 'me');
    expect(content?.own).toBe(true);
    expect(content?.senderName).toBe('You');
  });

  it('still falls back to Message for an unknown sender without a loaded target', () => {
    const content = replyQuoteContent({ id: 'm2', senderName: '', text: 'hi' }, undefined, 'me');
    expect(content?.own).toBe(false);
    expect(content?.senderName).toBe('Message');
  });
});
