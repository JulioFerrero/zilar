import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

describe('ChatHeader menu Escape', () => {
  it('closes the menu on Escape without reaching the window listener', () => {
    // `/c/c-devteam` is a topic, so the header shows the topic menu. The
    // spy stands in for ChatShell's window Escape handler, which leaves
    // the chat on narrow screens: the kit Menu must stop Escape first.
    renderApp('/c/c-devteam');
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
      expect(screen.getByRole('menu', { name: 'Topic actions' })).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu', { name: 'Topic actions' })).toBeNull();
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });

  it('sees window keydown events when no menu is open (control)', () => {
    renderApp('/c/c-devteam');
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });
});
