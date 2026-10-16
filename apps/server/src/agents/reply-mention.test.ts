import { describe, expect, it } from 'vitest';
import { stripLeadingMention } from './reply-mention';

describe('stripLeadingMention (T-1625)', () => {
  it('removes a leading @name echoed by the model', () => {
    expect(stripLeadingMention('@Claude Test Here are', 'Claude Test')).toBe('Here are');
  });

  it('matches case-insensitively and takes the comma or colon', () => {
    expect(stripLeadingMention('@claude test, hi', 'Claude Test')).toBe('hi');
    expect(stripLeadingMention('@Claude Test: hi', 'Claude Test')).toBe('hi');
  });

  it('drops repeated leading mentions', () => {
    expect(stripLeadingMention('@Claude Test @Claude Test Here are', 'Claude Test')).toBe(
      'Here are',
    );
  });

  it('leaves a mention that is not leading unchanged', () => {
    expect(stripLeadingMention('Hi @Claude Test', 'Claude Test')).toBe('Hi @Claude Test');
  });

  it('never empties a reply that is only the mention', () => {
    expect(stripLeadingMention('@Claude Test', 'Claude Test')).toBe('@Claude Test');
  });

  it('leaves the text unchanged without a name', () => {
    expect(stripLeadingMention('@Claude Test here', '')).toBe('@Claude Test here');
  });

  it('does not eat a longer name that starts with the asker name', () => {
    expect(stripLeadingMention('@Alice, can you review?', 'Al')).toBe('@Alice, can you review?');
    expect(stripLeadingMention('@Claude Testing shows X', 'Claude Test')).toBe(
      '@Claude Testing shows X',
    );
  });
});
