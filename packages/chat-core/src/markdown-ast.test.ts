import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_INPUT_LIMIT,
  parseMessageMarkdown,
  type MdBlock,
  type MdInline,
} from './markdown-ast';

function collectInlines(blocks: MdBlock[]): MdInline[] {
  const out: MdInline[] = [];
  const walkInline = (nodes: MdInline[]): void => {
    for (const node of nodes) {
      out.push(node);
      if ('children' in node) {
        walkInline(node.children);
      }
    }
  };
  const walkBlock = (block: MdBlock): void => {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        walkInline(block.children);
        break;
      case 'quote':
        block.children.forEach(walkBlock);
        break;
      case 'list':
        block.items.forEach((item) => item.children.forEach(walkBlock));
        break;
      case 'table':
        block.rows.forEach((row) => row.forEach(walkInline));
        break;
      case 'code':
      case 'hr':
        break;
    }
  };
  blocks.forEach(walkBlock);
  return out;
}

function links(blocks: MdBlock[]): Extract<MdInline, { type: 'link' }>[] {
  return collectInlines(blocks).filter(
    (node): node is Extract<MdInline, { type: 'link' }> => node.type === 'link',
  );
}

describe('parseMessageMarkdown safety', () => {
  it('drops a javascript: link and keeps its label as text', () => {
    const blocks = parseMessageMarkdown('[x](javascript:alert(1))');
    expect(links(blocks)).toEqual([]);
    expect(collectInlines(blocks)).toEqual([{ type: 'text', value: 'x' }]);
  });

  it('passes https: and mailto: links', () => {
    const blocks = parseMessageMarkdown('[web](https://example.test/a) [mail](mailto:a@b.test)');
    expect(links(blocks).map((link) => link.href)).toEqual([
      'https://example.test/a',
      'mailto:a@b.test',
    ]);
  });

  it('drops raw HTML', () => {
    const blocks = parseMessageMarkdown('<b>hi</b>');
    expect(collectInlines(blocks)).toEqual([{ type: 'text', value: 'hi' }]);
    expect(blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'hi' }] }]);
  });

  it('renders an image as its alt text', () => {
    const blocks = parseMessageMarkdown('![alt](https://example.test/i.png)');
    expect(blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'alt' }] }]);
  });

  it('turns GFM autolinks into safe links', () => {
    const blocks = parseMessageMarkdown('www.example.test and a@b.test');
    expect(links(blocks).map((link) => link.href)).toEqual([
      'http://www.example.test',
      'mailto:a@b.test',
    ]);
  });
});

describe('parseMessageMarkdown blocks', () => {
  it('keeps a nested list nested', () => {
    const [first] = parseMessageMarkdown('- a\n  - b');
    if (first?.type !== 'list') {
      throw new Error('expected a list');
    }
    const children = first.items[0]?.children ?? [];
    expect(children[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'a' }] });
    const nested = children[1];
    expect(nested?.type).toBe('list');
    if (nested?.type !== 'list') {
      throw new Error('expected a nested list');
    }
    expect(nested.items[0]?.children).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'b' }] },
    ]);
  });

  it('reads a GFM task list item', () => {
    const [first] = parseMessageMarkdown('- [x] done');
    if (first?.type !== 'list') {
      throw new Error('expected a list');
    }
    expect(first.items[0]?.checked).toBe(true);
  });

  it('parses a GFM table with its rows and alignment', () => {
    const [first] = parseMessageMarkdown('| a | b |\n| --- | :-: |\n| 1 | 2 |');
    if (first?.type !== 'table') {
      throw new Error('expected a table');
    }
    expect(first.align).toEqual([null, 'center']);
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0]?.[0]).toEqual([{ type: 'text', value: 'a' }]);
    expect(first.rows[1]?.[1]).toEqual([{ type: 'text', value: '2' }]);
  });

  it('turns an unclosed fence into a code block', () => {
    const [first] = parseMessageMarkdown('```js\nconst a = 1;');
    expect(first).toEqual({ type: 'code', lang: 'js', value: 'const a = 1;' });
  });

  it('caps long input without throwing', () => {
    const blocks = parseMessageMarkdown('a'.repeat(30000));
    const [first] = blocks;
    if (first?.type !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    const [text] = first.children;
    expect(text?.type === 'text' ? text.value.length : 0).toBe(MARKDOWN_INPUT_LIMIT);
  });
});
