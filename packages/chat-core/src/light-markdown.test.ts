import { describe, expect, it } from 'vitest';
import { parseLightInline, splitCodeBlocks } from './light-markdown';

describe('parseLightInline', () => {
  it('parses bold, italics and code while leaving literals alone', () => {
    const segments = parseLightInline('a **b** _c_ `d` snake_case 2 * 3');
    expect(segments).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' snake_case 2 * 3' },
    ]);
  });
});

describe('splitCodeBlocks', () => {
  it('returns a closed fence as code and an unclosed one as text', () => {
    const text = 'hello\n```ts\nconst a = 1;\n```\nworld\n```\nrest';
    const blocks = splitCodeBlocks(text);
    expect(blocks).toEqual([
      { kind: 'text', text: 'hello\n', start: 0 },
      { kind: 'code', text: 'const a = 1;', start: 6 },
      { kind: 'text', text: 'world\n```\nrest', start: 29 },
    ]);
  });
});
