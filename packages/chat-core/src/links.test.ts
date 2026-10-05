import { describe, expect, it } from 'vitest';
import { splitLinks } from './links';

describe('splitLinks', () => {
  it('links an http and an https URL', () => {
    expect(splitLinks('see https://x.com/a now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://x.com/a', href: 'https://x.com/a' },
      { kind: 'text', text: ' now' },
    ]);
    expect(splitLinks('http://x.com')).toEqual([
      { kind: 'link', text: 'http://x.com', href: 'http://x.com' },
    ]);
  });

  it('keeps trailing punctuation out of the link', () => {
    expect(splitLinks('https://x.com/a).')).toEqual([
      { kind: 'link', text: 'https://x.com/a', href: 'https://x.com/a' },
      { kind: 'text', text: ').' },
    ]);
  });

  it('keeps a closing bracket the URL opened', () => {
    expect(splitLinks('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      {
        kind: 'link',
        text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      },
    ]);
  });

  it('splits multiple links', () => {
    const segments = splitLinks('a https://x.com/1 and https://y.com/2');
    expect(segments.filter((segment) => segment.kind === 'link')).toHaveLength(2);
    expect(segments).toContainEqual({
      kind: 'link',
      text: 'https://x.com/1',
      href: 'https://x.com/1',
    });
    expect(segments).toContainEqual({
      kind: 'link',
      text: 'https://y.com/2',
      href: 'https://y.com/2',
    });
  });

  it('never links unsafe schemes or bare www', () => {
    for (const text of [
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'www.x.com',
    ]) {
      expect(splitLinks(text)).toEqual([{ kind: 'text', text }]);
    }
  });

  it('returns a single text segment for plain text', () => {
    expect(splitLinks('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
  });
});
