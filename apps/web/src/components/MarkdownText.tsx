import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseUrl } from '@zilar/chat-core';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Only `http:`, `https:` and `mailto:` links render; any other scheme stays plain text. */
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
  // A code block or table can scroll sideways, so make it keyboard-focusable.
  pre({ node: _node, ...props }) {
    void _node;
    return <pre {...props} tabIndex={0} />;
  },
  table({ node: _node, ...props }) {
    void _node;
    return <table {...props} tabIndex={0} />;
  },
};

/** Markdown reply subset: GFM, no raw HTML, no `<img>`; memoized on `text`. */
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
