import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseUrl } from '@zilar/chat-core';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns the URL only for the allowed protocols. A relative link or any other
 * scheme (`javascript:`, `data:`, `vbscript:`, `file:`) returns `undefined`, so
 * its anchor is skipped and the text stays plain.
 */
function safeUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? url : undefined;
}

const components: Components = {
  a({ href, children }) {
    if (href === undefined || href === '') {
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img({ alt }) {
    // A remote image would leak the reader's IP, so show the alt text instead.
    return <span>{alt ?? ''}</span>;
  },
};

/**
 * Renders a Markdown reply with a safe subset: GFM, no raw HTML, links only to
 * `http:`, `https:` and `mailto:`, and never an `<img>`. Memoized on `text` so
 * a reveal frame with unchanged text does not re-parse.
 */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => safeUrl(url) ?? ''}
      components={components}
    >
      {text}
    </Markdown>
  );
});
