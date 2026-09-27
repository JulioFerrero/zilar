import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

describe('NewChatButton', () => {
  it('opens the menu, a placeholder dialog, and closes it with Escape', () => {
    renderApp('/');

    fireEvent.click(screen.getByLabelText('New chat'));
    expect(screen.getByRole('menu', { name: 'New chat actions' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
    expect(screen.queryByRole('menu', { name: 'New chat actions' })).toBeNull();

    const dialog = screen.getByRole('dialog', { name: 'New group' });
    expect(screen.getByText('Coming soon')).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the new message dialog', () => {
    renderApp('/');

    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New message' }));

    expect(screen.getByRole('dialog', { name: 'New message' })).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });
});
