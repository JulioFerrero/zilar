import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageActionsMenu, type MessageActionsMenuProps } from './MessageActionsMenu';

afterEach(cleanup);

function renderMenu(overrides: Partial<MessageActionsMenuProps> = {}) {
  const onForward = vi.fn();
  const onSelectMessages = vi.fn();
  const props: MessageActionsMenuProps = {
    canCopy: true,
    canEdit: false,
    canDelete: false,
    canPin: false,
    canForward: true,
    isPinned: false,
    onReply: vi.fn(),
    onForward,
    onSelectMessages,
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onReact: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<MessageActionsMenu {...props} />);
  return { onForward, onSelectMessages };
}

describe('MessageActionsMenu forward', () => {
  it('shows Forward after Reply and calls onForward', () => {
    const { onForward } = renderMenu();

    const forward = screen.getByRole('menuitem', { name: 'Forward' });
    expect(forward).toBeTruthy();
    fireEvent.click(forward);

    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it('hides Forward when the message cannot be forwarded', () => {
    renderMenu({ canForward: false });

    expect(screen.queryByRole('menuitem', { name: 'Forward' })).toBeNull();
  });
});

describe('MessageActionsMenu select (T-0439)', () => {
  it('shows Select after Forward and calls onSelectMessages', () => {
    const { onSelectMessages } = renderMenu();

    const select = screen.getByRole('menuitem', { name: 'Select' });
    expect(select).toBeTruthy();
    fireEvent.click(select);

    expect(onSelectMessages).toHaveBeenCalledTimes(1);
  });

  it('hides Select when the message cannot be forwarded', () => {
    renderMenu({ canForward: false });

    expect(screen.queryByRole('menuitem', { name: 'Select' })).toBeNull();
  });
});
