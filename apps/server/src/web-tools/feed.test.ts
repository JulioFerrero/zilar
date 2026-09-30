// T-0125: feed reader tests. RSS and Atom samples parse; DTDs and
// entities are rejected; item counts and snippet lengths are capped.
import { describe, expect, it } from 'vitest';
import { MAX_SNIPPET_CHARS, parseFeed } from './feed';

const RSS = [
  '<?xml version="1.0"?>',
  '<rss version="2.0"><channel><title>Example</title>',
  '<item><title>First</title><link>https://example.com/1</link>',
  '<pubDate>Mon, 29 Sep 2026 08:00:00 GMT</pubDate>',
  '<description><![CDATA[<p>Hello <b>world</b> &amp; friends</p>]]></description></item>',
  '<item><title>Second</title><link>https://example.com/2</link>',
  '<description>Plain text</description></item>',
  '</channel></rss>',
].join('');

const ATOM = [
  '<?xml version="1.0"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title>',
  '<entry><title>Atom one</title><link href="https://example.com/a1"/>',
  '<updated>2026-09-29T08:00:00Z</updated>',
  '<summary>Summary text</summary></entry>',
  '<entry><title>Atom two</title><link>https://example.com/a2</link>',
  '<published>2026-09-28T08:00:00Z</published>',
  '<content>Content text</content></entry>',
  '</feed>',
].join('');

describe('parseFeed (T-0125)', () => {
  it('reads RSS items with title, link, date and snippet', () => {
    const parsed = parseFeed(RSS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toEqual({
      title: 'First',
      link: 'https://example.com/1',
      date: 'Mon, 29 Sep 2026 08:00:00 GMT',
      snippet: 'Hello world & friends',
    });
    expect(parsed.items[1]).toMatchObject({ title: 'Second', snippet: 'Plain text' });
  });

  it('reads Atom entries with href links', () => {
    const parsed = parseFeed(ATOM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      title: 'Atom one',
      link: 'https://example.com/a1',
      date: '2026-09-29T08:00:00Z',
      snippet: 'Summary text',
    });
    expect(parsed.items[1]).toMatchObject({
      title: 'Atom two',
      link: 'https://example.com/a2',
      snippet: 'Content text',
    });
  });

  it('rejects DTDs and entities', () => {
    for (const body of [
      '<!DOCTYPE rss><rss><channel></channel></rss>',
      '<rss><channel><item><title>x</title><!ENTITY x "y"></item></channel></rss>',
    ]) {
      const parsed = parseFeed(body);
      expect(parsed).toEqual({ ok: false, summary: 'feed with DTD or entities is not allowed' });
    }
  });

  it('caps items at 20 and snippets at 300 chars', () => {
    const items = Array.from(
      { length: 25 },
      (_, index) =>
        `<item><title>Item ${index}</title><description>${'s'.repeat(500)}</description></item>`,
    ).join('');
    const parsed = parseFeed(`<rss><channel>${items}</channel></rss>`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.items).toHaveLength(20);
    for (const item of parsed.items) {
      expect(item.snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS + 1);
    }
    expect(parsed.items[0]?.snippet).toBe(`${'s'.repeat(MAX_SNIPPET_CHARS)}…`);
  });

  it('reports an empty feed plainly', () => {
    expect(parseFeed('<rss><channel></channel></rss>')).toEqual({
      ok: false,
      summary: 'no feed items found',
    });
  });
});
