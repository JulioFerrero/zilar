import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

describe('FolderTabs', () => {
  it('is a segmented control with the active tab selected', () => {
    renderApp('/');
    const tablist = screen.getByRole('tablist', { name: 'Chat folders' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(within(tablist).getByRole('tab', { name: /All/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: /AIs/ }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('moves selection and focus with the arrow keys', () => {
    renderApp('/');
    const all = screen.getByRole('tab', { name: /All/ });
    fireEvent.keyDown(all, { key: 'ArrowRight' });

    const personal = screen.getByRole('tab', { name: /Personal/ });
    expect(personal.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(personal);

    fireEvent.keyDown(personal, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /AIs/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tab', { name: /AIs/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Personal/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
