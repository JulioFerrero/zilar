import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DismissBanner } from './dismiss-banner';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

function markup(tone: 'error' | 'notice'): string {
  return renderToStaticMarkup(
    createElement(DismissBanner, { message: 'Something went wrong', tone, onDismiss: () => {} }),
  );
}

describe('DismissBanner', () => {
  it('renders the error tone with an alert message and a Dismiss error control', () => {
    const html = markup('error');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Dismiss error');
    expect(html).toContain('accessibilityRole="alert"');
    expect(html).toContain('text-danger');
  });

  it('renders the notice tone without an alert role', () => {
    const html = markup('notice');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Dismiss notice');
    expect(html).toContain('text-muted-foreground');
    expect(html).not.toContain('accessibilityRole="alert"');
  });
});
