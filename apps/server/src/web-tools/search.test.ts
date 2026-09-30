// T-0125: search parser tests. A recorded-shape DuckDuckGo result
// page parses; a captcha/blocked page and an empty page give no
// results (the adapter turns that into `search unavailable right
// now`); redirect-wrapped links are unwrapped to the target URL.
import { describe, expect, it } from 'vitest';
import { parseDuckDuckGo, unwrapDuckDuckGo } from './search';

// The fixture uses neutral container classes: the live DuckDuckGo page
// wraps results in `.results` containers whose names collide with the
// `result` token, so the fixture must not reuse them.
// `.result__snippet` anchors are the live shape and stay.

function resultBlock(title: string, href: string, snippet: string): string {
  return [
    '<div class="result results_links results_links_deep web-result ">',
    '<div class="links_main links_deep result__body">',
    `<h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2>`,
    snippet.length > 0 ? `<a class="result__snippet" href="${href}">${snippet}</a>` : '',
    '</div></div>',
  ].join('');
}

const RECORDED_PAGE = [
  '<html><body><div class="search-results"><div id="links" class="output">',
  resultBlock(
    'Speedtest by Ookla - The Global Broadband Speed Test',
    '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.speedtest.net%2F&amp;rut=9378e4321',
    '<b>Test</b> your internet speed on any device.',
  ),
  resultBlock(
    'Fast.com',
    '//duckduckgo.com/l/?uddg=https%3A%2F%2Ffast.com%2F&amp;rut=d2e3e4c2',
    'How fast is your download speed?',
  ),
  '</div></div></body></html>',
].join('');

describe('parseDuckDuckGo (T-0125)', () => {
  it('parses a recorded-shape result page', () => {
    const results = parseDuckDuckGo(RECORDED_PAGE);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Speedtest by Ookla - The Global Broadband Speed Test',
      url: 'https://www.speedtest.net/',
      snippet: 'Test your internet speed on any device.',
    });
    expect(results[1]).toMatchObject({ url: 'https://fast.com/' });
  });

  it('returns no results for a block page, a challenge or an empty page', () => {
    expect(
      parseDuckDuckGo('<html><body><div class="anomaly-modal">anomaly</div></body></html>'),
    ).toEqual([]);
    expect(parseDuckDuckGo('<form id="challenge-form"><input name="captcha"/></form>')).toEqual([]);
    expect(
      parseDuckDuckGo('<html><body><div class="results">no results</div></body></html>'),
    ).toEqual([]);
    expect(parseDuckDuckGo('')).toEqual([]);
  });

  it('skips results without an unwrappable http(s) URL', () => {
    const page = [
      '<div class="result"><h2 class="result__title">',
      '<a class="result__a" href="javascript:evil()">Bad</a></h2></div>',
      resultBlock('Good', 'https://example.com/good', 'snippet'),
    ].join('');
    const results = parseDuckDuckGo(page);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com/good');
  });

  it('caps results at 8', () => {
    const page = Array.from({ length: 12 }, (_, index) =>
      resultBlock(`Title ${index}`, `https://example.com/${index}`, `snippet ${index}`),
    ).join('');
    expect(parseDuckDuckGo(page)).toHaveLength(8);
  });
});

describe('unwrapDuckDuckGo (T-0125)', () => {
  it('unwraps redirect links and passes plain URLs through', () => {
    expect(
      unwrapDuckDuckGo('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx%3Fa%3D1&rut=abc'),
    ).toBe('https://example.com/x?a=1');
    expect(unwrapDuckDuckGo('https://duckduckgo.com/l/?uddg=http%3A%2F%2Fexample.com%2F')).toBe(
      'http://example.com/',
    );
    expect(unwrapDuckDuckGo('https://example.com/direct')).toBe('https://example.com/direct');
  });

  it('drops anything that is not an http(s) target', () => {
    expect(unwrapDuckDuckGo(null)).toBeNull();
    expect(unwrapDuckDuckGo('javascript:evil()')).toBeNull();
    expect(unwrapDuckDuckGo('/relative/path')).toBeNull();
    expect(unwrapDuckDuckGo('//duckduckgo.com/l/?uddg=javascript%3Aevil()&rut=abc')).toBeNull();
    expect(unwrapDuckDuckGo('//duckduckgo.com/l/?rut=abc')).toBeNull();
  });
});
