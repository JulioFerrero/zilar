import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('message actions', () => {
  it('opens on right-click and closes with Escape', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));

    const menu = screen.getByRole('menu', { name: 'Message actions' });
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  });

  it('shows the reply bar and cancels it with the × button', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));

    expect(screen.getByText('Reply to Luis')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('cancels a reply with Escape while the composer is focused', () => {
    renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' });

    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('sends a reply and renders the quote in the new bubble', () => {
    const { store } = renderApp('/c/c-viernes');

    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    const textarea = screen.getByLabelText('Message');
    fireEvent.change(textarea, { target: { value: 'See you there' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const list = screen.getByTestId('message-list');
    const row = within(list).getByText('See you there').closest('[data-message-id]');
    expect(row?.textContent).toContain('Luis');
    expect(row?.textContent).toContain('Friday plans?');
    expect(store.getState().messages('c-viernes').at(-1)?.replyTo?.senderName).toBe('Luis');
    expect(screen.queryByText('Reply to Luis')).toBeNull();
  });

  it('copies the message text to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    renderApp('/c/c-viernes');
    fireEvent.contextMenu(screen.getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));

    expect(writeText).toHaveBeenCalledWith('Friday plans?');
  });
});
