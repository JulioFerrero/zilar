import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, type Block } from './markdown';

function onlyBlock(text: string): Block {
  const blocks = parseMarkdown(text);
  const block = blocks[0];
  if (blocks.length !== 1 || block === undefined) {
    throw new Error(`expected one block, got ${blocks.length}`);
  }
  return block;
}

describe('parseMarkdown blocks', () => {
  it('parses a paragraph', () => {
    expect(onlyBlock('hello world')).toEqual({
      type: 'paragraph',
      nodes: [{ type: 'text', value: 'hello world' }],
    });
  });

  it('joins soft-wrapped lines into one paragraph', () => {
    expect(onlyBlock('one\ntwo')).toEqual({
      type: 'paragraph',
      nodes: [{ type: 'text', value: 'one two' }],
    });
  });

  it('parses headings 1 through 6 with inline content', () => {
    for (let level = 1; level <= 6; level += 1) {
      const block = onlyBlock(`${'#'.repeat(level)} Title ${level}`);
      expect(block).toEqual({
        type: 'heading',
        level,
        nodes: [{ type: 'text', value: `Title ${level}` }],
      });
    }
    expect(onlyBlock('## a **bold** b')).toEqual({
      type: 'heading',
      level: 2,
      nodes: [
        { type: 'text', value: 'a ' },
        { type: 'bold', value: 'bold' },
        { type: 'text', value: ' b' },
      ],
    });
  });

  it('parses fenced code blocks with ``` and ~~~', () => {
    expect(onlyBlock('```js\nconst x = 1;\n```')).toEqual({
      type: 'code',
      language: 'js',
      value: 'const x = 1;',
    });
    expect(onlyBlock('~~~\nplain *kept*\n~~~')).toEqual({
      type: 'code',
      value: 'plain *kept*',
    });
  });

  it('keeps an unclosed fence as a code block (a growing draft)', () => {
    expect(onlyBlock('```ts\nconst x = 1;')).toEqual({
      type: 'code',
      language: 'ts',
      value: 'const x = 1;',
    });
  });

  it('keeps code content literal', () => {
    expect(onlyBlock('```\n**not bold**\n```')).toEqual({
      type: 'code',
      value: '**not bold**',
    });
  });

  it('parses a blockquote and strips nested markers', () => {
    expect(onlyBlock('> quoted\n>> nested')).toEqual({
      type: 'quote',
      nodes: [{ type: 'text', value: 'quoted nested' }],
    });
  });

  it('parses a bullet list', () => {
    expect(onlyBlock('- one\n- two')).toEqual({
      type: 'list',
      ordered: false,
      items: [
        { marker: '-', nodes: [{ type: 'text', value: 'one' }] },
        { marker: '-', nodes: [{ type: 'text', value: 'two' }] },
      ],
    });
  });

  it('parses a numbered list and keeps the source numbers', () => {
    expect(onlyBlock('3. third\n4) fourth')).toEqual({
      type: 'list',
      ordered: true,
      items: [
        { marker: '3.', nodes: [{ type: 'text', value: 'third' }] },
        { marker: '4)', nodes: [{ type: 'text', value: 'fourth' }] },
      ],
    });
  });

  it('parses a horizontal rule', () => {
    expect(parseMarkdown('a\n\n---\n\nb')).toEqual([
      { type: 'paragraph', nodes: [{ type: 'text', value: 'a' }] },
      { type: 'hr' },
      { type: 'paragraph', nodes: [{ type: 'text', value: 'b' }] },
    ]);
  });

  it('ends a list at an unindented paragraph', () => {
    expect(parseMarkdown('- one\nafter')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [{ marker: '-', nodes: [{ type: 'text', value: 'one' }] }],
      },
      { type: 'paragraph', nodes: [{ type: 'text', value: 'after' }] },
    ]);
  });

  it('nests inline nodes: bold inside a list item, a link inside a quote', () => {
    expect(onlyBlock('- a **bold** item')).toEqual({
      type: 'list',
      ordered: false,
      items: [
        {
          marker: '-',
          nodes: [
            { type: 'text', value: 'a ' },
            { type: 'bold', value: 'bold' },
            { type: 'text', value: ' item' },
          ],
        },
      ],
    });
    expect(onlyBlock('> see [docs](https://x.com)')).toEqual({
      type: 'quote',
      nodes: [
        { type: 'text', value: 'see ' },
        { type: 'link', value: 'docs', href: 'https://x.com' },
      ],
    });
  });
});

