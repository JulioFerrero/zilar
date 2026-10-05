import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('uses the title as the accessible name and closes on Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete message?"
        body="This deletes it for everyone in the chat."
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Delete message?' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Delete message?' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('focuses Cancel first and confirms with the danger button', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete message?"
        body="This deletes it for everyone in the chat."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
