// T-1988: the markup scanners must stay linear. Crafted pages and message
// stanzas used to block the event loop for seconds on inputs that fit under
// the fetch and stanza caps, so every helper and every reader gets a timing
// run on its own pathological shape.

import { describe, expect, it } from 'vitest';
import { parseLinkPreview } from '../link-preview/parse';
import { decodeAgentPayload } from '../notify/ai-cards';
import { textWithoutReplyFallback } from '../push/candidates';
import { parseFeed } from '../web-tools/feed';
import { extractText } from '../web-tools/html';
import { parseDuckDuckGo } from '../web-tools/search';
import { decodeHtmlEntities } from './entities';
import {
  elementBlocks,
  findCloseTag,
  firstElement,
  nextTag,
  openTagAttrs,
  stripComments,
  stripTags,
} from './scan';

const BUDGET_MS = 200;
const MIB = 1024 * 1024;

function repeatTo(value: string, length: number): string {
  return value.repeat(Math.ceil(length / value.length)).slice(0, length);
}

function expectUnderBudget(label: string, run: () => void): void {
  // A single wall-clock sample flakes on this shared machine even though the
  // scanners are linear: JIT warmup, allocations and scheduling noise only ever
  // add time, and can add hundreds of milliseconds to an otherwise fast run.
  // Warm up once, then keep the fastest of five samples: noise cannot make it
  // slower, and a real regression (quadratic or otherwise) still blows past the
  // budget on every sample.
  run();
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  const fastest = Math.min(...samples);
  const detail = samples.map((value) => value.toFixed(0)).join(', ');
  expect(
    fastest,
    `${label} fastest took ${fastest.toFixed(0)} ms (samples: ${detail})`,
  ).toBeLessThan(BUDGET_MS);
}

describe('scan helpers on crafted input', () => {
  const crafted: ReadonlyArray<readonly [string, string]> = [
    ['<', repeatTo('<', 2 * MIB)],
    ['<!--', repeatTo('<!--', 2 * MIB)],
    ['<item>', repeatTo('<item>', 2 * MIB)],
    ['<a>', repeatTo('<a>', 2 * MIB)],
    ['<fallback ', repeatTo('<fallback ', 2 * MIB)],
  ];

  it.each(crafted)('stays under the budget on 2 MiB of %s', (label, input) => {
    const calls: ReadonlyArray<readonly [string, () => void]> = [
      ['stripComments', () => void stripComments(input)],
      ['stripTags', () => void stripTags(input, ' ')],
      ['elementBlocks(item)', () => void elementBlocks(input, 'item', 10)],
      ['elementBlocks(a)', () => void elementBlocks(input, 'a', 10)],
      ['firstElement(item)', () => void firstElement(input, 'item')],
      ['firstElement(a)', () => void firstElement(input, 'a')],
      ['openTagAttrs(item)', () => void openTagAttrs(input, 'item')],
      ['openTagAttrs(a)', () => void openTagAttrs(input, 'a')],
      ['nextTag(a)', () => void nextTag(input, 'a', 0)],
      ['findCloseTag(a)', () => void findCloseTag(input, 'a', 0)],
    ];
    for (const [name, call] of calls) {
      expectUnderBudget(`${label} ${name}`, call);
    }
  });
});

describe('markup readers on crafted input', () => {
  const size = 256 * 1024;

  it('extractText stays under the budget on a run of <', () => {
    const input = repeatTo('<', size);
    expectUnderBudget('extractText', () => void extractText(input));
  });

  it('parseFeed stays under the budget on a run of <item>', () => {
    const input = repeatTo('<item>', size);
    expectUnderBudget('parseFeed', () => void parseFeed(input));
  });

  it('parseLinkPreview stays under the budget on a run of <title>', () => {
    const input = repeatTo('<title>', size);
    expectUnderBudget('parseLinkPreview', () => void parseLinkPreview(input));
  });

  it('parseDuckDuckGo stays under the budget on a run of <a>', () => {
    const input = repeatTo('<a>', size);
    expectUnderBudget('parseDuckDuckGo', () => void parseDuckDuckGo(input));
  });

  it('textWithoutReplyFallback stays under the budget on a run of fallbacks', () => {
    const xml = repeatTo('<fallback for="urn:xmpp:reply:0">', size);
    expectUnderBudget(
      'textWithoutReplyFallback',
      () => void textWithoutReplyFallback('> old', xml),
    );
  });

  it('the AI-card parser stays under the budget on a run of agent tags', () => {
    const xml = repeatTo('<agent xmlns="urn:zilar:agent:0">', size);
    expectUnderBudget('decodeAgentPayload', () => void decodeAgentPayload(xml));
  });
});

describe('scan helpers on normal markup', () => {
  it('replaces comments with one space and drops an unclosed one', () => {
    expect(stripComments('a<!-- x -->b')).toBe('a b');
    expect(stripComments('a<!-- x')).toBe('a');
    expect(stripComments('plain')).toBe('plain');
  });

  it('replaces tags with the replacement', () => {
    expect(stripTags('<p>one</p> <b>two</b>', ' ')).toBe(' one   two ');
    expect(stripTags('no tags')).toBe('no tags');
    expect(stripTags('one < two > three', ' ')).toBe('one   three');
    expect(stripTags('x<a><b>y', ' ')).toBe('x  y');
    expect(stripTags('<a><b>', ' ')).toBe('  ');
    expect(stripTags('keep<a', ' ')).toBe('keep');
  });

  it('reads element blocks case-insensitively, caps them and stops at an unclosed one', () => {
    expect(elementBlocks('<ITEM a="1">one</item><item>two</item>', 'item', 10)).toEqual([
      'one',
      'two',
    ]);
    expect(elementBlocks('<item>1</item><item>2</item>', 'item', 1)).toEqual(['1']);
    expect(elementBlocks('<item>one', 'item', 10)).toEqual([]);
  });

  it('returns the first element with its attributes', () => {
    expect(firstElement('<a href="x">hi</a>', 'a')).toEqual({ attrs: ' href="x"', inner: 'hi' });
    expect(firstElement('no tags', 'a')).toBeNull();
    expect(firstElement('<a>unclosed', 'a')).toBeNull();
  });

  it('reads an open tag attribute text or null', () => {
    expect(openTagAttrs('<meta property="og:title">', 'meta')).toBe(' property="og:title"');
    expect(openTagAttrs('</meta>', 'meta')).toBeNull();
    expect(openTagAttrs('<metadata>', 'meta')).toBeNull();
  });

  it('keeps the reply fallback range working', () => {
    const xml =
      '<message><fallback for="urn:xmpp:reply:0"><body start="2" end="5"/></fallback></message>';
    expect(textWithoutReplyFallback('> old\nmy reply', xml)).toBe('my reply');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric references and keeps unknown ones', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
    expect(decodeHtmlEntities('&bogus;')).toBe('&bogus;');
  });
});