describe('parseInline', () => {
  it('parses bold, italic and strike', () => {
    expect(parseInline('plain **bold** *italic* ~~gone~~')).toEqual([
      { type: 'text', value: 'plain ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' ' },
      { type: 'italic', value: 'italic' },
      { type: 'text', value: ' ' },
      { type: 'strike', value: 'gone' },
    ]);
  });

  it('parses underscore emphasis', () => {
    expect(parseInline('__bold__ _italic_')).toEqual([
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' ' },
      { type: 'italic', value: 'italic' },
    ]);
  });

  it('parses inline code with one or more backticks', () => {
    expect(parseInline('use `pnpm test` now')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: 'pnpm test' },
      { type: 'text', value: ' now' },
    ]);
    expect(parseInline('run ``a `b` c``')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'a `b` c' },
    ]);
  });

  it('parses a safe link', () => {
    expect(parseInline('[the docs](https://x.com/a)')).toEqual([
      { type: 'link', value: 'the docs', href: 'https://x.com/a' },
    ]);
    expect(parseInline('[mail](mailto:hi@galena.test)')).toEqual([
      { type: 'link', value: 'mail', href: 'mailto:hi@galena.test' },
    ]);
  });

  it('parses a bare https URL and trims trailing punctuation', () => {
    expect(parseInline('see https://x.com/a now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://x.com/a', href: 'https://x.com/a' },
      { type: 'text', value: ' now' },
    ]);
    expect(parseInline('(https://x.com/a).')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'https://x.com/a', href: 'https://x.com/a' },
      { type: 'text', value: ').' },
    ]);
  });

  it('keeps javascript:, data: and relative links as plain text', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', value: 'click' }]);
    expect(parseInline('[x](data:text/html,<b>hi</b>)')).toEqual([{ type: 'text', value: 'x' }]);
    expect(parseInline('[home](/settings)')).toEqual([{ type: 'text', value: 'home' }]);
    expect(parseInline('[ftp](ftp://x.com/a)')).toEqual([{ type: 'text', value: 'ftp' }]);
  });

  it('renders an image as its alt text', () => {
    expect(parseInline('![a diagram](https://evil.test/s.png)')).toEqual([
      { type: 'text', value: 'a diagram' },
    ]);
  });

  it('keeps raw HTML as plain text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { type: 'text', value: '<script>alert(1)</script>' },
    ]);
  });

  it('leaves unmatched markers and intraword markers alone', () => {
    expect(parseInline('2 * 3')).toEqual([{ type: 'text', value: '2 * 3' }]);
    expect(parseInline('**bold')).toEqual([{ type: 'text', value: '**bold' }]);
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', value: 'snake_case_name' }]);
    expect(parseInline('foo*bar*baz')).toEqual([{ type: 'text', value: 'foo*bar*baz' }]);
  });

  it('parses an empty string to no nodes', () => {
    expect(parseInline('')).toEqual([]);
    expect(parseMarkdown('')).toEqual([]);
  });
});

describe('parseMarkdown safety', () => {
  it('caps work: a 20,001-character input is one plain paragraph', () => {
    const long = 'a'.repeat(20_001);
    const blocks = parseMarkdown(long);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block?.type).toBe('paragraph');
    expect(block?.type === 'paragraph' ? block.nodes : []).toEqual([{ type: 'text', value: long }]);
  });

  it('parses a large but allowed input', () => {
    const blocks = parseMarkdown(`${'# Heading\n\n'}${'x'.repeat(19_000)}`);
    expect(blocks[0]?.type).toBe('heading');
  });

  it('never throws on a half-written draft', () => {
    expect(() => parseMarkdown('**bold\n\n```ts\nconst x = 1;')).not.toThrow();
    expect(() => parseMarkdown('> [a](javascript:\n\n|')).not.toThrow();
  });

  it('never throws on random strings (fuzz)', () => {
    const alphabet = 'ab *#_~`[]()!<>\\\n\t:/https.';
    let seed = 123_456_789;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let iteration = 0; iteration < 500; iteration += 1) {
      let text = '';
      const length = Math.floor(next() * 60);
      for (let index = 0; index < length; index += 1) {
        const position = Math.floor(next() * alphabet.length);
        text += alphabet[position] ?? 'a';
      }
      let blocks: Block[] = [];
      expect(() => {
        blocks = parseMarkdown(text);
        parseInline(text);
      }).not.toThrow();
      expect(Array.isArray(blocks)).toBe(true);
    }
  });
});
