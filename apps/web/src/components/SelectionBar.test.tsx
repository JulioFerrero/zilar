import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionBar } from './SelectionBar';

afterEach(cleanup);

function renderBar(count: number, onForward = vi.fn(), onCancel = vi.fn()) {
  render(<SelectionBar count={count} onForward={onForward} onCancel={onCancel} />);
  return { onForward, onCancel };
}

describe('SelectionBar (T-0439)', () => {
  it('shows the count and disables Forward at zero', () => {
    renderBar(0);

    expect(screen.getByText('0 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('forwards from the primary button', () => {
    const { onForward } = renderBar(2);

    expect(screen.getByText('2 selected')).toBeTruthy();
    const forward = screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement;
    expect(forward.disabled).toBe(false);
    fireEvent.click(forward);

    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it('cancels from the outline button', () => {
    const { onCancel } = renderBar(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const { onCancel } = renderBar(1);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
