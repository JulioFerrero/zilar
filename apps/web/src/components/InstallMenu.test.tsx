import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

// Install entry (T-0119): the main menu carries "Install app" only while the
// browser holds a `beforeinstallprompt` offer, and a Notifications entry
// always.

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
}

describe('ChatList install and notifications entries', () => {
  it('shows no Install entry without an install offer', () => {
    renderApp('/');
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Install/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toBeTruthy();
  });

  it('shows Install while the browser offers it, then fires the prompt', () => {
    renderApp('/');
    const prompt = vi.fn(async () => undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    (event as unknown as { prompt: () => Promise<void> }).prompt = prompt;
    act(() => {
      window.dispatchEvent(event);
    });

    openMenu();
    const install = screen.getByRole('menuitem', { name: 'Install app' });
    fireEvent.click(install);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('navigates to the Notifications page from the menu', () => {
    renderApp('/');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notifications' }));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
  });
});
