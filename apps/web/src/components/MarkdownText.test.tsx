import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownText } from './MarkdownText';

function renderMarkdown(text: string) {
  return render(<MarkdownText text={text} />).container;
}

describe('MarkdownText', () => {
  it('renders paragraphs, bold, italic and strike', () => {
    const container = renderMarkdown('plain **bold** *italic* ~~gone~~');
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('del')?.textContent).toBe('gone');
  });

  it('renders inline code and fenced code blocks', () => {
    const container = renderMarkdown('use `pnpm test`\n\n```ts\nconst x = 1;\n```');
    expect(container.querySelector('code')?.textContent).toBe('pnpm test');
    expect(container.querySelector('pre code')?.textContent?.trim()).toBe('const x = 1;');
  });

  it('renders ordered, unordered and nested lists', () => {
    const container = renderMarkdown('- one\n- two\n  - nested\n\n1. first\n2. second');
    expect(container.querySelector('ul li')?.textContent).toBe('one');
    expect(container.querySelector('ul ul li')?.textContent).toBe('nested');
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders blockquotes, headings and horizontal rules at modest sizes', () => {
    const container = renderMarkdown('# One\n\n## Two\n\n### Three\n\n> quoted\n\n---');
    expect(container.querySelector('h1')?.textContent).toBe('One');
    expect(container.querySelector('h2')?.textContent).toBe('Two');
    expect(container.querySelector('h3')?.textContent).toBe('Three');
    expect(container.querySelector('blockquote')?.textContent?.trim()).toBe('quoted');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders GFM tables', () => {
    const container = renderMarkdown('| Name | Price |\n| --- | --- |\n| Tea | 2 |');
    expect(container.querySelector('table')).not.toBeNull();
    const headers = container.querySelectorAll('th');
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toBe('Name');
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('renders task-list checkboxes read-only', () => {
    const container = renderMarkdown('- [x] done\n- [ ] todo');
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    for (const box of boxes) {
      expect(box.disabled).toBe(true);
    }
  });

  it('renders links with target and rel', () => {
    renderMarkdown('[the docs](https://x.com/a)');
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://x.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('allows mailto links', () => {
    renderMarkdown('[mail](mailto:hi@galena.test)');
    expect(screen.getByRole('link').getAttribute('href')).toBe('mailto:hi@galena.test');
  });

  it('renders a javascript: link as plain text', () => {
    const container = renderMarkdown('[click](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('click');
  });

  it('renders a data: link as plain text', () => {
    const container = renderMarkdown('[x](data:text/html,<b>hi</b>)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('x');
  });

  it('renders a vbscript: link as plain text', () => {
    const container = renderMarkdown('[x](vbscript:msgbox(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('x');
  });

  it('renders a relative link as plain text', () => {
    const container = renderMarkdown('[home](/settings)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('home');
  });

  it('renders a Markdown image as its alt text, never an img', () => {
    const container = renderMarkdown('![a diagram](https://evil.test/s.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('a diagram');
  });

  it('does not render raw HTML', () => {
    const container = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not throw on partial Markdown', () => {
    expect(() => renderMarkdown('**bold\n\n```ts\nconst x = 1;')).not.toThrow();
  });
});
